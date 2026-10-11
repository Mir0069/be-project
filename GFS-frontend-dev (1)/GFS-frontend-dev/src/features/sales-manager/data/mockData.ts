// pages/sales-manager/mockData.ts
// Static placeholder data for UI-only mocks (dashboard activities, estimator
// directory, project type options).
//
// Project records and the Zoho leads list live in dedicated services
// (src/services/projects.ts, src/services/zoho.ts) so the backend swap stays
// mechanical when those APIs land.

import type { ProjectStatus } from "@/shared/types/project.types";

export type DashboardActivity = {
  id: string;
  projectName: string;
  projectCode: string;
  action: string;
  status: ProjectStatus;
  date: string;
};

export const recentActivities: DashboardActivity[] = [

  {

    id: "sma-1",

    projectName:
      "Seattle Crystal Tower",

    projectCode:
      "PRJ-0112",

    action:
      "Proposal Review",

    status:
      "Completed",

    date:
      "2 hours ago",

  },

  {

    id: "sma-2",

    projectName:
      "New York Skyline Staircase",

    projectCode:
      "PRJ-0088",

    action:
      "AI Analysis",

    status:
      "In-progress",

    date:
      "Yesterday, 4:30 PM",

  },

  {

    id: "sma-3",

    projectName:
      "Luxury Residential Glass Villa",

    projectCode:
      "PRJ-0095",

    action:
      "BOM & Pricing",

    status:
      "In-progress",

    date:
      "Yesterday, 11:20 AM",

  },

];

export const projectTypeOptions = [
  { value: "", label: "Select Project Type" },
  { value: "NEW_ESTIMATE", label: "New Estimate" },
  { value: "RE_QUOTE", label: "Re-Quote" },
  { value: "VARIATION", label: "Variation" },
];



export type Estimator = {
  id: string;
  name: string;
  email: string;
  activeProjects: number;
  specialty: string;
};

export const estimators: Estimator[] = [
  {
    id: "e-1",
    name: "Estimator User",
    email: "estimator@gfs.com",
    activeProjects: 3,
    specialty: "Glass Bridges",
  },
  {
    id: "e-2",
    name: "Sara Lin",
    email: "sara.lin@gfs.com",
    activeProjects: 2,
    specialty: "Glass Flooring",
  },
  {
    id: "e-3",
    name: "Aiden Ross",
    email: "aiden.ross@gfs.com",
    activeProjects: 1,
    specialty: "Glass Stairs",
  },
  {
    id: "e-4",
    name: "Priya Shah",
    email: "priya.shah@gfs.com",
    activeProjects: 4,
    specialty: "Custom Projects",
  },
];
