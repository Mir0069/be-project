// =============================================================================
// PROPOSAL MODEL
//
// Single document representing an entire project's proposal state.
// Uses a fully schema-driven architecture based on Unified Schema v4 (MD §4).
//
// OPTIMISTIC CONCURRENCY:
//   Mongoose optimisticConcurrency: true is enabled to prevent concurrent saves.
// =============================================================================

import mongoose, { Schema, model, HydratedDocument } from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// TYPESCRIPT INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalFieldValueType = 'text' | 'number' | 'integer' | 'select' | 'yn' | 'calculated';

export const FIELD_FEEDBACK_REASONS = [
  'AI_READ_IT_WRONG',
  'WRONG_SOURCE',
  'CLIENT_CHANGED_SPEC',
  'COMPANY_STANDARD',
  'OTHER',
] as const;

export type OptionalAddOnStatus =
  | 'NOT_SELECTED'
  | 'SELECTED_PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'DECLINED';

export type FieldFeedbackReason = (typeof FIELD_FEEDBACK_REASONS)[number];

/** Max entries kept per field, oldest dropped first. */
export const MAX_FEEDBACK_PER_FIELD = 20;

/**
 * Why an estimator overrode an AI-produced value. Collected during beta and
 * exported to train extraction.
 *
 * No key may be named `status`: approveStage/unapproveStage recurse through the
 * schema rewriting every `status` they find, and would corrupt these entries.
 * `created_at` is an ISO string because applyPatches round-trips the schema
 * through JSON, which turns Dates into strings anyway.
 */
export interface IFieldFeedbackEntry {
  reason_code: FieldFeedbackReason;
  note: string | null;
  previous_value: unknown;
  new_value: unknown;
  ai_reasoning: string[] | null;
  ai_confidence: string | null;
  author_id: string;
  author_role: string;
  stage: number;
  created_at: string;
  /** Takeoff rows only: which columns changed in the edit this entry covers. */
  changed_columns?: string[];
}

export interface IFieldMeta {
  excel_cell?: string;
  excel_trigger?: boolean;
  manual: boolean;
  // The API exposes the intended editor type so clients do not infer it from a null value.
  value_type?: ProposalFieldValueType;
  editable?: boolean;
  min?: number;
  max?: number;
  allowed_values?: readonly string[];
  note?: string;
    /**
   * Set when a human typed this value (any role that may edit a proposal:
   * estimator, sales manager, system/super admin). An AI stage run must never
   * overwrite a field carrying this marker, because "revise stage" clears the
   * APPROVED status the merge used to key on, leaving the human's answer
   * unprotected on the very next re-run. Only a stage-0 re-extraction, which
   * means the source documents themselves changed, may move the value, and it
   * clears the marker when it does.
   */
  human_override?: boolean;
  human_override_at?: string;
  human_override_by?: string;
  /**
   * Unit take-off rows are one flat node per unit (value_width_in,
   * value_description, ...) rather than one IBaseField per field, so
   * `human_override` alone would protect the whole unit from every future AI
   * write — including AI-only fields like value_description/value_man_hours
   * that the estimator never touched. Lists exactly which field names on this
   * unit a human edited; deepMergeSchema (proposal.service.ts) holds only
   * these and still lets AI stage runs write everything else on the unit.
   * Only meaningful on a unit node — standard IBaseField nodes rely on
   * `human_override` alone, since `value`/`reasoning`/etc. already share one
   * node per field.
   */
  human_override_fields?: string[];
}

export interface IBaseField<T = unknown> {
  _meta?: IFieldMeta;
  extracted_value?: T | null;
  extracted_confidence?: string | null;
  extracted_verbatim?: string | null;
  extracted_citation?: string | null;
  extracted_at?: Date | null;
  value: T | null;
  confidence?: string | null;
  reasoning?: string[];
  flags?: string[];
  updated_at?: Date | null;
  updated_by?: string | null;
  // NEEDS_REVIEW: estimator had approved this value, then a later AI rules
  // pass changed it underneath — UI must surface it distinctly (MD §4.1).
  status: 'PENDING' | 'SAVED' | 'APPROVED' | 'NEEDS_REVIEW';
  _feedback?: IFieldFeedbackEntry[];
}

export interface IUnitField {
  _meta?: IFieldMeta;
  unit_id: string;
  status: 'PENDING' | 'SAVED' | 'APPROVED' | 'NEEDS_REVIEW';
  /** AI internal descriptive label (e.g. "SK-1"). Display uses value_location. */
  unit_label?: string | null;
  /** Unit-specific selections. Global stage_2/stage_3 values remain supported
   * for legacy projects where every unit shares the same specification. */
  value_frame_type?: string | null;
  value_glass_type?: string | null;
  extracted_width_in?: number | null;
  extracted_length_in?: number | null;
  extracted_panel_count?: number | null;
  extracted_rafter_count?: number | null;
  extracted_vertical_rafter_count?: number | null;
  extracted_horizontal_rafter_count?: number | null;
  extracted_rows?: number | null;
  extracted_columns?: number | null;
  extracted_t_rafter_details?: string | null;
  extracted_layout_source?: string | null;
  extracted_verbatim?: string | null;
  extracted_citation?: string | null;
  extracted_at?: Date | null;
  /** 0-1 ratio from the AI (0.94) or legacy 0-100 (94); normalized to 0-1
   * at the contract boundary, stored here verbatim for audit. */
  extracted_confidence?: string | number | null;
  extracted_location?: string | null;
  extracted_dim_type?: 'GLASS' | 'ROUGH_OPENING' | 'UNKNOWN' | 'EXPOSED_FRAME' | 'SCALED_FROM_REFERENCE' | 'FRAME_OUTSIDE' | null;
  value_width_in: number | null;
  value_length_in: number | null;
  value_panel_count: number | null;
  value_rafter_count: number | null;
  value_vertical_rafter_count?: number | null;
  value_horizontal_rafter_count?: number | null;
  value_rows?: number | null;
  value_columns?: number | null;
  /** AI wire alias for value_columns — mirrored at the contract boundary. */
  value_cols?: number | null;
  /** True when rows×cols is a confirmed real 2D layout. */
  value_is_grid_confirmed?: boolean | null;
  value_t_rafter_details?: string | null;
  value_layout_source?: string | null;
  value_man_hours?: number | null;
  value_packaging?: number | null;
  /** Customer-facing proposal line for this unit (Proposal sheet J23:J32).
   * AI Stage 5 generates it; an estimator edit in Edit Draft replaces it. */
  value_description?: string | null;
  generated_desc_at?: string | null;
  /** Tells AI Stage 5 to stop regenerating value_description. */
  description_manually_edited?: boolean;
  value_num_units: number | null;
  value_location: string | null;
  value_drawing_number?: string | null;
  // AI v4 wire name for the same drawing number (MD §4.3). Readers accept
  // both; the backend canonical name stays value_drawing_number.
  value_drawing_no?: string | null;
  extracted_drawing_no?: string | null;
  value_glass_thickness?: string | null;
  // Per-unit spec decisions (new in AI schema v4, MD §4.3). Null = fall back
  // to the project-level stage_2/3/4 decision; set = this location's own spec.
  extracted_glass_type?: string | null;
  extracted_glass_thickness?: string | null;
  glass_type_confidence?: number | string | null;
  extracted_frame_type?: string | null;
  frame_type_confidence?: number | string | null;
  extracted_cross_beam?: string | null;
  value_cross_beam?: string | null;
  cross_beam_confidence?: number | string | null;
  cross_beam_reasoning?: string[];
  cross_beam_citation?: unknown;
  reasoning?: string[];
  flags?: string[];
  updated_at?: Date | null;
  updated_by?: string | null;
  _feedback?: IFieldFeedbackEntry[];

  excel_takeoff_row?: number;
  excel_width_cell?: string;
  excel_length_cell?: string;
  excel_panel_cell?: string;
  excel_location_cell?: string;
  excel_drawing_cell?: string;
  excel_num_units_cell?: string;
  excel_vert_rafter_cell?: string;
  excel_horiz_rafter_cell?: string;
  excel_glass_thickness_cell?: string;
  excel_glass_trigger_cell?: string;
  excel_frame_trigger_cell?: string | null;
  excel_beam_trigger_cell?: string | null;
  excel_hst_trigger_cell?: string;
  excel_nanodot_trigger_cell?: string;
  excel_seeded_trigger_cell?: string;
}

export interface IProjectSchema {
  stage_1: {
    project_name: IBaseField<string>;
    project_address: IBaseField<string>;
    contact_name: IBaseField<string>;
    contact_address: IBaseField<string>;
    contact_phone: IBaseField<string>;
    contact_email: IBaseField<string>;
    project_type: IBaseField<'RESIDENTIAL' | 'COMMERCIAL'>;
    architect: IBaseField<string>;
    homeowner: IBaseField<string>;
    drafter_designer: IBaseField<string>;
    quote_number?: IBaseField<string>;
    person_quoting: IBaseField<string>;
    person_checked: IBaseField<string>;
  };
  stage_2: {
    _signals: Record<string, IBaseField<boolean>>;
    glass_type: IBaseField<string>;
  };
  stage_3: {
    _signals: Record<string, IBaseField<unknown>>;
    decision: {
      frame_type: IBaseField<string>;
      proposal_number: IBaseField<number>;
      proposal_description: IBaseField<string>;
      assembly_type: IBaseField<string>;
    };
  };
  stage_4: {
    crossbeam: IBaseField<string>;
    takeoff: {
      panel_count: IBaseField<number>;
      packaging: IBaseField<number>;
    };
  };
  stage_5: {
    _signals: Record<string, IBaseField<unknown>>;
    addons: {
      duty: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      heat_soak_testing: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      nanodot: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      seeded_organic: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      sentry_glass: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      krypton_gas: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      custom_shape: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      backpaint: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
      three_m_tape?: IBaseField<'y' | 'n' | 'MANUAL' | 'PENDING'>;
    };
    calculated: {
      total_sqft: IBaseField<number>;
      total_weight: IBaseField<number>;
      perimeter_lf: IBaseField<number>;
      silicone_tubes: IBaseField<number>;
      total_man_hours: IBaseField<number>;
      total_packaging: IBaseField<number>;
    };
  };
  units: Record<string, IUnitField>; // keys A through J
  stage_6?: {
    cells: Record<string, string | number>;
    status: 'READY_FOR_EXCEL' | 'PENDING' | 'ERROR';
  };
  stage_7?: {
    status: 'PENDING' | 'READY' | 'APPROVED';
    cost_overrides: {
      [cellAddress: string]: number;
    };
    quantity_overrides?: {
      [cellAddress: string]: number;
    };
    additional_charge_selections?: {
      [cellAddress: string]: 'Y' | 'N';
    };
    optional_add_on_statuses?: {
      [cellAddress: string]: OptionalAddOnStatus;
    };
    cost_feedback?: {
      [cellAddress: string]: IFieldFeedbackEntry[];
    };
    computed_snapshot?: {
      subtotal?: number;
      total?: number;
      final_price?: number;
      optional_add_on_total?: number;
      grand_total?: number;
    };
    updated_at?: Date;
    updated_by?: string;
    approval?: {
      approverId?: string | null;
      approverName?: string | null;
      approverEmail?: string | null;
      assignedBy?: string | null;
      assignedAt?: Date | null;
      approvedBy?: string | null;
      approvedByName?: string | null;
      approvedAt?: Date | null;
      priceAtAssignment?: number | null;
    };
  };
  stage_6_proposal?: {
    target_sheet: string;
    cells: Record<string, string | number | null>;
    status: 'READY_FOR_PROPOSAL_EXCEL' | 'PENDING' | 'ERROR';
    updated_at?: Date;
    // These timestamps make the final-output handoff explicit. They are reset
    // whenever the proposal content is regenerated or edited.
    output_action_at?: Date;
    output_action_by?: string;
    sent_at?: Date;
    sent_by?: string;
  };
  pipeline_status: {
    extraction_complete: boolean;
    extraction_at: Date | null;
    stage_1_status: 'LOCKED' | 'PENDING' | 'APPROVED';
    stage_2_status: 'LOCKED' | 'PENDING' | 'APPROVED';
    stage_3_status: 'LOCKED' | 'PENDING' | 'APPROVED';
    stage_4_status: 'LOCKED' | 'PENDING' | 'APPROVED';
    stage_5_status: 'LOCKED' | 'PENDING' | 'APPROVED';
    stage_6_status: 'LOCKED' | 'PENDING' | 'APPROVED';
    stage_7_status: 'LOCKED' | 'PENDING' | 'APPROVED';
  };
}

export type WorkflowStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface IProjectVersion {
  timestamp: Date;
  source: 'AI' | 'ESTIMATOR';
  updatedBy: string;
  snapshot: any;
}

export interface IRevision {
  reason: string;
  revisedBy: string;
  revisedAt: Date;
  revisionNumber: number;
}

export interface IProposalDoc {
  publicId: string;
  projectId: mongoose.Types.ObjectId;
  schemaVersion: 'v3' | 'v4';
  schema: IProjectSchema;
  versions: {
    stage_0: IProjectVersion[];
    stage_1: IProjectVersion[];
    stage_2: IProjectVersion[];
    stage_3: IProjectVersion[];
    stage_4: IProjectVersion[];
    stage_5: IProjectVersion[];
    stage_6: IProjectVersion[];
    stage_6_proposal: IProjectVersion[]; 
    stage_7: IProjectVersion[];
  };
  revisions: {
    stage_0: IRevision[];
    stage_1: IRevision[];
    stage_2: IRevision[];
    stage_3: IRevision[];
    stage_4: IRevision[];
    stage_5: IRevision[];
    stage_6: IRevision[];
    stage_7: IRevision[];
  };
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGOOSE SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

const ProjectVersionSchema = new Schema<IProjectVersion>({
  timestamp: { type: Date, required: true, default: Date.now },
  source: { type: String, enum: ['AI', 'ESTIMATOR'], required: true },
  updatedBy: { type: String, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true }
}, { _id: false });

const VersionsSchema = new Schema({
  stage_0: { type: [ProjectVersionSchema], default: [] },
  stage_1: { type: [ProjectVersionSchema], default: [] },
  stage_2: { type: [ProjectVersionSchema], default: [] },
  stage_3: { type: [ProjectVersionSchema], default: [] },
  stage_4: { type: [ProjectVersionSchema], default: [] },
  stage_5: { type: [ProjectVersionSchema], default: [] },
  stage_6: { type: [ProjectVersionSchema], default: [] },
  stage_6_proposal: { type: [ProjectVersionSchema], default: [] }, // NEW
  stage_7: { type: [ProjectVersionSchema], default: [] }
}, { _id: false });

const RevisionSchema = new Schema<IRevision>({
  reason: { type: String, default: '' },
  revisedBy: { type: String, required: true },
  revisedAt: { type: Date, required: true, default: Date.now },
  revisionNumber: { type: Number, required: true }
}, { _id: false });

const RevisionsSchema = new Schema({
  stage_0: { type: [RevisionSchema], default: [] },
  stage_1: { type: [RevisionSchema], default: [] },
  stage_2: { type: [RevisionSchema], default: [] },
  stage_3: { type: [RevisionSchema], default: [] },
  stage_4: { type: [RevisionSchema], default: [] },
  stage_5: { type: [RevisionSchema], default: [] },
  stage_6: { type: [RevisionSchema], default: [] },
  stage_7: { type: [RevisionSchema], default: [] }
}, { _id: false });

const ProposalMongooseSchema = new Schema<IProposalDoc>(
  {
    publicId: { type: String, required: true, unique: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    schemaVersion: { type: String, required: true, default: 'v4' },
    schema: { type: Schema.Types.Mixed, required: true }, // We use Mixed due to deeply nested generic nature
    versions: { type: VersionsSchema, default: () => ({}) },
    revisions: { type: RevisionsSchema, default: () => ({}) }
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

ProposalMongooseSchema.index({ projectId: 1 }, { unique: true });

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const ProposalModel = model<IProposalDoc>('Proposal', ProposalMongooseSchema);
export type ProposalDocument = HydratedDocument<IProposalDoc>;
