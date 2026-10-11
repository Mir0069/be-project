export interface EstimatorTask {
  id: string;

  title: string;

  projectCode: string;

  projectName: string;

  status: string;

  action: string;
}

export interface DashboardActivity {
  id: string;

  projectName: string;

  projectCode: string;

  action: string;

  status: string;

  date: string;
}