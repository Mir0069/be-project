/**
 * Frontend mirror of the backend multi-unit contract.
 *
 * Units are keyed A-J and keep their own specifications. Global Stage 2/3
 * values remain valid for older projects where every unit shares one choice.
 */
export const MULTI_UNIT_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
export type MultiUnitKey = (typeof MULTI_UNIT_KEYS)[number];

export const MULTI_UNIT_FRAME_TYPES = [
  "SERIES_2000_RECESSED",
  "SERIES_2000_PEDESTAL",
  "SERIES_1000_PEDESTAL",
  "SERIES_1000_RECESSED",
  "PERIMETER_NON_TB",
  "DECK_PERIMETER",
  "ECONOFRAME",
  "SERIES_3000",
  "SERIES_2000_WITH_PLATE",
  "SERIES_2000_NON_WALKABLE",
  "ROUND_FRAME_42",
  "HORIZONTAL_CAP_SERIES_1000",
  "VERTICAL_CAP_SERIES_1000",
  "MANUAL",
] as const;
export type MultiUnitFrameType = (typeof MULTI_UNIT_FRAME_TYPES)[number];

export const MULTI_UNIT_GLASS_TYPES = [
  "GLASS_NO_IGU",
  "GLASS_WITH_IGU",
  "GLASS_2_0",
  "STAIR_TREAD",
  "NON_WALKABLE",
  "EGR",
] as const;
export type MultiUnitGlassType = (typeof MULTI_UNIT_GLASS_TYPES)[number];

export const MULTI_UNIT_CROSSBEAM_TYPES = [
  "T_SECTION_NTB",
  "T_SECTION_TB",
  "I_BEAM_NTB",
  "I_BEAM_TB",
  "I_BEAM_TB_2000",
  "SERIES_1000_T_SECTION_TB",
  "SERIES_1000_I_BEAM_TB",
  "SERIES_1000_T_SECTION",
  "SERIES_1000_I_BEAM",
  "SERIES_2000_T_SECTION_TB",
  "SERIES_2000_I_BEAM_TB",
  "ECONOFRAME_2_5",
  "ECONOFRAME_3_5",
  "NO_BEAM",
  "MANUAL",
] as const;
export type MultiUnitCrossbeamType = (typeof MULTI_UNIT_CROSSBEAM_TYPES)[number];

export interface MultiUnitFieldMeta {
  value_type?: "text" | "number" | "integer" | "select";
  min?: number;
  max?: number;
  allowed_values?: readonly string[];
  editable?: boolean;
}

export interface MultiUnitRecord {
  unit_id?: string;
  status?: "PENDING" | "SAVED" | "APPROVED" | "NEEDS_REVIEW" | string;
  value_frame_type?: MultiUnitFrameType | null;
  value_glass_type?: MultiUnitGlassType | null;
  value_cross_beam?: MultiUnitCrossbeamType | null;
  value_glass_thickness?: string | null;
  value_location?: string | null;
  value_drawing_number?: string | null;
  value_width_in?: number | null;
  value_length_in?: number | null;
  value_panel_count?: number | null;
  value_num_units?: number | null;
  value_rafter_count?: number | null;
  value_vertical_rafter_count?: number | null;
  value_horizontal_rafter_count?: number | null;
  extracted_frame_type?: MultiUnitFrameType | null;
  extracted_glass_type?: MultiUnitGlassType | null;
  extracted_cross_beam?: MultiUnitCrossbeamType | null;
  cross_beam_confidence?: string | number | null;
  cross_beam_reasoning?: string[];
  cross_beam_citation?: unknown;
  extracted_width_in?: number | null;
  extracted_length_in?: number | null;
  extracted_panel_count?: number | null;
  extracted_rafter_count?: number | null;
  extracted_location?: string | null;
  extracted_dim_type?: "GLASS" | "ROUGH_OPENING" | "UNKNOWN" | null;
  extracted_verbatim?: string | null;
  extracted_citation?: unknown;
  extracted_at?: string | null;
  extracted_confidence?: string | number | null;
  reasoning?: string[];
  flags?: string[];
  [key: string]: unknown;
}

export type MultiUnitMap = Partial<Record<MultiUnitKey, MultiUnitRecord>>;

export interface MultiUnitStageFields {
  units?: MultiUnitMap;
  unit_field_meta?: Record<string, MultiUnitFieldMeta>;
  [key: string]: unknown;
}
