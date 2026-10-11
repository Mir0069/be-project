import type { UserRole } from '@db/models/user.model';

export enum AuditLogVisibility {
  BASIC = 'BASIC',
  FULL = 'FULL',
}

export enum AuditLogCategory {
  AUTH = 'AUTH',
  USER = 'USER',
  PROJECT = 'PROJECT',
  DOCUMENT = 'DOCUMENT',
  EXTRACTION = 'EXTRACTION',
  APPROVAL = 'APPROVAL',
  PROPOSAL = 'PROPOSAL',
  SYSTEM = 'SYSTEM',
}

export enum AuditLogSource {
  API = 'API',
  UI = 'UI',
  AI = 'AI',
  WEBHOOK = 'WEBHOOK',
  SYSTEM = 'SYSTEM',
}

export interface RecordAuditLogInput {
  action: string;
  category: AuditLogCategory;
  visibility: AuditLogVisibility;
  actorId: string;
  actorRole?: UserRole | null;
  actorEmail?: string | null;
  projectId?: string | null;
  divisionId?: string | null;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  source: AuditLogSource;
  requestId?: string | null;
}

export interface AuditLogViewer {
  userId: string;
  role: UserRole;
}

/** A small, safe project label for global audit-log views. */
export interface AuditLogProject {
  id: string;
  projectName: string;
  referenceNumber: string;
}

export interface AuditLogListQuery {
  since?: string;
  actorEmail?: string;
  projectId?: string;
  page: number;
  limit: number;
  action?: string;
  category?: AuditLogCategory;
}

export interface AuditLogView {
  id: string;
  action: string;
  category: AuditLogCategory;
  visibility: AuditLogVisibility;
  actorId: string;
  actorRole: UserRole | null;
  actorEmail: string | null;
  projectId: string | null;
  project: AuditLogProject | null;
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
  createdAt: Date;
}

export interface AuditLogListResult {
  items: AuditLogView[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
