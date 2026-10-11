export type AuditLogVisibility = "BASIC" | "FULL";

export type AuditLogCategory =
  | "AUTH"
  | "USER"
  | "PROJECT"
  | "DOCUMENT"
  | "EXTRACTION"
  | "APPROVAL"
  | "PROPOSAL"
  | "SYSTEM";

export type AuditLogSource = "API" | "UI" | "AI" | "WEBHOOK" | "SYSTEM";

export interface AuditLogProject {
  id: string;
  projectName: string;
  referenceNumber: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  category: AuditLogCategory;
  visibility: AuditLogVisibility;
  actorId: string;
  actorRole: string | null;
  actorEmail: string | null;
  projectId: string | null;
  project?: AuditLogProject | null;
  divisionId: string | null;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  source: AuditLogSource;
  requestId: string | null;
  createdAt: string;
}

export interface AuditLogListResult {
  items: AuditLogItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
