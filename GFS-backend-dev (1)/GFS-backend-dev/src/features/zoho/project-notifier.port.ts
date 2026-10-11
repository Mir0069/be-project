export interface ProjectCreatedNotification {
  projectId: string;
  referenceNumber: string;
  projectName: string;
  zohoLeadId: string;
  leadName: string | null;
  leadStatus: string | null;
  creationSource: string;
}

export interface IProjectCreatedNotifier {
  notifyProjectCreated(input: ProjectCreatedNotification): Promise<void>;
}
