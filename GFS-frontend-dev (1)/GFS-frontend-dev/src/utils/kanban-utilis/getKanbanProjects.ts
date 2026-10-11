import { getEstimatorProjects } from "@/utils/estimator-projects";

import { ACTION_STAGE_MAP } from "@/features/kanban/constants/kanban.constants";

import type { KanbanProjectCard } from "@/features/kanban/types/kanban.types";

import { formatLastActivity } from "./formatLastActivity";

import { generateRandomLastActivity } from "./generateRandomLastActivity";

import { getProjectStatus } from "./getProjectStatus";

export const getKanbanProjects = (): KanbanProjectCard[] => {
  const projects = getEstimatorProjects();

  return projects.map((project: any) => {
    const details = project?.formData?.projectDetails;

    const assignments = project?.formData?.assignments || [];

    const action = details?.action || "Requirements";

    // const currentStage = ACTION_STAGE_MAP[action] || "Project Setup";
    const currentStage = action;

    const activityDate = generateRandomLastActivity();

    const status = getProjectStatus(currentStage, activityDate);

    return {
      projectId: details?.projectId,

      projectName: details?.projectName,

      estimators: assignments.map((a: any) => a.name),

      currentAction: action,

      currentStage,

      status,

      lastActivityAt: formatLastActivity(activityDate, status),
    };
  });
};
