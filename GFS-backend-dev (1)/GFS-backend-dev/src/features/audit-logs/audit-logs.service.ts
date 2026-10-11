import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import { AuditLog } from '@db/models/audit-log.model';
import { DocumentModel } from '@db/models/document.model';
import { Project } from '@db/models/project.model';
import { User, UserRole } from '@db/models/user.model';
import { AppError } from '@shared/errors/app.error';
import { hasAnyRole } from '@shared/security/role-access';
import {
  AuditLogCategory,
  AuditLogListQuery,
  AuditLogListResult,
  AuditLogProject,
  AuditLogSource,
  AuditLogView,
  AuditLogViewer,
  AuditLogVisibility,
  RecordAuditLogInput,
} from './audit-logs.types';

export const FULL_AUDIT_LOG_ROLES: UserRole[] = [
  UserRole.SALES_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
];

// Estimators can verify the processing lifecycle, but should not receive
// user-management, approval, document-content, or request metadata details.
const BASIC_ACTION_PATTERNS = [
  /^document\.(staged|uploaded)/i,
  /^extraction\./i,
  /^api\..*(analysis|extract|processing|status)/i,
];

export const isBasicAuditAction = (action: string): boolean =>
  BASIC_ACTION_PATTERNS.some((pattern) => pattern.test(action));

// Request-level system rows are retained in the database for technical
// traceability, but they do not contain a client-meaningful action, project,
// or affected target. Keep them out of the global business-facing audit feed.
const NON_ACTIONABLE_GLOBAL_RECORD = {
  category: AuditLogCategory.SYSTEM,
  targetType: 'HTTP_REQUEST',
};

export const auditCategoryForAction = (action: string): AuditLogCategory => {
  const normalized = action.toLowerCase();
  if (normalized.includes('auth')) return AuditLogCategory.AUTH;
  if (normalized.includes('user')) return AuditLogCategory.USER;
  if (normalized.includes('document')) return AuditLogCategory.DOCUMENT;
  if (normalized.includes('extract') || normalized.includes('processing') || normalized.includes('analysis')) {
    return AuditLogCategory.EXTRACTION;
  }
  if (normalized.includes('approv') || normalized.includes('reject') || normalized.includes('unapprov')) {
    return AuditLogCategory.APPROVAL;
  }
  if (normalized.includes('proposal')) return AuditLogCategory.PROPOSAL;
  if (normalized.includes('project')) return AuditLogCategory.PROJECT;
  return AuditLogCategory.SYSTEM;
};

type AuditLogRow = {
  _id: mongoose.Types.ObjectId;
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
  createdAt: Date;
};

type AuditLogUser = {
  id: string;
  label: string;
};

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeValue(entry, depth + 1));
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(source)
        .slice(0, 100)
        .filter(([key]) => !/(password|token|secret|authorization|cookie)/i.test(key))
        .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]),
    );
  }
  return String(value).slice(0, 2000);
};

const sanitizeRecord = (value: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  const sanitized = sanitizeValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : undefined;
};

export class AuditLogService {
  public async record(input: RecordAuditLogInput): Promise<void> {
    const projectId = await this.normalizeProjectId(input.projectId);
    await AuditLog.create({
      action: input.action,
      category: input.category,
      visibility: input.visibility,
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      actorEmail: input.actorEmail ?? null,
      projectId,
      divisionId: input.divisionId ?? null,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      description: input.description.slice(0, 2000),
      metadata: sanitizeRecord(input.metadata),
      before: input.before === undefined ? undefined : sanitizeValue(input.before),
      after: input.after === undefined ? undefined : sanitizeValue(input.after),
      source: input.source,
      requestId: input.requestId ?? null,
    });
  }

  /** Audit persistence must never make the business request fail. */
  public async recordBestEffort(input: RecordAuditLogInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      console.error('[audit-log] failed to persist event', {
        action: input.action,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async listForViewer(viewer: AuditLogViewer, query: AuditLogListQuery): Promise<AuditLogListResult> {
    const canReadFullLogs = hasAnyRole(viewer.role, FULL_AUDIT_LOG_ROLES);
    if (!canReadFullLogs && viewer.role !== UserRole.ESTIMATOR) {
      throw new AppError('You do not have permission to view audit logs', StatusCodes.FORBIDDEN, true);
    }

    const page = Math.max(1, query.page);
    const limit = Math.min(100, Math.max(1, query.limit));
    const filter: Record<string, unknown> = {};

    let resolvedProjectId: string | undefined;
    if (query.projectId) {
      const project = await this.resolveProject(query.projectId);
      if (!project) throw new AppError('Project not found', StatusCodes.NOT_FOUND, true);
      resolvedProjectId = project._id.toString();
      filter['projectId'] = resolvedProjectId;
    }

    if (viewer.role === UserRole.ESTIMATOR) {
      if (!resolvedProjectId) {
        throw new AppError('projectId is required for estimator audit history', StatusCodes.BAD_REQUEST, true);
      }

      const assigned = await Project.exists({
        _id: resolvedProjectId,
        assignedEstimators: viewer.userId,
      });
      if (!assigned) {
        throw new AppError('You are not assigned to this project', StatusCodes.FORBIDDEN, true);
      }

      filter['visibility'] = AuditLogVisibility.BASIC;
    }

    if (query.action) filter['action'] = query.action;
    if (query.since) filter['createdAt'] = { $gte: new Date(query.since) };
    if (query.actorEmail) filter['actorEmail'] = query.actorEmail;
    if (query.category) filter['category'] = query.category;
    if (!resolvedProjectId) filter['$nor'] = [NON_ACTIONABLE_GLOBAL_RECORD];

    const [rows, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AuditLogRow[]>()
        .exec(),
      AuditLog.countDocuments(filter).exec(),
    ]);
    const documentProjectIds = await this.findDocumentProjectIds(rows);
    const projectsById = await this.findProjectSummaries(rows, documentProjectIds);
    const usersById = await this.findUserSummaries(rows);

    return {
      items: rows.map((row) => {
        const project = projectsById.get(this.projectKeyForRow(row, documentProjectIds) ?? '') ?? null;
        const targetUser = usersById.get(row.targetId ?? '') ?? null;
        return this.toView(row, canReadFullLogs, project, targetUser);
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async resolveProject(projectKey: string): Promise<{ _id: mongoose.Types.ObjectId } | null> {
    if (mongoose.Types.ObjectId.isValid(projectKey)) {
      const byId = await Project.findById(projectKey).select('_id').lean<{ _id: mongoose.Types.ObjectId }>().exec();
      if (byId) return byId;
    }
    return Project.findOne({ referenceNumber: projectKey })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId }>()
      .exec();
  }

  /** Converts a public project reference into the stored project ID when needed. */
  private async normalizeProjectId(projectKey: string | null | undefined): Promise<string | null> {
    if (!projectKey) return null;
    if (mongoose.Types.ObjectId.isValid(projectKey)) return projectKey;
    const project = await this.resolveProject(projectKey);
    return project?._id.toString() ?? null;
  }

  private projectKeyForRow(row: AuditLogRow, documentProjectIds = new Map<string, string>()): string | null {
    // Lean audit-log rows created by older paths can still contain an ObjectId
    // at runtime. Use one stable string key for both the project query and the
    // in-memory summary lookup.
    const key = row.projectId || (row.targetType === 'PROJECT'
      ? row.targetId ?? row.targetLabel
      : row.targetType === 'DOCUMENT' && row.targetId
        ? documentProjectIds.get(String(row.targetId))
        : null);
    return key ? String(key) : null;
  }

  /** Loads project labels once per page, avoiding one lookup for every audit record. */
  private async findProjectSummaries(
    rows: AuditLogRow[],
    documentProjectIds: Map<string, string>,
  ): Promise<Map<string, AuditLogProject>> {
    const keys = [...new Set(rows.flatMap((row) => {
      const key = this.projectKeyForRow(row, documentProjectIds);
      return key ? [key] : [];
    }))];
    if (!keys.length) return new Map();

    const ids = keys.filter((key) => mongoose.Types.ObjectId.isValid(key));
    const references = keys.filter((key) => !mongoose.Types.ObjectId.isValid(key));
    const filter = ids.length && references.length
      ? { $or: [{ _id: { $in: ids } }, { referenceNumber: { $in: references } }, { projectCode: { $in: references } }] }
      : ids.length
        ? { _id: { $in: ids } }
        : { $or: [{ referenceNumber: { $in: references } }, { projectCode: { $in: references } }] };
    const projects = await Project.find(filter)
      .select('_id projectName referenceNumber projectCode')
      .lean<Array<{ _id: mongoose.Types.ObjectId; projectName: string; referenceNumber: string; projectCode?: string }>>()
      .exec();

    const summaries = projects.map((project) => ({
      id: project._id.toString(),
      projectName: project.projectName,
      referenceNumber: project.referenceNumber,
    }));
    const byId = new Map(summaries.map((project) => [project.id, project]));
    const byReference = new Map(summaries.map((project) => [project.referenceNumber, project]));
    const byProjectCode = new Map(projects
      .filter((project) => project.projectCode)
      .map((project) => [project.projectCode as string, {
        id: project._id.toString(),
        projectName: project.projectName,
        referenceNumber: project.referenceNumber,
      }]));
    return new Map(keys.flatMap((key) => {
      const project = byId.get(key) ?? byReference.get(key) ?? byProjectCode.get(key);
      return project ? [[key, project] as const] : [];
    }));
  }

  /** Links older document-only audit events back to their owning project. */
  private async findDocumentProjectIds(rows: AuditLogRow[]): Promise<Map<string, string>> {
    const documentIds = [...new Set(rows
      .filter((row) => row.targetType === 'DOCUMENT' && row.targetId && mongoose.Types.ObjectId.isValid(row.targetId))
      .map((row) => new mongoose.Types.ObjectId(String(row.targetId))))];
    if (!documentIds.length) return new Map();

    const documents = await DocumentModel.find({ _id: { $in: documentIds }, projectId: { $ne: null } })
      .select('_id projectId')
      .lean<Array<{ _id: mongoose.Types.ObjectId; projectId: mongoose.Types.ObjectId }>>()
      .exec();
    return new Map(documents.map((document) => [document._id.toString(), document.projectId.toString()]));
  }

  /** Resolve user targets for global admin records without duplicating names in every row. */
  private async findUserSummaries(rows: AuditLogRow[]): Promise<Map<string, AuditLogUser>> {
    const ids = [...new Set(rows
      .filter((row) => row.targetType === 'USER' && row.targetId && mongoose.Types.ObjectId.isValid(row.targetId))
      .map((row) => row.targetId as string))];
    if (!ids.length) return new Map();

    const users = await User.find({ _id: { $in: ids } })
      .select('_id firstName lastName email')
      .lean<Array<{ _id: mongoose.Types.ObjectId; firstName: string; lastName: string; email: string }>>()
      .exec();

    return new Map(users.map((user) => [user._id.toString(), {
      id: user._id.toString(),
      label: `${[user.firstName, user.lastName].filter(Boolean).join(' ')} · ${user.email}`,
    }]));
  }

  private toView(
    row: AuditLogRow,
    includeDetails: boolean,
    project: AuditLogProject | null,
    targetUser: AuditLogUser | null,
  ): AuditLogView {
    const view: AuditLogView = {
      id: row._id.toString(),
      action: row.action,
      category: row.category,
      visibility: row.visibility,
      actorId: row.actorId,
      actorRole: row.actorRole ?? null,
      actorEmail: row.actorEmail ?? null,
      projectId: project?.id ?? this.projectKeyForRow(row),
      project,
      divisionId: row.divisionId ?? null,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      targetLabel: row.targetLabel ?? targetUser?.label ?? null,
      description: row.description,
      source: row.source,
      requestId: row.requestId ?? null,
      createdAt: row.createdAt,
    };

    if (includeDetails) {
      if (row.metadata !== undefined) view.metadata = row.metadata;
      if (row.before !== undefined) view.before = row.before;
      if (row.after !== undefined) view.after = row.after;
    }

    return view;
  }
}

export const auditLogService = new AuditLogService();
