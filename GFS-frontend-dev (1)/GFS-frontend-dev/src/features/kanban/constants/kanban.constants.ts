import type { KanbanStage } from "../types/kanban.types";

export const ACTION_STAGE_MAP: Record<string, KanbanStage> = {
  "Project Created": "Project Setup",

  "Document Ingestion": "Project Setup",

  "AI Analysis": "Analysis & Configuration",

  "Parameter Setting": "Analysis & Configuration",

  "BOM & Pricing": "Estimation",

  "Pricing Evaluation": "Estimation",

  "Proposal Generation": "Proposal Preparation",

  "Proposal Review": "Proposal Preparation",

  "Proposal Regeneration": "Proposal Preparation",

  "Proposal Approval": "Approval",

  "Proposal Delivery": "Proposal Sent/Submitted",
};

export const KANBAN_STAGES: KanbanStage[] = [
  "Requirements",
  "Approve Requirements",
  "Draft Proposal",
  "Review Proposal & Approval",
  "Proposal Sent/Submitted",
  "Resubmit Proposal",
];

// Project workflow statuses are owned by the backend. This mapping only
// controls where each real project appears on the read-only Kanban board.
export const PROJECT_STATUS_TO_KANBAN_STAGE: Record<string, KanbanStage> = {
  SETUP_PENDING: "Requirements",
  WAITING_FOR_INPUTS: "Approve Requirements",
  READY_FOR_ESTIMATOR: "Draft Proposal",
  ESTIMATOR_DRAFTING: "Review Proposal & Approval",
  ESTIMATOR_FINAL: "Proposal Sent/Submitted",
  ADMIN_PACKAGING: "Resubmit Proposal",
  NEEDS_REVISION: "Resubmit Proposal",
};
