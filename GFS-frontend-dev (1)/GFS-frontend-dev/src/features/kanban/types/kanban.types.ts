export type KanbanStage =
  | "Requirements"
  | "Approve Requirements"
  | "Draft Proposal"
  | "Review Proposal & Approval"
  | "Proposal Sent/Submitted"
  | "Resubmit Proposal";

export type KanbanStatus = "active" | "waiting" | "stalled" | "completed";

export type KanbanProjectCard = {
  projectId: string;

  projectName: string;

  estimators: string[];

  currentAction: string;

  currentStage: KanbanStage;

  status: KanbanStatus;

  lastActivityAt: string;
};
