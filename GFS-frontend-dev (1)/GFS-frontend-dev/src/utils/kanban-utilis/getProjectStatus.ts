import type { KanbanStatus } from "@/features/kanban/types/kanban.types";

export const getProjectStatus = (
  stage: string,
  activityDate: Date
): KanbanStatus => {

  if (stage === "Delivered" || stage === "Approval" ) {
    return "completed";
  }

  const now =
    new Date();

  const diffDays =
    Math.floor(
      (
        now.getTime() -
        activityDate.getTime()
      ) /
      (1000 * 60 * 60 * 24)
    );

  // 0-1 days
  if (diffDays <= 1) {
    return "active";
  }

  // 2-10 days
  if (diffDays <= 10) {
    return "waiting";
  }

  // >10 days
  return "stalled";
};