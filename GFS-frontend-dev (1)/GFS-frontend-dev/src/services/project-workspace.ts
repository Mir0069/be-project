// services/project-workspace.ts
// Wraps GET /project-workspace — the canonical projects list endpoint.

import { apiClient } from "@/shared/api/client";

export type ProjectAnalysisStatus = "NOT_STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApiProjectAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  country: string | null;
}

export interface ApiProjectRevisionRequest {
  stage: number;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
}

export interface ApiProject {
  id: string;
  referenceNumber: string;
  blobStorageURL: string;
  projectName: string;
  customerName: string;
  status: string;
  analysisStatus?: ProjectAnalysisStatus;
  projectType: string;
  creationSource: string | null;
  identifierHash: string | null;
  zohoLeadId: string | null;
  jobAddress: string | null;
  quoteNumber: string | null;
  leadStatus: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  company: string | null;
  customerWebsite: string | null;
  description: string | null;
  receivedDate: string | null;
  address: ApiProjectAddress | null;
  assignedEstimatorId?: string | null;
  assignedEstimators?: Array<{
    id: string;
    name: string;
    email: string | null;
  }>;
  estimatorName: string | null;
  estimatorEmail: string | null;
  estimatorPhone: string | null;
  lastZohoSyncedAt: string | null;
  dueDate: string | null;
  estimatedCost: number | null;
  totalSqFt: number | null;
  revisionRequest?: ApiProjectRevisionRequest | null;
  isActive: boolean;
  missingDocuments?: boolean;
  templateNotSelected?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalContact {
  email: string;
  name?: string | null;
  sources: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface ExternalContactsResponse {
  contacts: ExternalContact[];
  total: number;
}

export interface ApiProjectsResponse {
  data: ApiProject[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProjectWorkspaceParams {
  page?: number;
  limit?: number;
  search?: string;
  statusCategory?: "NOT_STARTED" | "PENDING" | "AI_PROCESSING" | "READY_FOR_ESTIMATOR" | "IN_PROGRESS" | "NEEDS_REVISION" | "COMPLETED";
  updatedAfter?: string;
  sortBy?: "createdAt" | "updatedAt" | "dueDate" | "projectName" | "customerName";
  sortOrder?: "asc" | "desc";
}

// ─── Service ─────────────────────────────────────────────────────────────────

/** GET /project-workspace — paginated project list */
export const fetchProjectWorkspace = async (
  params: ProjectWorkspaceParams = {}
): Promise<ApiProjectsResponse> => {
  const { data } = await apiClient.get<{ success: boolean; data: ApiProjectsResponse }>(
    "/project-workspace",
    { params }
  );
  return data.data;
};
/** GET /project-workspace/:id — single project detail */
export const fetchProjectDetail = async (id: string): Promise<ApiProject> => {
  const { data } = await apiClient.get<{ success: boolean; data: ApiProject }>(
    `/project-workspace/${encodeURIComponent(id)}`
  );
  return data.data;
};

/** Managers set the delivery commitment after a project arrives in GFS. */
export const updateProjectDueDate = async (
  id: string,
  dueDate: string,
): Promise<ApiProject> => {
  const { data } = await apiClient.put<{ success: boolean; data: ApiProject }>(
    `/project-workspace/${encodeURIComponent(id)}`,
    { dueDate },
  );
  return data.data;
};

/** GET /project-workspace/:id/external-contacts — read-only linked contacts. */
export const fetchExternalContacts = async (
  id: string,
): Promise<ExternalContactsResponse> => {
  const { data } = await apiClient.get<{
    success: boolean;
    data: ExternalContactsResponse;
  }>(`/project-workspace/${encodeURIComponent(id)}/external-contacts`);
  return data.data;
};
