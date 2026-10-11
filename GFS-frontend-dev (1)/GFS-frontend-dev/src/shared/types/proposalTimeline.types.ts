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
  events?: ProposalTimelineEvent[];
}

export interface ProposalTimelineEvent {
  label: string;
  occurredAt: string;
  actorName?: string | null;
  quoteNumber?: string | null;
  amount?: number | null;
}

export interface ProposalTimelineResponse {
  projectId: string;
  items: ProposalTimelineItem[];
  completedCount: number;
  currentStep: number | null;
}
