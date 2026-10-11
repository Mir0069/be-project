export type WorkflowStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const STAGE_NAMES: Record<WorkflowStage, string> = {
  1: 'Project Header',
  2: 'Glass Type',
  3: 'Frame Type',
  4: 'Dimensions & Crossbeam',
  5: 'Add-ons & Duty',
  6: 'Excel Generation',
  7: 'Pricing Review',
};

// -----------------------------------------------------------------------------
// DTOs
// -----------------------------------------------------------------------------

export interface StageOverviewItem {
  stage: WorkflowStage;
  stageName: string;
  version: number;
  status: 'PENDING' | 'APPROVED' | 'LOCKED' | 'PENDING_REVIEW' | 'SAVED';
  source: 'AI' | 'ESTIMATOR' | 'SYSTEM';
  parameterCount: number;
  approvedBy: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
}

export interface StagesOverviewResponse {
  stages: StageOverviewItem[];
  allApproved: boolean;
  readyForExcel: boolean;
}

export interface ProposalRevision {
  reason: string;
  revisedBy: string;
  revisedAt: Date;
  revisionNumber: number;
}

export interface StageDetailResponse {
  stage: WorkflowStage;
  status: string;
  fields_to_show: Record<string, unknown>;
  revisions?: ProposalRevision[];
  revision_count?: number;
}

export interface StageSaveResponse {
  stage: WorkflowStage;
  fields_to_show: Record<string, unknown>;
}

export interface StageApproveResponse {
  stage: WorkflowStage;
  status: string;
}

export type TimelineItemStatus = 'COMPLETED' | 'PENDING' | 'NOT_STARTED';

export type TimelineItemSource = 'PROJECT' | 'PROPOSAL_STAGE' | 'NOT_AVAILABLE';

export interface ProposalTimelineItem {
  step: number;
  name: string;
  description: string;
  completedDescription: string;
  status: TimelineItemStatus;
  source: TimelineItemSource;
  sourceStage?: WorkflowStage;
  startedAt?: Date | null;
  updatedAt?: Date | null;
  completedAt?: Date | null;
  waitingSince?: Date | null;
  waitingFor?: string | null;
  waitingDurationSeconds?: number | null;
  isStuck?: boolean;
  events?: ProposalTimelineEvent[];
}

export interface ProposalTimelineResponse {
  projectId: string;
  items: ProposalTimelineItem[];
  completedCount: number;
  currentStep: number | null;
}

export interface ProposalSendReadiness {
  managerApproved: boolean;
  finalOutputReady: boolean;
  finalOutputActioned: boolean;
  sent: boolean;
  canSend: boolean;
  reason: string | null;
}

export type QuotationHistoryStatus = 'GENERATED' | 'APPROVED' | 'ACTIONED' | 'SENT' | 'SUPERSEDED';

export interface QuotationHistoryEvent {
  type: 'GENERATED' | 'MANAGER_APPROVED' | 'FINAL_OUTPUT_ACTIONED' | 'SENT';
  occurredAt: Date;
  actorId?: string | null;
  actorName?: string | null;
}

/**
 * Read-only projection of persisted quote documents and proposal-output
 * lifecycle timestamps. It deliberately does not participate in stage state.
 */
export interface QuotationHistoryItem {
  documentId: string;
  quoteNumber: string | null;
  fileName: string;
  generatedAt: Date;
  generatedBy: string | null;
  amount: number | null;
  status: QuotationHistoryStatus;
  isCurrent: boolean;
  events: QuotationHistoryEvent[];
}

export interface ProposalTimelineEvent {
  label: string;
  occurredAt: Date;
  actorName?: string | null;
  quoteNumber?: string | null;
  amount?: number | null;
}
export interface Stage7Response {
  stage: 7;
  status: string;
  fields_to_show: {
    cost_overrides: Record<string, number>;
    quantity_overrides?: Record<string, number>;
    additional_charge_selections?: Record<string, 'Y' | 'N'>;
    optional_add_on_statuses?: Record<string, 'NOT_SELECTED' | 'SELECTED_PENDING_ACCEPTANCE' | 'ACCEPTED' | 'DECLINED'>;
    computed_snapshot?: {
      subtotal?: number;
      total?: number;
      final_price?: number;
      optional_add_on_total?: number;
      grand_total?: number;
    };
    approved_stages_summary: Record<string, any>;
  };
}

export interface IDomainProposal {
  publicId: string;
  projectId: string;
  schemaVersion: string;
  schema: any; // We will handle it fully via the schema registry
  versions: Record<string, any[]>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDomainExcelTemplate {
  id: string;
  publicId?: string;
  name: string;
  projectId?: string;
  isActive: boolean;
  uploadedBy: string;
  version: string;
  fileSizeBytes?: number;
  fileBuffer?: Buffer;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExcelTemplateUploadResponse {
  success?: boolean;
  publicId?: string;
  name?: string;
  version?: string;
  fileSizeBytes?: number;
}
