import type { IProjectSchema } from '@db/models/proposal.model';
import { MULTI_UNIT_FRAME_TYPES, MULTI_UNIT_GLASS_TYPES } from './multi-unit.contract';
import type { FieldPatch } from './schema-merge.engine';
import { hasRealUnitData } from './unit-pricing-products';

/**
 * Pricing, the workbook and the proposal read a unit's own glass and frame,
 * while the Glass/Frame screens of a one-unit project show the project value.
 * A change to only the project value would leave the two disagreeing, so the
 * single unit follows it.
 */

interface SpecBinding {
  projectPath: 'stage_2.glass_type' | 'stage_3.decision.frame_type';
  unitField: 'value_glass_type' | 'value_frame_type';
  label: string;
  allowed: readonly string[];
  read: (schema: IProjectSchema) => unknown;
}

const SPEC_BINDINGS: readonly SpecBinding[] = [
  {
    projectPath: 'stage_2.glass_type',
    unitField: 'value_glass_type',
    label: 'glass type',
    allowed: MULTI_UNIT_GLASS_TYPES,
    read: (schema) => schema.stage_2?.glass_type?.value,
  },
  {
    projectPath: 'stage_3.decision.frame_type',
    unitField: 'value_frame_type',
    label: 'frame type',
    allowed: MULTI_UNIT_FRAME_TYPES,
    read: (schema) => schema.stage_3?.decision?.frame_type?.value,
  },
];

/** The key and row of the project's only real unit, or null when it has none or several. */
const singleRealUnit = (schema: IProjectSchema): [string, Record<string, any>] | null => {
  const realUnits = Object.entries(schema.units ?? {}).filter(([, unit]) => hasRealUnitData(unit));
  return realUnits.length === 1 ? (realUnits[0] as [string, Record<string, any>]) : null;
};

/**
 * Copies a changed project glass/frame onto the only real unit. Skips a unit
 * the same push already set and any field an estimator overrode. Mutates
 * `next` and returns the changed unit paths.
 */
export function syncSingleUnitSpecsFromProject(before: IProjectSchema, next: IProjectSchema): string[] {
  const single = singleRealUnit(next);
  if (!single) return [];

  const [key, unit] = single;
  const unitBefore = (before.units?.[key] ?? {}) as Record<string, unknown>;
  const overridden = new Set<string>(unit?.['_meta']?.human_override_fields ?? []);
  const changed: string[] = [];

  for (const binding of SPEC_BINDINGS) {
    const projectValue = binding.read(next);
    if (projectValue === binding.read(before)) continue;
    if (typeof projectValue !== 'string' || !binding.allowed.includes(projectValue)) continue;
    if (overridden.has(binding.unitField)) continue;
    if (unit[binding.unitField] !== unitBefore[binding.unitField]) continue;
    if (unit[binding.unitField] === projectValue) continue;

    unit[binding.unitField] = projectValue;
    const reason = `Follows the project ${binding.label} change to ${projectValue}`;
    const reasoning: unknown[] = Array.isArray(unit['reasoning']) ? unit['reasoning'] : [];
    if (!reasoning.includes(reason)) unit['reasoning'] = [...reasoning, reason];
    changed.push(`units.${key}.${binding.unitField}`);
  }

  return changed;
}

/**
 * The unit edits that go with an estimator's glass/frame edit on a one-unit
 * project, so the unit is saved as the estimator's choice too. None when the
 * same request already edits that unit field.
 */
export function singleUnitSpecPatches(schema: IProjectSchema, patches: readonly FieldPatch[]): FieldPatch[] {
  const single = singleRealUnit(schema);
  if (!single) return [];

  const [key] = single;
  const patchedPaths = new Set(patches.map((patch) => patch.fieldPath.replace(/^stage_[234]\.units\./, 'units.')));

  return SPEC_BINDINGS.flatMap((binding) => {
    const unitPath = `units.${key}.${binding.unitField}`;
    const value = patches.filter((patch) => patch.fieldPath === binding.projectPath).at(-1)?.value;
    if (typeof value !== 'string' || !binding.allowed.includes(value) || patchedPaths.has(unitPath)) return [];
    return [{ fieldPath: unitPath, value }];
  });
}
