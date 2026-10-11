import { IProjectSchema } from '@db/models/proposal.model';
import { appendFeedback, buildFeedbackEntry, hadPreviousValue, toFeedbackConfidence, type FieldPatchFeedback, type PatchAuthor } from './feedback';
import { getFieldDefinition, getUnitFieldDefinition, isInternalPath } from './schema-registry';
import { normalizePhoneValue } from '@shared/utils/phone-values';

export type { FieldPatchFeedback, PatchAuthor } from './feedback';

export interface FieldPatch {
  fieldPath: string;
  value: unknown;
  status?: 'PENDING' | 'SAVED' | 'APPROVED';
  feedback?: FieldPatchFeedback;
}

const stageOfPath = (fieldPath: string): number => {
  const match = /^stage_(\d)/.exec(fieldPath);
  if (match) return Number(match[1]);
  return fieldPath.startsWith('units.') ? 4 : 0;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Mark a node as human-owned so a later AI run cannot silently take it back.
 * `_meta` is the only branch of a field the AI deep-merge never writes, which is
 * why the marker lives there and survives every re-run and every "revise stage".
 * `source: 'ESTIMATOR'` means "a person", not the estimator role: sales managers
 * and admins reach applyPatches through exactly the same path.
 */
const stampHumanOverride = (node: any, meta: PatchAuthor): void => {
  node._meta = {
    ...(node._meta ?? {}),
    human_override: true,
    human_override_at: new Date().toISOString(),
    human_override_by: meta.updatedBy,
  };
};

/**
 * Unit rows are one flat node per unit (value_width_in, value_description, ...)
 * rather than one IBaseField per field, so a single `human_override` boolean on
 * the unit would protect every field on it — including ones the estimator never
 * touched, like the AI-only value_description/value_man_hours. Track exactly
 * which fields a human edited instead (never the blanket boolean, which
 * deepMergeSchema in proposal.service.ts treats as "protect this whole node"),
 * so AI stage runs can still write everything else on the unit.
 */
const stampUnitFieldOverride = (unit: any, meta: PatchAuthor, fieldNames: string[]): void => {
  const existingFields: string[] = Array.isArray(unit._meta?.human_override_fields)
    ? unit._meta.human_override_fields
    : [];
  unit._meta = {
    ...(unit._meta ?? {}),
    // Overwrite (not omit) any stale whole-node flag from before this field
    // list existed — deepMergeSchema falls back to it whenever
    // human_override_fields is absent, so leaving an old `true` in place
    // would keep blocking the entire unit despite the new field list.
    human_override: undefined,
    human_override_at: new Date().toISOString(),
    human_override_by: meta.updatedBy,
    human_override_fields: Array.from(new Set([...existingFields, ...fieldNames])),
  };
};

const normalizeTypedValue = (
  value: unknown,
  definition: { valueType?: string; min?: number; max?: number; allowedValues?: readonly string[] },
  fieldPath: string,
): unknown => {
  let normalized = value;

  if ((definition.valueType === 'number' || definition.valueType === 'integer') && typeof normalized === 'string') {
    const trimmed = normalized.trim();
    normalized = trimmed === '' ? null : Number(trimmed);
  }

  if (normalized === null || normalized === undefined) return null;

  switch (definition.valueType) {
    case 'number':
      if (!isFiniteNumber(normalized)) throw new Error(`${fieldPath} must be a valid number`);
      break;
    case 'integer':
      if (!isFiniteNumber(normalized) || !Number.isInteger(normalized)) {
        throw new Error(`${fieldPath} must be a whole number`);
      }
      break;
    case 'text':
      if (typeof normalized !== 'string') throw new Error(`${fieldPath} must be text`);
      break;
    case 'select':
      if (typeof normalized !== 'string') throw new Error(`${fieldPath} must be a valid selection`);
      break;
    case 'yn':
      if (normalized !== true && normalized !== false && normalized !== 'y' && normalized !== 'n') {
        throw new Error(`${fieldPath} must be Y or N`);
      }
      break;
    default:
      break;
  }

  if (definition.allowedValues && !definition.allowedValues.includes(normalized as string)) {
    throw new Error(`Invalid value for ${fieldPath}: ${normalized}. Allowed: ${definition.allowedValues.join(', ')}`);
  }
  if (isFiniteNumber(normalized) && definition.min !== undefined && normalized < definition.min) {
    throw new Error(`${fieldPath} must be at least ${definition.min}`);
  }
  if (isFiniteNumber(normalized) && definition.max !== undefined && normalized > definition.max) {
    throw new Error(`${fieldPath} must be at most ${definition.max}`);
  }

  return normalized;
};

export function applyPatches(
  currentSchema: IProjectSchema,
  patches: FieldPatch[],
  meta: PatchAuthor
): { nextSchema: IProjectSchema; changedFieldPaths: string[] } {
  // Deep clone to preserve all untouched data
  const nextSchema: IProjectSchema = structuredClone(currentSchema);
  const changedFieldPaths: string[] = [];
  // One feedback entry per takeoff row per call, however many columns changed.
  const unitsGivenFeedback = new Set<string>();

  for (const patch of patches) {
    let { fieldPath, value } = patch;
    
    // The workspace renders root-level units from the relevant workflow stage.
    // Units themselves live at the schema root, so normalize the display path
    // before validating and saving it. Keeping the stage prefix in the request
    // lets the service enforce the correct stage lock before it gets here.
    if (/^stage_[234]\.units\./.test(fieldPath)) {
      fieldPath = fieldPath.replace(/^stage_[234]\.units\./, 'units.');
    }
    
    const isUnitPath = fieldPath.startsWith('units.');
    const def = getFieldDefinition(fieldPath);

    if (!isUnitPath && !def) {
      throw new Error(`Invalid schema path: ${fieldPath}`);
    }

    const parts = fieldPath.split('.');
    const isUnitFieldPath = isUnitPath && parts.length === 3;
    const unitId = isUnitPath ? parts[1] : undefined;
    const unitKey = unitId!;
    const unitField = isUnitFieldPath ? getUnitFieldDefinition(parts[2]!) : undefined;

    if (isUnitPath && (!unitId || !/^[A-J]$/.test(unitId))) {
      throw new Error(`Invalid takeoff unit: ${unitId ?? 'unknown'}`);
    }
    if (isUnitFieldPath && !unitField) {
      throw new Error(`Invalid takeoff field: ${parts[2]}`);
    }
    if (isUnitPath && parts.length !== 2 && parts.length !== 3) {
      throw new Error(`Invalid unit path: ${fieldPath}`);
    }

    // Validate using the same type metadata that the frontend receives.
    value = isUnitFieldPath
      ? normalizeTypedValue(value, unitField!, fieldPath)
      : normalizeTypedValue(value, def ?? {}, fieldPath);

    if (fieldPath === 'stage_1.contact_phone') {
      value = normalizePhoneValue(value);
    }

    if (meta.source === 'ESTIMATOR') {
      if (isInternalPath(fieldPath)) {
        throw new Error(`Estimator cannot edit internal path: ${fieldPath}`);
      }
      if (fieldPath === 'stage_4.crossbeam' && value === 'MANUAL') {
        throw new Error('Crossbeam must be a beam series or NO_BEAM');
      }
      if (!isUnitPath && def?.editable === false) {
        throw new Error(`This field is calculated by the backend and cannot be edited: ${fieldPath}`);
      }
    }

    // Traverse and set the value
    let current: any = nextSchema;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current)) {
        current[part] = {}; // Initialize path if it somehow doesn't exist, though schema should be fully seeded
      }
      current = current[part];
    }

    const leafKey = parts[parts.length - 1]!;

    if (isUnitPath) {
      if (parts.length === 3) {
        const previousValue = current[leafKey];
        current[leafKey] = value;
        if (!nextSchema.units[unitKey]) nextSchema.units[unitKey] = {} as any;
        nextSchema.units[unitKey]!.updated_at = new Date();
        nextSchema.units[unitKey]!.updated_by = meta.updatedBy;
        nextSchema.units[unitKey]!.status = patch.status ?? (meta.source === 'ESTIMATOR' ? 'SAVED' : 'PENDING');
        if (meta.source === 'ESTIMATOR') stampUnitFieldOverride(nextSchema.units[unitKey], meta, [leafKey]);

        if (
          patch.feedback &&
          meta.source === 'ESTIMATOR' &&
          !unitsGivenFeedback.has(unitKey) &&
          hadPreviousValue(previousValue)
        ) {
          unitsGivenFeedback.add(unitKey);
          appendFeedback(
            nextSchema.units[unitKey]!,
            buildFeedbackEntry(patch.feedback, {
              previousValue,
              newValue: value,
              aiReasoning: nextSchema.units[unitKey]!.reasoning ?? null,
              aiConfidence: toFeedbackConfidence(nextSchema.units[unitKey]!.extracted_confidence ?? null),
              author: meta,
              stage: 4,
              changedColumns: patch.feedback.changedColumns ?? [leafKey],
            }),
          );
        }
      } else if (parts.length === 2) {
        if (!nextSchema.units[unitKey]) nextSchema.units[unitKey] = {} as any;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`Unit patch ${fieldPath} must contain an object`);
        }
        Object.assign(nextSchema.units[unitKey]!, value as object);
        nextSchema.units[unitKey]!.updated_at = new Date();
        nextSchema.units[unitKey]!.updated_by = meta.updatedBy;
        nextSchema.units[unitKey]!.status = patch.status ?? (meta.source === 'ESTIMATOR' ? 'SAVED' : 'PENDING');
        if (meta.source === 'ESTIMATOR') {
          stampUnitFieldOverride(nextSchema.units[unitKey], meta, Object.keys(value as object));
        }
      } else {
        throw new Error(`Invalid unit path: ${fieldPath}`);
      }
    } else {
      // For standard IBaseField structures
      if (!current[leafKey]) {
         current[leafKey] = { value: null, status: 'PENDING' };
      }
      const previousValue = current[leafKey].value;

      if (patch.feedback && meta.source === 'ESTIMATOR' && hadPreviousValue(previousValue)) {
        appendFeedback(
          current[leafKey],
          buildFeedbackEntry(patch.feedback, {
            previousValue,
            newValue: value,
            aiReasoning: current[leafKey].reasoning ?? null,
            aiConfidence: toFeedbackConfidence(current[leafKey].confidence ?? null),
            author: meta,
            stage: stageOfPath(fieldPath),
          }),
        );
      }

      current[leafKey].value = value;
      current[leafKey].updated_at = new Date();
      current[leafKey].updated_by = meta.updatedBy;
      current[leafKey].status = patch.status ?? (meta.source === 'ESTIMATOR' ? 'SAVED' : 'PENDING');
      if (meta.source === 'ESTIMATOR') stampHumanOverride(current[leafKey], meta);
    }

    changedFieldPaths.push(fieldPath);
  }

  return { nextSchema, changedFieldPaths };
}
