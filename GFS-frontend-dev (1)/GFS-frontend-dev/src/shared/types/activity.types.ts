export interface ProjectActivity {

  id: string;

  projectId: string;

  projectName: string;

  activity: string;

  status:
    | "Pending"
    | "Completed"
    | "In-progress"
    | "Not started";

  performedAt: string;

}