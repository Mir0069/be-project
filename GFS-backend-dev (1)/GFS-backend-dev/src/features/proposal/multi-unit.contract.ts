import { z } from 'zod';
import {
  VISION_DIMENSION_LABEL_TYPES,
  visionCanonicalUnitSchema,
  visionCanonicalUnitsToMap,
} from './vision.contract';

/**
 * Canonical multi-unit contract shared by the AI stage webhook and the
 * estimator workspace. Unit rows are keyed A-J so the same identity survives
 * extraction, human edits, re-triggering, and Excel generation.
 */
export const MULTI_UNIT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
export type MultiUnitKey = (typeof MULTI_UNIT_KEYS)[number];

export const MULTI_UNIT_FRAME_TYPES = [
  'SERIES_2000_RECESSED',
  'SERIES_2000_PEDESTAL',
  'SERIES_1000_PEDESTAL',
  'SERIES_1000_RECESSED',
  'PERIMETER_NON_TB',
  'DECK_PERIMETER',
  'ECONOFRAME',
  'SERIES_3000',
  'SERIES_2000_WITH_PLATE',
  'SERIES_2000_NON_WALKABLE',
  'ROUND_FRAME_42',
  'HORIZONTAL_CAP_SERIES_1000',
  'VERTICAL_CAP_SERIES_1000',
  'MANUAL',
] as const;

export const MULTI_UNIT_GLASS_TYPES = [
  'GLASS_NO_IGU',
  'GLASS_WITH_IGU',
  'GLASS_2_0',
  'STAIR_TREAD',
  'NON_WALKABLE',
  'EGR',
] as const;

/** Crossbeam selections accepted on an individual unit record. */
export const MULTI_UNIT_CROSSBEAM_TYPES = [
  'T_SECTION_NTB',
  'T_SECTION_TB',
  'I_BEAM_NTB',
  'I_BEAM_TB',
  'I_BEAM_TB_2000',
  'SERIES_1000_T_SECTION_TB',
  'SERIES_1000_I_BEAM_TB',
  'SERIES_1000_T_SECTION',
  'SERIES_1000_I_BEAM',
  'SERIES_2000_T_SECTION_TB',
  'SERIES_2000_I_BEAM_TB',
  'ECONOFRAME_2_5',
  'ECONOFRAME_3_5',
  'NO_BEAM',
  'MANUAL',
] as const;

const CROSSBEAM_VALUE_ALIASES: Readonly<Record<string, string>> = {
  NONE: 'NO_BEAM',
  'NO BEAM': 'NO_BEAM',
  ECONOFRAME_25: 'ECONOFRAME_2_5',
  ECONOFRAME_35: 'ECONOFRAME_3_5',
};

const normalizeCrossbeamValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toUpperCase();
  return CROSSBEAM_VALUE_ALIASES[normalized] ?? normalized;
};

const normalizeCrossbeamUnitAliases = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  const aliases: ReadonlyArray<readonly [string, string]> = [
    ['value_cross_beam', 'value_crossbeam'],
    ['extracted_cross_beam', 'extracted_crossbeam'],
    ['cross_beam_confidence', 'crossbeam_confidence'],
    ['cross_beam_reasoning', 'crossbeam_reasoning'],
    ['cross_beam_citation', 'crossbeam_citation'],
  ];

  for (const [canonical, legacy] of aliases) {
    if (!Object.prototype.hasOwnProperty.call(record, canonical) &&
        Object.prototype.hasOwnProperty.call(record, legacy)) {
      record[canonical] = record[legacy];
    }
    delete record[legacy];
  }

  if (Object.prototype.hasOwnProperty.call(record, 'value_cross_beam')) {
    record['value_cross_beam'] = normalizeCrossbeamValue(record['value_cross_beam']);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'extracted_cross_beam')) {
    record['extracted_cross_beam'] = normalizeCrossbeamValue(record['extracted_cross_beam']);
  }
  if (typeof record['cross_beam_reasoning'] === 'string') {
    record['cross_beam_reasoning'] = [record['cross_beam_reasoning']];
  }
  return record;
};

const emptyStringToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const nullableText = () => z.preprocess(
  emptyStringToNull,
  z.string().trim().min(1).nullable().optional(),
);

const nonNegativeNumber = () => z.preprocess(
  (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : Number(trimmed);
    }
    return value;
  },
  z.number().refine(Number.isFinite, 'must be finite').min(0).nullable().optional(),
);

const nonNegativeInteger = () => z.preprocess(
  (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : Number(trimmed);
    }
    return value;
  },
  z.number().refine(Number.isFinite, 'must be finite').int().min(0).nullable().optional(),
);

const positiveInteger = () => z.preprocess(
  (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : Number(trimmed);
    }
    return value;
  },
  z.number().refine(Number.isFinite, 'must be finite').int().min(1).nullable().optional(),
);

const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(
  emptyStringToNull,
  z.enum(values).nullable().optional(),
);

/** Unit statuses the proposal model stores; NEEDS_REVIEW marks an AI change awaiting the estimator. */
export const MULTI_UNIT_STATUSES = ['PENDING', 'SAVED', 'APPROVED', 'NEEDS_REVIEW'] as const;

/** One AI-produced or estimator-edited take-off row, before crossbeam aliases are normalized. */
const aiUnitRecordObjectSchema = z.object({
  unit_id: z.string().trim().regex(/^[A-J]$/i).optional(),
  status: z.enum(MULTI_UNIT_STATUSES).optional(),
  // AI internal descriptive label for matching a unit across stages
  // (e.g. "Skylight assembly 1"). Display uses value_location/description.
  unit_label: nullableText(),

  value_frame_type: nullableEnum(MULTI_UNIT_FRAME_TYPES),
  value_glass_type: nullableEnum(MULTI_UNIT_GLASS_TYPES),
  value_cross_beam: nullableEnum(MULTI_UNIT_CROSSBEAM_TYPES),
  value_glass_thickness: nullableText(),
  value_location: nullableText(),
  value_drawing_number: nullableText(),
  value_width_in: nonNegativeNumber(),
  value_length_in: nonNegativeNumber(),
  value_panel_count: nonNegativeInteger(),
  value_num_units: positiveInteger(),
  value_rafter_count: nonNegativeInteger(),
  value_vertical_rafter_count: nonNegativeInteger(),
  value_horizontal_rafter_count: nonNegativeInteger(),
  value_rows: nonNegativeInteger(),
  value_columns: nonNegativeInteger(),
  // AI wire name for column count (GFS-AI sends value_cols). Mirrored to
  // value_columns on normalize — readers accept both, canonical stays plural.
  value_cols: nonNegativeInteger(),
  // True when rows×cols is a confirmed real 2D layout, not a single-row fallback.
  value_is_grid_confirmed: z.boolean().nullable().optional(),
  value_t_rafter_details: nullableText(),
  value_layout_source: nullableText(),
  value_man_hours: nonNegativeNumber(),
  value_packaging: nonNegativeNumber(),
  value_description: nullableText(),

  extracted_frame_type: nullableEnum(MULTI_UNIT_FRAME_TYPES),
  extracted_glass_type: nullableEnum(MULTI_UNIT_GLASS_TYPES),
  extracted_cross_beam: nullableEnum(MULTI_UNIT_CROSSBEAM_TYPES),
  cross_beam_confidence: z.union([z.string(), z.number()]).nullable().optional(),
  cross_beam_reasoning: z.array(z.string()).optional(),
  cross_beam_citation: z.unknown().nullable().optional(),
  extracted_glass_thickness: nullableText(),
  extracted_width_in: nonNegativeNumber(),
  extracted_length_in: nonNegativeNumber(),
  extracted_panel_count: nonNegativeInteger(),
  extracted_rafter_count: nonNegativeInteger(),
  extracted_vertical_rafter_count: nonNegativeInteger(),
  extracted_horizontal_rafter_count: nonNegativeInteger(),
  extracted_rows: nonNegativeInteger(),
  extracted_columns: nonNegativeInteger(),
  extracted_t_rafter_details: nullableText(),
  extracted_layout_source: nullableText(),
  extracted_location: nullableText(),
  extracted_dim_type: z.enum(VISION_DIMENSION_LABEL_TYPES).nullable().optional(),
  extracted_verbatim: nullableText(),
  extracted_citation: z.unknown().nullable().optional(),
  // GFS-AI stamps this with Python's isoformat() ("...T14:26:54.264634+00:00").
  // zod's datetime() accepts only "Z" by default, and one unit failing here
  // rejects the whole Stage 2-5 result — every unit's descriptions, man
  // hours and specs with it — so offsets must be allowed.
  extracted_at: z.string().datetime({ offset: true }).nullable().optional(),
  extracted_confidence: z.union([z.string(), z.number()]).nullable().optional(),
  reasoning: z.array(z.string()).optional(),
  flags: z.array(z.string()).optional(),
}).passthrough();

/** One AI-produced or estimator-edited take-off row. */
export const aiUnitRecordSchema = z.preprocess(normalizeCrossbeamUnitAliases, aiUnitRecordObjectSchema);

export type AiUnitRecord = z.infer<typeof aiUnitRecordSchema>;

const UNIT_FIELD_SCHEMAS = aiUnitRecordObjectSchema.shape as Record<string, z.ZodTypeAny>;

const unitMapSchema = z.record(z.string(), aiUnitRecordSchema).superRefine((units, ctx) => {
  for (const [rawKey, unit] of Object.entries(units)) {
    const key = rawKey.toUpperCase();
    if (!MULTI_UNIT_KEYS.includes(key as MultiUnitKey)) {
      ctx.addIssue({
        code: 'custom',
        path: [rawKey],
        message: 'must use a unit key from A through J',
      });
      continue;
    }

    if (unit.unit_id && unit.unit_id.toUpperCase() !== key) {
      ctx.addIssue({
        code: 'custom',
        path: [rawKey, 'unit_id'],
        message: `must match the unit key ${key}`,
      });
    }
  }
});

export type AiUnitMap = z.infer<typeof unitMapSchema>;

export interface NormalizedAiStageResult extends Record<string, unknown> {
  stage?: number | string;
  status?: string;
  fields_to_show?: unknown;
  units?: Record<string, AiUnitRecord>;
  stage_6_proposal?: {
    target_sheet: string;
    cells: Record<string, string | number | null>;
    status?: string;
  };
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

/**
 * Normalize a per-unit AI confidence into the persisted 0-1 scale.
 * The AI sends either 0-1 ratio (0.94) or 0-100 percentage (94); values
 * above 1 are scaled down once so a percentage never lands 100x off in
 * feedback/UI. Non-numeric values pass through untouched for zod to judge.
 */
const normalizeUnitConfidence = (value: unknown): unknown => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return value / 100;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 1) return numeric / 100;
    }
  }
  return value;
};

const unitCandidates = (payload: Record<string, unknown>): Array<{ path: string; value: unknown }> => {
  const stage4 = asRecord(payload['stage_4']);
  const fieldsToShow = asRecord(payload['fields_to_show']);
  const fieldsStage4 = asRecord(fieldsToShow?.['stage_4']);
  const stage4Takeoff = asRecord(stage4?.['takeoff']);
  const fieldsStage4Takeoff = asRecord(fieldsStage4?.['takeoff']);

  return [
    { path: 'units', value: payload['units'] },
    { path: 'stage_4.units', value: stage4?.['units'] },
    { path: 'stage_4.takeoff.units', value: stage4Takeoff?.['units'] },
    { path: 'fields_to_show.units', value: fieldsToShow?.['units'] },
    { path: 'fields_to_show.stage_4.units', value: fieldsStage4?.['units'] },
    { path: 'fields_to_show.stage_4.takeoff.units', value: fieldsStage4Takeoff?.['units'] },
  ].filter((candidate) => candidate.value !== undefined);
};

/**
 * Canonical Vision `units` arrays (`CanonicalUnit` objects from
 * `extraction/canonical.py`) found at the same wrapper locations as the
 * backend map form. Array entries are validated against the Vision contract
 * and converted to the backend map before merging.
 */
const canonicalArrayCandidates = (
  payload: Record<string, unknown>,
): Array<{ path: string; value: unknown[] }> =>
  unitCandidates(payload).filter(
    (candidate): candidate is { path: string; value: unknown[] } => Array.isArray(candidate.value),
  );

const canonicalUnitsArraySchema = z.array(visionCanonicalUnitSchema);

const canonicalizeUnitMap = (units: AiUnitMap): Record<string, AiUnitRecord> => {
  const canonical: Record<string, AiUnitRecord> = {};
  for (const [rawKey, unit] of Object.entries(units)) {
    const key = rawKey.toUpperCase();
    if (canonical[key]) {
      throw new Error(`Duplicate multi-unit key after normalization: ${key}`);
    }
    const record = { ...unit, unit_id: key } as Record<string, unknown>;
    // Alias mirror: AI sends value_cols, canonical readers use value_columns.
    // Keep whichever arrived and backfill the other so both always agree.
    if (record['value_columns'] == null && record['value_cols'] != null) {
      record['value_columns'] = record['value_cols'];
    } else if (record['value_cols'] == null && record['value_columns'] != null) {
      record['value_cols'] = record['value_columns'];
    }
    canonical[key] = record as AiUnitRecord;
  }
  return canonical;
};

/**
 * Removes unit fields that break the contract (a free-text glass make-up, an
 * unknown status) so one bad value cannot reject a whole AI result; the stored
 * value simply stays. Unit keys and canonical Vision arrays are still checked
 * strictly. Mutates the payload and returns the dropped paths.
 */
export const dropInvalidUnitFields = (payload: Record<string, unknown>): string[] => {
  const dropped: string[] = [];
  for (const candidate of unitCandidates(payload)) {
    const units = asRecord(candidate.value);
    if (!units) continue;
    for (const [unitKey, rawUnit] of Object.entries(units)) {
      const unit = asRecord(rawUnit);
      if (!unit) continue;
      const normalized = normalizeCrossbeamUnitAliases(unit) as Record<string, unknown>;
      for (const [field, value] of Object.entries(normalized)) {
        const schema = UNIT_FIELD_SCHEMAS[field];
        if (!schema || field === 'unit_id' || schema.safeParse(value).success) continue;
        delete normalized[field];
        dropped.push(`${candidate.path}.${unitKey}.${field}`);
      }
      units[unitKey] = normalized;
    }
  }
  return dropped;
};

const stripNestedUnits = (value: unknown): unknown => {
  const record = asRecord(value);
  if (!record) return value;

  const result = { ...record };
  delete result['units'];

  const stage4 = asRecord(result['stage_4']);
  if (stage4) result['stage_4'] = stripNestedUnits(stage4);

  const takeoff = asRecord(result['takeoff']);
  if (takeoff) result['takeoff'] = stripNestedUnits(takeoff);

  return result;
};

/**
 * The AI may wrap Stage 4 in `fields_to_show`, `stage_4`, or `takeoff` while
 * older workers send root-level `units`. Normalize all supported forms to the
 * persisted root-level `units` contract before the proposal merge runs.
 *
 * When more than one location carries a map, every location is merged
 * per-unit (higher-precedence location wins per key) instead of silently
 * dropping all but the first map.
 */
export const normalizeAiMultiUnitPayload = (input: unknown): NormalizedAiStageResult => {
  const payload = asRecord(input);
  if (!payload) throw new Error('AI stage result must be a JSON object');

  // Backend map form only — canonical Vision arrays are handled separately below.
  const candidates = unitCandidates(payload).filter((candidate) => !Array.isArray(candidate.value));
  const arrayCandidates = canonicalArrayCandidates(payload);
  if (candidates.length === 0 && arrayCandidates.length === 0) return { ...payload } as NormalizedAiStageResult;

  const merged: Record<string, unknown> = {};
  // Canonical Vision arrays seed the map first; the derived backend map form
  // (rules-engine output) wins per key when both carry the same unit.
  for (const candidate of [...arrayCandidates].reverse()) {
    const parsedUnits = canonicalUnitsArraySchema.parse(candidate.value);
    const mapped = visionCanonicalUnitsToMap(parsedUnits);
    for (const [key, unit] of Object.entries(mapped)) {
      const normalizedUnit = normalizeCrossbeamUnitAliases(unit) as Record<string, unknown>;
      merged[key] = { ...(asRecord(merged[key]) ?? {}), ...normalizedUnit };
    }
  }
  for (const candidate of [...candidates].reverse()) {
    const parsed = unitMapSchema.parse(candidate.value);
    for (const [rawKey, unit] of Object.entries(parsed)) {
      const key = rawKey.toUpperCase();
      merged[key] = { ...(asRecord(merged[key]) ?? {}), ...unit };
    }
  }
  for (const unit of Object.values(merged)) {
    const record = asRecord(unit);
    if (record) {
      if ('extracted_confidence' in record) {
        record['extracted_confidence'] = normalizeUnitConfidence(record['extracted_confidence']);
      }
      if ('cross_beam_confidence' in record) {
        record['cross_beam_confidence'] = normalizeUnitConfidence(record['cross_beam_confidence']);
      }
    }
  }
  const normalized: NormalizedAiStageResult = { ...payload, units: canonicalizeUnitMap(merged as AiUnitMap) };
  normalized['stage_4'] = stripNestedUnits(normalized['stage_4']);
  normalized['fields_to_show'] = stripNestedUnits(normalized['fields_to_show']);

  return normalized;
};

/**
 * Validation schema for the unauthenticated AI stage-result webhook. The
 * remainder of the stage payload stays extensible, while every unit map is
 * validated when present. This prevents bad unit keys/types without breaking
 * existing stage-specific AI fields.
 */
export const aiStageResultBodySchema = z.record(z.string(), z.unknown()).superRefine((payload, ctx) => {
  for (const candidate of unitCandidates(payload)) {
    if (Array.isArray(candidate.value)) {
      const result = canonicalUnitsArraySchema.safeParse(candidate.value);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: [candidate.path, ...issue.path],
          message: issue.message,
        });
      }
      continue;
    }
    const result = unitMapSchema.safeParse(candidate.value);
    if (result.success) continue;
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: [candidate.path, ...issue.path],
        message: issue.message,
      });
    }
  }
});
