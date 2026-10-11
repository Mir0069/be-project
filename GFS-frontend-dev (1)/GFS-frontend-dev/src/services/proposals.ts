import { apiClient } from "@/shared/api/client";
import type { FieldFeedbackInput } from "@/shared/types/fieldFeedback.types";
import type { ProposalStage } from "@/shared/types/proposalStage.types";
import type { ProposalTimelineResponse } from "@/shared/types/proposalTimeline.types";

export const fetchProposalStage = async (
  projectId: string,
  stage: number
): Promise<ProposalStage> => {
  const { data } = await apiClient.get<ProposalStage | { data: ProposalStage }>(
    `/proposals/${projectId}/stages/${stage}`
  );

  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }

  return data;
};

export const fetchProposalTimeline = async (
  projectId: string
): Promise<ProposalTimelineResponse> => {
  const { data } = await apiClient.get<
    ProposalTimelineResponse | { data: ProposalTimelineResponse }
  >(`/proposals/${projectId}/timeline`);

  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }

  return data;
};

export const approveProposalStage = async (
  projectId: string,
  stage: number
): Promise<void> => {
  await apiClient.post(`/proposals/${projectId}/stages/${stage}/approve`, {});
};

export const unapproveProposalStage = async (
  projectId: string,
  stage: number,
  reason?: string
): Promise<void> => {
  await apiClient.post(`/proposals/${projectId}/stages/${stage}/unapprove`, {
    ...(reason ? { reason } : {}),
  });
};

export interface EligibleApprover {
  id: string;
  name: string;
  email: string;
}

export interface Stage7Approval {
  approverId?: string | null;
  approverName?: string | null;
  approverEmail?: string | null;
  assignedBy?: string | null;
  assignedAt?: string | null;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  priceAtAssignment?: number | null;
}

export const fetchStage7EligibleApprovers = async (
  projectId: string
): Promise<EligibleApprover[]> => {
  const { data } = await apiClient.get(`/proposals/${projectId}/stages/7/eligible-approvers`);
  return data?.data ?? [];
};

export const assignStage7Approver = async (
  projectId: string,
  approverId: string
): Promise<Stage7Approval> => {
  const { data } = await apiClient.post(`/proposals/${projectId}/stages/7/approver`, {
    approverId,
  });
  return data?.data;
};

export const patchProposalField = async (
  projectId: string,
  fieldPath: string,
  value: unknown,
  feedback?: FieldFeedbackInput
): Promise<void> => {
  await apiClient.patch(`/proposals/${projectId}/field`, {
    fieldPath,
    value,
    ...(feedback ? { feedback } : {}),
  });
};

// NEW: batch-update multiple fields in one atomic request, using the existing
// PUT /:projectId/stages/:stage backend route (saveStageFields -> saveManyFieldEdits).
// This avoids firing one PATCH per field in parallel, which was causing a
// read-modify-write race condition when 2+ fields were edited before clicking Update.
export interface FieldPatchInput {
  fieldPath: string;
  value: unknown;
  feedback?: FieldFeedbackInput;
}

export const saveStageFields = async (
  projectId: string,
  stage: number,
  fields: FieldPatchInput[]
): Promise<void> => {
  await apiClient.put(`/proposals/${projectId}/stages/${stage}`, { fields });
};
// END NEW

export const patchStage7Cost = async (
  projectId: string,
  cell: string,
  cost: number,
  feedback?: FieldFeedbackInput
): Promise<void> => {
  await apiClient.patch(`/proposals/${projectId}/stages/7/cost`, {
    cell,
    cost,
    ...(feedback ? { feedback } : {}),
  });
};

export const patchStage7Quantity = async (
  projectId: string,
  cell: string,
  quantity: number,
  feedback?: FieldFeedbackInput
): Promise<void> => {
  await apiClient.patch(`/proposals/${projectId}/stages/7/quantity`, {
    cell,
    quantity,
    ...(feedback ? { feedback } : {}),
  });
};

export const fetchFinalParametersSchema = async (
  projectId: string
): Promise<any> => {
  const { data } = await apiClient.get(`/proposals/${projectId}/final-parameters-schema`);
  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }
  return data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Proposal Document API
// ─────────────────────────────────────────────────────────────────────────────

export interface ProposalDocumentInfo {
  _id: string;
  originalName: string;
  byteSize: number;
  uploadedAt: string;
  isLatest?: boolean;
}

export type QuotationHistoryStatus = "GENERATED" | "APPROVED" | "ACTIONED" | "SENT" | "SUPERSEDED";

export interface QuotationHistoryEvent {
  type: "GENERATED" | "MANAGER_APPROVED" | "FINAL_OUTPUT_ACTIONED" | "SENT";
  occurredAt: string;
  actorId?: string | null;
  actorName?: string | null;
}

export interface QuotationHistoryItem {
  documentId: string;
  quoteNumber: string | null;
  fileName: string;
  generatedAt: string;
  generatedBy: string | null;
  amount: number | null;
  status: QuotationHistoryStatus;
  isCurrent: boolean;
  events: QuotationHistoryEvent[];
}

/** What the proposal page may offer for this project's Zoho lead. */
export type ProposalLeadApprovalState =
  | "AVAILABLE"
  | "ALREADY_MARKED"
  | "CLOSED"
  | "NO_LEAD";

export interface ProposalLeadApproval {
  state: ProposalLeadApprovalState;
  lead_status: string | null;
  /** True only when the call that returned this actually moved the lead. */
  changed: boolean;
}

export interface ProposalCellsResponse {
  stage_6_proposal: {
    target_sheet: string;
    cells: Record<string, string | number | null>;
    status: string;
    updated_at?: string;
  };
  latest_document: ProposalDocumentInfo | null;
  documents?: ProposalDocumentInfo[];
  quotation_history?: QuotationHistoryItem[];
  lead_approval?: ProposalLeadApproval;
  send_readiness?: ProposalSendReadiness;
}

export interface ProposalSendReadiness {
  managerApproved: boolean;
  finalOutputReady: boolean;
  finalOutputActioned: boolean;
  sent: boolean;
  canSend: boolean;
  reason: string | null;
}

export const approveProposalLead = async (
  projectId: string
): Promise<ProposalLeadApproval> => {
  const { data } = await apiClient.post(
    `/proposals/${projectId}/proposal/approve`,
    {}
  );
  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }
  return data;
};

export const fetchProposal = async (
  projectId: string
): Promise<ProposalCellsResponse> => {
  const { data } = await apiClient.get(`/proposals/${projectId}/proposal`);
  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }
  return data;
};

export const patchProposalCells = async (
  projectId: string,
  cells: Record<string, string | number | null>,
  targetSheet?: string
): Promise<{ status: string; target_sheet: string }> => {
  const { data } = await apiClient.patch(`/proposals/${projectId}/proposal/cells`, {
    cells,
    ...(targetSheet ? { target_sheet: targetSheet } : {}),
  });
  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }
  return data;
};

export const downloadProposal = async (
  projectId: string
): Promise<{ document: ProposalCellsResponse["latest_document"]; download_url: string | null }> => {
  const { data } = await apiClient.get(`/proposals/${projectId}/proposal/download`);
  if (data && typeof data === "object" && "data" in data) {
    return data.data;
  }
  return data;
};

export const generateProposalExcel = async (projectId: string): Promise<Blob> => {
  const { data } = await apiClient.get(`/proposals/${projectId}/excel`, {
    responseType: "blob",
  });
  return data;
};

// Streams a previously generated draft workbook through the API (auth-checked)
// so it can be parsed client-side for preview or saved to disk.
export const fetchProposalDocumentFile = async (
  projectId: string,
  documentId: string
): Promise<Blob> => {
  const { data } = await apiClient.get(
    `/proposals/${projectId}/proposal/documents/${documentId}/file`,
    { responseType: "blob" }
  );
  return data;
};

// Streams a PDF of just the customer-facing Proposal sheet for a previously
// generated draft (used by the Download action; converted/cached server-side).
export const fetchProposalDocumentPdf = async (
  projectId: string,
  documentId: string
): Promise<Blob> => {
  const { data } = await apiClient.get(
    `/proposals/${projectId}/proposal/documents/${documentId}/pdf`,
    { responseType: "blob" }
  );
  return data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Pending Approvals API
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldChange {
  fieldPath: string;
  previousValue: any;
  newValue: any;
  fieldName: string;
  fieldType: string;
  aiReasoning?: string;
}

export interface PendingApproval {
  _id: string;
  projectId: string;
  source: 'EMAIL' | 'TEAMS' | 'ZOHO' | 'DROPBOX' | 'MANUAL';
  sourceId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  detectedChanges: FieldChange[];
  reasoning: string;
  confidence: number;
  documentIds: string[];
  documentNames: string[];
  correlationId: string;
  subject?: string;
  sender?: string;
  messageId?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export const fetchPendingApprovals = async (
  projectId: string
): Promise<{ success: boolean; data: PendingApproval[]; count: number }> => {
  const { data } = await apiClient.get(`/projects/${projectId}/pending-approvals`);
  return data;
};

export const fetchPendingApprovalCount = async (
  projectId: string
): Promise<{ success: boolean; data: { count: number } }> => {
  const { data } = await apiClient.get(`/projects/${projectId}/pending-approvals/count`);
  return data;
};

export const approvePendingChange = async (
  approvalId: string
): Promise<{ success: boolean; data: PendingApproval; message: string }> => {
  const { data } = await apiClient.post(`/pending-approvals/${approvalId}/approve`, {});
  return data;
};

export const rejectPendingChange = async (
  approvalId: string,
  rejectionReason?: string
): Promise<{ success: boolean; data: PendingApproval; message: string }> => {
  const { data } = await apiClient.post(`/pending-approvals/${approvalId}/reject`, {
    ...(rejectionReason ? { rejectionReason } : {}),
  });
  return data;
};

export const manualRetrigger = async (
  projectId: string,
  documentIds: string[]
): Promise<{ success: boolean; message: string }> => {
  const { data } = await apiClient.post(`/projects/${projectId}/manual-retrigger`, {
    documentIds,
  });
  return data;
};

export const patchStage7ChargeSelection = async (
  projectId: string,
  cell: string,
  selection: "Y" | "N",
  feedback?: FieldFeedbackInput,
): Promise<void> => {
  await apiClient.patch(`/proposals/${projectId}/stages/7/charge-selection`, {
    cell,
    selection,
    ...(feedback ? { feedback } : {}),
  });
};

export type OptionalAddOnStatus =
  | "NOT_SELECTED"
  | "SELECTED_PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "DECLINED";

export const patchStage7OptionalAddOnStatus = async (
  projectId: string,
  cell: string,
  status: OptionalAddOnStatus,
): Promise<void> => {
  await apiClient.patch(`/proposals/${projectId}/stages/7/optional-add-on-status`, {
    cell,
    status,
  });
};
