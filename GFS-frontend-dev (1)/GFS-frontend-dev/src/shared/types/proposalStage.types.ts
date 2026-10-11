// Proposal stage field — matches backend snake_case contract
export type ProposalFieldValueType =
  | "text"
  | "number"
  | "integer"
  | "select"
  | "yn"
  | "calculated";

export interface ProposalFieldMeta {
  manual?: boolean;
  editable?: boolean;
  value_type?: ProposalFieldValueType;
  min?: number;
  max?: number;
  allowed_values?: unknown[];
  note?: string;
  excel_cell?: string;
}

export interface ProposalStageField {
  value: unknown; // Can be string, number, null, or a nested object/array depending on the stage
  confidence?: number | string | null;
  extracted_confidence?: number | string | null;
  status?: string | null;
  updated_by?: string | null;
  reasoning?: string | string[] | null;
  citation?: unknown;
  allowed_values?: unknown[];
  _meta?: ProposalFieldMeta;
}

// Revision record from GET /proposals/:projectId/stages/:stage
export interface ProposalRevision {
  reason: string;
  revisedBy: string;
  revisedAt: string;
  revisionNumber: number;
}

// Full stage response from GET /proposals/:projectId/stages/:stage
export interface ProposalStage {
  stage: number;
  status: string;
  fields_to_show: Record<string, ProposalStageField>;
  meta?: Record<string, any>;
  revisions?: ProposalRevision[];
  revision_count?: number;
}

export type TimelineItemStatus = "COMPLETED" | "PENDING" | "NOT_STARTED";

export type TimelineItemSource = "PROJECT" | "PROPOSAL_STAGE" | "NOT_AVAILABLE";

export interface ProposalTimelineItem {
  step: number;
  name: string;
  description: string;
  completedDescription: string;
  status: TimelineItemStatus;
  source: TimelineItemSource;
  sourceStage?: number;
  startedAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  waitingSince?: string | null;
  waitingFor?: string | null;
  waitingDurationSeconds?: number | null;
  isStuck?: boolean;
}

export interface ProposalTimeline {
  projectId: string;
  items: ProposalTimelineItem[];
  completedCount: number;
  currentStep: number | null;
}
