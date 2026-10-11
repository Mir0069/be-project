import { getEstimatorProjects } from "@/utils/estimator-projects";

import { generateEstimatorTasks } from "@/utils/estimator-task-generator";

const projects = getEstimatorProjects();

export const myTasks =
  generateEstimatorTasks(projects);