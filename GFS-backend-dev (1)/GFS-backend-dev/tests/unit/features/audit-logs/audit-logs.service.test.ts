import { AuditLog } from '@db/models/audit-log.model';
import { Project } from '@db/models/project.model';
import { UserRole } from '@db/models/user.model';
import { AuditLogService } from '@features/audit-logs/audit-logs.service';
import { AuditLogCategory, AuditLogSource, AuditLogVisibility } from '@features/audit-logs/audit-logs.types';

jest.mock('@db/models/audit-log.model', () => ({
  AuditLog: {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock('@db/models/project.model', () => ({
  Project: {
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    exists: jest.fn(),
  },
}));

const buildQuery = <T,>(value: T) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

const service = new AuditLogService();

describe('AuditLogService.listForViewer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Project.find as jest.Mock).mockReturnValue(buildQuery([]));
  });

  it('requires estimators to request a project-scoped history', async () => {
    await expect(service.listForViewer(
      { userId: 'estimator-1', role: UserRole.ESTIMATOR },
      { page: 1, limit: 25 },
    )).rejects.toMatchObject({ statusCode: 400 });

    expect(AuditLog.find).not.toHaveBeenCalled();
  });

  it('filters estimators to assigned basic events and omits details', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    const row = {
      _id: { toString: () => 'log-1' },
      action: 'extraction.completed',
      category: AuditLogCategory.EXTRACTION,
      visibility: AuditLogVisibility.BASIC,
      actorId: 'system',
      actorRole: null,
      actorEmail: null,
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      targetLabel: 'GFS-1',
      description: 'AI extraction completed',
      metadata: { analysisStatus: 'COMPLETED' },
      source: 'SYSTEM',
      requestId: null,
      createdAt: new Date(),
    };

    (Project.findById as jest.Mock).mockReturnValue(buildQuery({ _id: projectId }));
    (Project.exists as jest.Mock).mockResolvedValue({ _id: projectId });
    (AuditLog.find as jest.Mock).mockReturnValue(buildQuery([row]));
    (AuditLog.countDocuments as jest.Mock).mockReturnValue(buildQuery(1));

    const result = await service.listForViewer(
      { userId: 'estimator-1', role: UserRole.ESTIMATOR },
      { projectId, page: 1, limit: 25 },
    );

    expect(Project.exists).toHaveBeenCalledWith({
      _id: projectId,
      assignedEstimators: 'estimator-1',
    });
    expect(AuditLog.find).toHaveBeenCalledWith({
      projectId,
      visibility: AuditLogVisibility.BASIC,
    });
    expect(result.items[0]).not.toHaveProperty('metadata');
  });

  it('returns details to a full-log viewer', async () => {
    const row = {
      _id: { toString: () => 'log-2' },
      action: 'api.post.users.createuser',
      category: AuditLogCategory.USER,
      visibility: AuditLogVisibility.FULL,
      actorId: 'admin-1',
      actorRole: UserRole.SYSTEM_ADMIN,
      actorEmail: 'admin@gfs.com',
      projectId: null,
      targetType: 'HTTP_REQUEST',
      targetId: null,
      targetLabel: null,
      description: 'POST /users/createuser returned 201',
      metadata: { statusCode: 201 },
      source: 'API',
      requestId: null,
      createdAt: new Date(),
    };

    (AuditLog.find as jest.Mock).mockReturnValue(buildQuery([row]));
    (AuditLog.countDocuments as jest.Mock).mockReturnValue(buildQuery(1));

    const result = await service.listForViewer(
      { userId: 'admin-1', role: UserRole.SYSTEM_ADMIN },
      { page: 1, limit: 25 },
    );

    expect(AuditLog.find).toHaveBeenCalledWith({
      $nor: [{ category: AuditLogCategory.SYSTEM, targetType: 'HTTP_REQUEST' }],
    });
    expect(result.items[0]?.metadata).toEqual({ statusCode: 201 });
  });

  it('adds a project name and reference to global project records in one lookup', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    (AuditLog.find as jest.Mock).mockReturnValue(buildQuery([{
      _id: { toString: () => 'log-3' }, action: 'document.uploaded', category: AuditLogCategory.DOCUMENT,
      visibility: AuditLogVisibility.FULL, actorId: 'estimator-1', projectId,
      targetType: 'DOCUMENT', description: 'Document uploaded', source: 'UI', createdAt: new Date(),
    }]));
    (AuditLog.countDocuments as jest.Mock).mockReturnValue(buildQuery(1));
    (Project.find as jest.Mock).mockReturnValue(buildQuery([{
      _id: { toString: () => projectId }, projectName: 'Blue Ridge', referenceNumber: 'GFS-2026-1025',
    }]));

    const result = await service.listForViewer(
      { userId: 'manager-1', role: UserRole.SALES_MANAGER },
      { page: 1, limit: 25 },
    );

    expect(Project.find).toHaveBeenCalledWith({ _id: { $in: [projectId] } });
    expect(result.items[0]?.project).toEqual({ id: projectId, projectName: 'Blue Ridge', referenceNumber: 'GFS-2026-1025' });
  });

  it('shows project context for an older record that only retained a project target', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    (AuditLog.find as jest.Mock).mockReturnValue(buildQuery([{
      _id: { toString: () => 'log-4' }, action: 'proposal.approved', category: AuditLogCategory.APPROVAL,
      visibility: AuditLogVisibility.FULL, actorId: 'manager-1', projectId: null,
      targetType: 'PROJECT', targetId: projectId, description: 'Proposal approved', source: 'API', createdAt: new Date(),
    }]));
    (AuditLog.countDocuments as jest.Mock).mockReturnValue(buildQuery(1));
    (Project.find as jest.Mock).mockReturnValue(buildQuery([{
      _id: { toString: () => projectId }, projectName: 'Blue Ridge', referenceNumber: 'GFS-2026-1025',
    }]));

    const result = await service.listForViewer(
      { userId: 'manager-1', role: UserRole.SALES_MANAGER },
      { page: 1, limit: 25 },
    );

    expect(result.items[0]?.projectId).toBe(projectId);
    expect(result.items[0]?.project?.referenceNumber).toBe('GFS-2026-1025');
  });

  it('stores a public project reference as the internal project ID', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    (Project.findOne as jest.Mock).mockReturnValue(buildQuery({ _id: { toString: () => projectId } }));
    (AuditLog.create as jest.Mock).mockResolvedValue({});

    await service.record({
      action: 'api.post.proposals.approve', category: AuditLogCategory.APPROVAL,
      visibility: AuditLogVisibility.FULL, actorId: 'manager-1', projectId: 'GFS-2026-1025',
      targetType: 'PROJECT', description: 'Proposal approved', source: AuditLogSource.API,
    });

    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ projectId }));
  });

  it('gives a head of division the full log without a project scope', async () => {
    (AuditLog.find as jest.Mock).mockReturnValue(buildQuery([]));
    (AuditLog.countDocuments as jest.Mock).mockReturnValue(buildQuery(0));

    await service.listForViewer(
      { userId: 'hod-1', role: UserRole.HEAD_OF_DIVISION },
      { page: 1, limit: 25 },
    );

    expect(AuditLog.find).toHaveBeenCalledWith({
      $nor: [{ category: AuditLogCategory.SYSTEM, targetType: 'HTTP_REQUEST' }],
    });
    expect(Project.exists).not.toHaveBeenCalled();
  });

  it('combines filters with project scope before pagination', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    (Project.findById as jest.Mock).mockReturnValue(buildQuery({ _id: projectId }));
    const rows = buildQuery([]);
    (AuditLog.find as jest.Mock).mockReturnValue(rows);
    (AuditLog.countDocuments as jest.Mock).mockReturnValue(buildQuery(0));
    await service.listForViewer({ userId: 'manager', role: UserRole.SALES_MANAGER }, {
      projectId, page: 2, limit: 5, category: AuditLogCategory.DOCUMENT,
      since: '2026-09-01T00:00:00.000Z', actorEmail: 'manager@gfs.com',
    });
    const filter = { projectId, category: AuditLogCategory.DOCUMENT, actorEmail: 'manager@gfs.com', createdAt: { $gte: new Date('2026-09-01T00:00:00.000Z') } };
    expect(AuditLog.find).toHaveBeenCalledWith(filter);
    expect(AuditLog.countDocuments).toHaveBeenCalledWith(filter);
    expect(rows.skip).toHaveBeenCalledWith(5);
  });
});
