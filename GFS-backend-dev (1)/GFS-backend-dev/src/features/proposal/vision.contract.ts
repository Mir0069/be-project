import { z } from 'zod';

/**
 * Vision API JSON contract — backend mirror of the canonical Vision output
 * defined in GFS-AI `extraction/canonical.py` (`CanonicalSignals`).
 *
 * The rules engine reads ONLY from this shape — never from raw document
 * strings. Every vocabulary addition in the Vision prompt that changes the
 * canonical JSON must be reflected here so the webhook keeps validating
 * (and persisting) it instead of silently dropping it.
 *
 * Canonical additions tracked here (GFS-AI commit "updated the prompt and
 * canonical structure"):
 * - glass_signals.product_type
 * - frame_signals.panel_configuration (+ CURB_MOUNTED install_type)
 * - units: rows, columns, vertical_rafter_count, horizontal_rafter_count,
 *   t_rafter_details, layout_source
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Vision confidence: "HIGH" | "MEDIUM" | "LOW" string form or 0-100 numeric form. */
const visionConfidenceSchema = z.union([
  z.enum(['HIGH', 'MEDIUM', 'LOW']),
  z.preprocess(
    (value: unknown) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return value;
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
    },
    z.number().refine(Number.isFinite, 'must be finite').min(0).max(100),
  ),
]);

const nullableText = () =>
  z.preprocess(
    (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().nullable().optional(),
  );

const nullablePage = () =>
  z.preprocess(
    (value: unknown) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : Number(trimmed);
      }
      return value;
    },
    z.number().refine(Number.isFinite, 'must be finite').int().min(1).nullable().optional(),
  );

/**
 * Base shape of every canonical signal (`SignalField` in canonical.py):
 * value + confidence + verbatim + page + reasoning + citation.
 */
const visionSignalBaseSchema = z.object({
  confidence: visionConfidenceSchema.optional(),
  verbatim: nullableText(),
  page: nullablePage(),
  reasoning: nullableText(),
  citation: z.unknown().nullable().optional(),
});

/** Boolean canonical signal: value is true | false | null. */
const visionBoolSignalSchema = visionSignalBaseSchema.extend({
  value: z.boolean().nullable().optional(),
});

/** Enum canonical signal: value is one of the allowed strings (or null). */
const visionEnumSignal = <T extends readonly [string, ...string[]]>(values: T) =>
  visionSignalBaseSchema.extend({
    value: z.preprocess(
      (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value),
      z.enum(values).nullable().optional(),
    ),
  });

/** Free-text canonical signal (addresses, names, ...). */
const visionTextSignalSchema = visionSignalBaseSchema.extend({
  value: nullableText(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Canonical value domains (must stay in sync with canonical.py + Vision prompt)
// ─────────────────────────────────────────────────────────────────────────────

export const VISION_PRODUCT_TYPES = ['GLASS_ONLY', 'SKYLIGHT', 'INTERIOR_FLOOR', 'NOT_STATED'] as const;

export const VISION_FRAME_TYPES_STATED = [
  'ECONOFRAME',
  'SERIES_1000',
  'SERIES_2000',
  'SERIES_3000',
  'PERIMETER_NTB',
  'CAPS',
  'NOT_STATED',
] as const;

export const VISION_INSTALL_TYPES = [
  'PEDESTAL',
  'RECESSED',
  'DECK_PERIMETER',
  'CURB_MOUNTED',
  'NOT_STATED',
] as const;

export const VISION_ASSEMBLY_TYPES = ['FA', 'KD', 'FACTORY_GLAZED', 'FIELD_GLAZED', 'NOT_STATED'] as const;

export const VISION_PANEL_CONFIGURATIONS = ['SINGLE_PANEL', 'MULTI_PANEL', 'NOT_STATED'] as const;

export const VISION_PROJECT_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'NOT_STATED'] as const;

export const VISION_PROJECT_COUNTRIES = ['US', 'CA', 'CANADA', 'NOT_STATED'] as const;

export const VISION_DIMENSION_LABEL_TYPES = [
  'EXPOSED_FRAME',
  'GLASS',
  'ROUGH_OPENING',
  'UNKNOWN',
  'SCALED_FROM_REFERENCE',
  'FRAME_OUTSIDE',
] as const;

export const VISION_SOURCE_TYPES = [
  'lead_sheet',
  'customer_drawings',
  'customer_drawing',
  'engineering_report',
  'mixed',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Signal groups (sparse: Vision omits sections it found nothing for)
// ─────────────────────────────────────────────────────────────────────────────

export const visionHeaderSignalsSchema = z
  .object({
    project_name: visionTextSignalSchema.optional(),
    project_address: visionTextSignalSchema.optional(),
    project_type: visionEnumSignal(VISION_PROJECT_TYPES).optional(),
    architect_name: visionTextSignalSchema.optional(),
    contact_name: visionTextSignalSchema.optional(),
    // Emitted by the text-extraction prompt; absent from canonical.py's
    // HeaderSignals dataclass but accepted here for forward compatibility.
    contact_address: visionTextSignalSchema.optional(),
    contact_phone: visionTextSignalSchema.optional(),
    contact_email: visionTextSignalSchema.optional(),
  })
  .passthrough();

export const visionGlassSignalsSchema = z
  .object({
    is_walkable: visionBoolSignalSchema.optional(),
    is_exterior: visionBoolSignalSchema.optional(),
    has_air_gap: visionBoolSignalSchema.optional(),
    has_conditioned_space_below: visionBoolSignalSchema.optional(),
    has_wine_cellar_below: visionBoolSignalSchema.optional(),
    has_open_space_below: visionBoolSignalSchema.optional(),
    is_stair_tread: visionBoolSignalSchema.optional(),
    is_egr: visionBoolSignalSchema.optional(),
    is_replacement_glass_only: visionBoolSignalSchema.optional(),
    is_glass_2_0: visionBoolSignalSchema.optional(),
    product_type: visionEnumSignal(VISION_PRODUCT_TYPES).optional(),
  })
  .passthrough();

export const visionFrameSignalsSchema = z
  .object({
    frame_type_stated: visionEnumSignal(VISION_FRAME_TYPES_STATED).optional(),
    install_type: visionEnumSignal(VISION_INSTALL_TYPES).optional(),
    assembly_type: visionEnumSignal(VISION_ASSEMBLY_TYPES).optional(),
    is_existing_structure: visionBoolSignalSchema.optional(),
    is_new_deck_construction: visionBoolSignalSchema.optional(),
    panel_configuration: visionEnumSignal(VISION_PANEL_CONFIGURATIONS).optional(),
    is_custom_radius: visionBoolSignalSchema.optional(),
  })
  .passthrough();

export const visionLocationSignalsSchema = z
  .object({
    project_country: visionEnumSignal(VISION_PROJECT_COUNTRIES).optional(),
    project_address: visionTextSignalSchema.optional(),
    is_expedited: visionBoolSignalSchema.optional(),
  })
  .passthrough();

export const visionAddonSignalsSchema = z
  .object({
    has_nanodot: visionBoolSignalSchema.optional(),
    has_seeded_organic: visionBoolSignalSchema.optional(),
    has_krypton: visionBoolSignalSchema.optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Canonical unit — one glass opening (`CanonicalUnit` in canonical.py)
// ─────────────────────────────────────────────────────────────────────────────

const visionNonNegativeNumber = () =>
  z.preprocess(
    (value: unknown) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : Number(trimmed);
      }
      return value;
    },
    z.number().refine(Number.isFinite, 'must be finite').min(0).nullable().optional(),
  );

const visionNonNegativeInteger = () =>
  z.preprocess(
    (value: unknown) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : Number(trimmed);
      }
      return value;
    },
    z.number().refine(Number.isFinite, 'must be finite').int().min(0).nullable().optional(),
  );

export const visionCanonicalUnitSchema = z
  .object({
    unit_label: nullableText(),
    location_description: nullableText(),
    // Prompts emit drawing_number per opening; canonical.py's dataclass does
    // not carry it, but it must survive validation when present.
    drawing_number: nullableText(),
    width_inches: visionNonNegativeNumber(),
    length_inches: visionNonNegativeNumber(),
    panel_count: visionNonNegativeInteger(),
    rafter_count: visionNonNegativeInteger(),
    rows: visionNonNegativeInteger(),
    columns: visionNonNegativeInteger(),
    vertical_rafter_count: visionNonNegativeInteger(),
    horizontal_rafter_count: visionNonNegativeInteger(),
    // Per-unit Crossbeam decisions emitted by the AI worker. The multi-unit
    // stage contract applies the supported Crossbeam enum after this boundary.
    value_cross_beam: nullableText(),
    extracted_cross_beam: nullableText(),
    // Legacy AI aliases are accepted here and emitted under the canonical
    // cross_beam spelling by visionCanonicalUnitsToMap.
    value_crossbeam: nullableText(),
    extracted_crossbeam: nullableText(),
    cross_beam_confidence: visionConfidenceSchema.optional(),
    crossbeam_confidence: visionConfidenceSchema.optional(),
    cross_beam_reasoning: z.union([nullableText(), z.array(z.string())]).optional(),
    crossbeam_reasoning: z.union([nullableText(), z.array(z.string())]).optional(),
    cross_beam_citation: z.unknown().nullable().optional(),
    crossbeam_citation: z.unknown().nullable().optional(),
    t_rafter_details: nullableText(),
    layout_source: nullableText(),
    // Per-unit signal overrides the text prompt may attach.
    is_walkable: z.boolean().nullable().optional(),
    is_exterior: z.boolean().nullable().optional(),
    dimension_label_type: z
      .preprocess(
        (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value),
        z.enum(VISION_DIMENSION_LABEL_TYPES).nullable().optional(),
      ),
    confidence: visionConfidenceSchema.optional(),
    verbatim: nullableText(),
    page: nullablePage(),
    reasoning: nullableText(),
    citation: z.unknown().nullable().optional(),
  })
  .passthrough();

export type VisionCanonicalUnit = z.infer<typeof visionCanonicalUnitSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Top-level canonical payload (`CanonicalSignals` in canonical.py)
// ─────────────────────────────────────────────────────────────────────────────

export const visionPayloadSchema = z
  .object({
    project_id: z.string().nullable().optional(),
    source_file: nullableText(),
    source_type: z
      .preprocess(
        (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value),
        z.enum(VISION_SOURCE_TYPES).nullable().optional(),
      ),
    header_signals: visionHeaderSignalsSchema.optional(),
    glass_signals: visionGlassSignalsSchema.optional(),
    frame_signals: visionFrameSignalsSchema.optional(),
    location_signals: visionLocationSignalsSchema.optional(),
    addon_signals: visionAddonSignalsSchema.optional(),
    explicit_statements: z.array(z.unknown()).optional(),
    units: z.array(visionCanonicalUnitSchema).optional(),
    extraction_timing: z.unknown().nullable().optional(),
  })
  .passthrough();

export type VisionPayload = z.infer<typeof visionPayloadSchema>;

/**
 * Validate a raw Vision API JSON object against the canonical structure.
 * Returns the zod safeParse result so callers can surface issues without
 * throwing. Unknown top-level keys are preserved (passthrough) so prompt
 * additions never hard-fail the pipeline — but mistyped known fields do.
 */
export const validateVisionPayload = (input: unknown) => visionPayloadSchema.safeParse(input);

// ─────────────────────────────────────────────────────────────────────────────
// Canonical units array → backend units map bridge
// ─────────────────────────────────────────────────────────────────────────────

/** Backend unit keys; shared with multi-unit.contract (duplicated to avoid a cycle). */
const BACKEND_UNIT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

/**
 * Convert a canonical Vision `units` array (letters, numbers or missing
 * labels) into the backend `units` map keyed A-J, seeding both the
 * `extracted_*` audit layer and the editable `value_*` layer — the same
 * seeding the GFS-AI `schema_builder` performs.
 *
 * Extra units beyond J are dropped, matching the pipeline's 10-row takeoff.
 */
export const visionCanonicalUnitsToMap = (
  units: VisionCanonicalUnit[],
): Record<string, Record<string, unknown>> => {
  const map: Record<string, Record<string, unknown>> = {};
  let nextIndex = 0;

  for (const unit of units) {
    const label = typeof unit.unit_label === 'string' ? unit.unit_label.trim().toUpperCase() : '';
    let key: string;
    if (/^[A-J]$/.test(label) && !map[label]) {
      key = label;
    } else {
      while (nextIndex < BACKEND_UNIT_KEYS.length && map[BACKEND_UNIT_KEYS[nextIndex] as string]) {
        nextIndex += 1;
      }
      if (nextIndex >= BACKEND_UNIT_KEYS.length) break;
      key = BACKEND_UNIT_KEYS[nextIndex] as string;
      nextIndex += 1;
    }

    const record: Record<string, unknown> = {
      unit_id: key,
      // AI internal descriptive label (e.g. "SK-1", "Skylight assembly 1").
      // The map key stays the A-J takeoff identity; this is match/display context.
      unit_label: unit.unit_label ?? null,
      extracted_width_in: unit.width_inches ?? null,
      extracted_length_in: unit.length_inches ?? null,
      extracted_panel_count: unit.panel_count ?? null,
      extracted_rafter_count: unit.rafter_count ?? null,
      extracted_vertical_rafter_count: unit.vertical_rafter_count ?? null,
      extracted_horizontal_rafter_count: unit.horizontal_rafter_count ?? null,
      extracted_cross_beam: unit.extracted_cross_beam ?? unit.extracted_crossbeam ?? unit.value_cross_beam ?? unit.value_crossbeam ?? null,
      extracted_rows: unit.rows ?? null,
      extracted_columns: unit.columns ?? null,
      extracted_t_rafter_details: unit.t_rafter_details ?? null,
      extracted_layout_source: unit.layout_source ?? null,
      extracted_location: unit.location_description ?? null,
      extracted_dim_type: unit.dimension_label_type ?? null,
      extracted_verbatim: unit.verbatim ?? null,
      extracted_citation: unit.citation ?? null,
      extracted_confidence: unit.confidence ?? null,
      cross_beam_confidence: unit.cross_beam_confidence ?? unit.crossbeam_confidence ?? unit.confidence ?? null,
      cross_beam_reasoning: unit.cross_beam_reasoning ?? unit.crossbeam_reasoning ?? null,
      cross_beam_citation: unit.cross_beam_citation ?? unit.crossbeam_citation ?? null,
      value_width_in: unit.width_inches ?? null,
      value_length_in: unit.length_inches ?? null,
      value_panel_count: unit.panel_count ?? null,
      value_rafter_count: unit.rafter_count ?? null,
      value_vertical_rafter_count: unit.vertical_rafter_count ?? null,
      value_horizontal_rafter_count: unit.horizontal_rafter_count ?? null,
      value_cross_beam: unit.value_cross_beam ?? unit.value_crossbeam ?? unit.extracted_cross_beam ?? unit.extracted_crossbeam ?? null,
      value_rows: unit.rows ?? null,
      value_columns: unit.columns ?? null,
      value_t_rafter_details: unit.t_rafter_details ?? null,
      value_layout_source: unit.layout_source ?? null,
      value_location: unit.location_description ?? null,
    };
    if (unit.drawing_number !== undefined && unit.drawing_number !== null) {
      record['value_drawing_number'] = unit.drawing_number;
    }
    if (typeof unit.reasoning === 'string' && unit.reasoning.trim() !== '') {
      record['reasoning'] = [unit.reasoning];
    }
    map[key] = record;
  }

  return map;
};
