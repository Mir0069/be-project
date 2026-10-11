export type NotificationType =
  | "PROJECT_CREATED"
  | "PROJECT_ASSIGNED"
  | "MAIL_LINKED"
  | "DRAFT_REQUIRES_REVIEW"
  | "CLOUD_LINK_FAILED"
  | "TEAMS_WORKSPACE_CREATED"
  | "DROPBOX_WORKSPACE_CREATED"
  | "TEAMS_WORKSPACE_NEEDS_DECISION"
  | "TEAMS_MEMBER_NOT_ADDED"
  | "DOCS_PROCESSING"
  | "DOCS_PROCESSED"
  | "PROJECT_COMPLETED"
  | "DOCUMENT_ADDED"
  | "PROPOSAL_APPROVAL_REQUESTED";

export type OpportunityStatus = "OPEN" | "CONVERTED" | "REJECTED";

export type ProjectCreationSource = "ZOHO_FIRST" | "MAIL_FIRST" | "MANUAL";

export interface ProjectCreatedPayload {
  referenceNumber?: string;
  projectName?: string;
  zohoLeadId?: string | null;
  leadName?: string | null;
  leadStatus?: string | null;
  creationSource?: ProjectCreationSource;
  estimatorName?: string | null;
  mailSubject?: string | null;
  fromName?: string | null;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId: string | null;
  payload: Record<string, unknown> | null;
  opportunityStatus: OpportunityStatus | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationView[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}
