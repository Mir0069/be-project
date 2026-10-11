import { getEstimatorProjects } from "@/utils/estimator-projects";

import { generateEstimatorActivities } from "@/utils/estimator-activity-generator";

const projects = getEstimatorProjects();

export const recentActivities =
  generateEstimatorActivities(projects);