// shared/types/project.types.ts

export type ProjectStatus =
  | "Pending"
  | "Input Pending"
  | "AI Extraction In Progress"
  | "Ready for Estimation"
  | "Needs Revision"
  | "Completed"
  | "In-progress"
  | "Not started";

export type ImportedSource = "zoho" | "outlook" | "teams" | "calls";

export type Project = {
  id: string;
  projectCode: string;
  referenceNumber?: string;

  // About
  projectName: string;
  projectType: string;
  dueDate: string;
  projectAddress: string;

  // Client & Contacts
  customerName: string;
  poc: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;

  // Stakeholders
  architect: string;
  homeowner: string;
  drafter: string;

  // Notes
  projectNotes: string;

  // Workflow
  status: ProjectStatus;
  revisionRequest?: {
    stage: number;
    reason: string | null;
    requestedBy: string;
    requestedAt: string;
  } | null;
  assignedEstimators: { id: string; name: string; email: string; status?: string }[];

  // Source tracking (if created from a Zoho lead import)
  zohoLeadId: string | null;
  importedSources: ImportedSource[];

  // Audit
  createdAt: string;
  lastUpdate: string;
};

// Form payload — what the Create Project form submits.
// Server fills in id, projectCode, status, assignedEstimators, audit, source.
export type CreateProjectInput = Omit<
  Project,
  | "id"
  | "projectCode"
  | "status"
  | "assignedEstimators"
  | "createdAt"
  | "lastUpdate"
  | "zohoLeadId"
  | "importedSources"
> & {
  zohoLeadId?: string | null;
  importedSources?: ImportedSource[];
  assignedEstimatorIds?: string[];
};

export type UpdateProjectEstimatorsInput = {
  id: string;
  estimatorIds: string[];
};
