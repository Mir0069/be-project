// =============================================================================
// PROJECT ACCESS CONTROL — AN ESTIMATOR ONLY EVER SEES THEIR OWN PROJECTS
// =============================================================================
// Before this, the workspace controller never handed the authenticated user to
// the service, so every estimator could list, open, edit and re-status every
// project in the tenant, including ones assigned to nobody. These tests pin the
// rule from both directions: an assigned estimator keeps working, an unassigned
// one is refused, and an unassigned project is invisible rather than claimable.

import { ProjectWorkspaceService } from '@features/project-workspace/project-workspace.service';
import { ProjectStatus, ProjectType } from '@features/project-workspace/project-workspace.types';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import { UserRole } from '@db/models/user.model';
import { AppError } from '@shared/errors/app.error';

const OWNER_ID = '60d5ecb8b392d7001f8e8e01';
const OTHER_ID = '60d5ecb8b392d7001f8e8e02';
const PROJECT_ID = '60d5ecb8b392d7001f8e8e11';

const ASSIGNED_ESTIMATOR = { userId: OWNER_ID, role: UserRole.ESTIMATOR };
const OTHER_ESTIMATOR = { userId: OTHER_ID, role: UserRole.ESTIMATOR };
const SALES_MANAGER = { userId: 'mgr-1', role: UserRole.SALES_MANAGER };
const SYSTEM_ADMIN = { userId: 'adm-1', role: UserRole.SYSTEM_ADMIN };
const HEAD_OF_DIVISION = { userId: 'hod-1', role: UserRole.HEAD_OF_DIVISION };

const makeProject = (overrides: Partial<IDomainProject> = {}): IDomainProject => ({
  id: PROJECT_ID,
  referenceNumber: 'GFS-2026-0001',
  projectName: 'Test Project',
  customerName: 'Test Customer',
  status: ProjectStatus.SETUP_PENDING,
  projectType: ProjectType.NEW_ESTIMATE,
  creationSource: 'MANUAL' as IDomainProject['creationSource'],
  identifierHash: null,
  zohoLeadId: null,
  jobAddress: null,
  quoteNumber: null,
  leadStatus: null,
  blobStorageURL: null,
  dropboxFolderPath: null,
  customerEmail: null,
  customerPhone: null,
  company: null,
  customerWebsite: null,
  description: null,
  receivedDate: null,
  address: null,
  assignedEstimators: [],
  lastZohoSyncedAt: null,
  dueDate: undefined,
  isActive: true,
  estimatedCost: null,
  totalSqFt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const assignedTo = (userId: string) => [
  { id: userId, name: 'Assigned Estimator', email: 'est@gfs.test' },
] as IDomainProject['assignedEstimators'];

const FORBIDDEN = new AppError('You do not have permission to view this project', 403);

describe('ProjectWorkspaceService access control', () => {
  const projectRepository = {
    listActive: jest.fn(),
    listActivePaginated: undefined,
    findById: jest.fn(),
    findByReferenceNumber: jest.fn(),
    updateById: jest.fn(),
  } as unknown as jest.Mocked<IProjectRepository>;

  const workflowService = {
    validateTransitionRequirements: jest.fn(),
    executeTransitionActions: jest.fn(),
  };

  const service = new ProjectWorkspaceService(
    projectRepository,
    workflowService as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  // ───────────────────────────────────────────────────────────────────────────
  // LIST
  // ───────────────────────────────────────────────────────────────────────────

  describe('getAllProjects', () => {
    it('returns only the projects assigned to the estimator', async () => {
      projectRepository.listActive.mockResolvedValue([
        makeProject({ id: 'mine', projectName: 'Mine', assignedEstimators: assignedTo(OWNER_ID) }),
        makeProject({ id: 'theirs', projectName: 'Theirs', assignedEstimators: assignedTo(OTHER_ID) }),
      ]);

      const result = await service.getAllProjects({}, { page: 1, limit: 15 }, ASSIGNED_ESTIMATOR);

      expect(result.data.map((project) => project.projectName)).toEqual(['Mine']);
      expect(result.total).toBe(1);
    });

    it('hides unassigned projects from an estimator', async () => {
      projectRepository.listActive.mockResolvedValue([
        makeProject({ id: 'unassigned', projectName: 'Nobody', assignedEstimators: [] }),
      ]);

      const result = await service.getAllProjects({}, { page: 1, limit: 15 }, ASSIGNED_ESTIMATOR);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('stops an estimator from widening the filter to someone else', async () => {
      projectRepository.listActive.mockResolvedValue([
        makeProject({ id: 'mine', projectName: 'Mine', assignedEstimators: assignedTo(OWNER_ID) }),
        makeProject({ id: 'theirs', projectName: 'Theirs', assignedEstimators: assignedTo(OTHER_ID) }),
      ]);

      const result = await service.getAllProjects(
        { assignedEstimatorIds: [OTHER_ID] },
        { page: 1, limit: 15 },
        ASSIGNED_ESTIMATOR,
      );

      expect(result.data.map((project) => project.projectName)).toEqual(['Mine']);
    });

    it('pins the estimator filter to the caller on the paginated repository path', async () => {
      const listActivePaginated = jest.fn().mockResolvedValue({ data: [], total: 0 });
      const paginated = new ProjectWorkspaceService(
        { listActivePaginated } as any,
        workflowService as any,
        {} as any,
        {} as any,
      );

      await paginated.getAllProjects(
        { assignedEstimatorIds: [OTHER_ID] },
        { page: 1, limit: 15 },
        ASSIGNED_ESTIMATOR,
      );

      expect(listActivePaginated).toHaveBeenCalledWith(
        expect.objectContaining({ assignedEstimatorIds: [OWNER_ID] }),
      );
    });

    it.each([
      ['sales manager', SALES_MANAGER],
      ['system admin', SYSTEM_ADMIN],
      ['head of division', HEAD_OF_DIVISION],
    ])('lets a %s see every project including unassigned ones', async (_label, viewer) => {
      projectRepository.listActive.mockResolvedValue([
        makeProject({ id: 'a', projectName: 'Assigned', assignedEstimators: assignedTo(OWNER_ID) }),
        makeProject({ id: 'b', projectName: 'Unassigned', assignedEstimators: [] }),
      ]);

      const result = await service.getAllProjects({}, { page: 1, limit: 15 }, viewer);

      expect(result.total).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DETAIL — the URL-typing hole
  // ───────────────────────────────────────────────────────────────────────────

  describe('getProjectById', () => {
    it('lets the assigned estimator open the project', async () => {
      projectRepository.findById.mockResolvedValue(
        makeProject({ assignedEstimators: assignedTo(OWNER_ID) }),
      );

      const result = await service.getProjectById(PROJECT_ID, ASSIGNED_ESTIMATOR);

      expect(result.id).toBe(PROJECT_ID);
    });

    it('refuses an estimator who is not assigned', async () => {
      projectRepository.findById.mockResolvedValue(
        makeProject({ assignedEstimators: assignedTo(OWNER_ID) }),
      );

      await expect(service.getProjectById(PROJECT_ID, OTHER_ESTIMATOR)).rejects.toThrow(FORBIDDEN);
    });

    it('refuses an estimator on an unassigned project', async () => {
      projectRepository.findById.mockResolvedValue(makeProject({ assignedEstimators: [] }));

      await expect(service.getProjectById(PROJECT_ID, ASSIGNED_ESTIMATOR)).rejects.toThrow(FORBIDDEN);
    });

    it('lets a sales manager open any project', async () => {
      projectRepository.findById.mockResolvedValue(makeProject({ assignedEstimators: [] }));

      await expect(service.getProjectById(PROJECT_ID, SALES_MANAGER)).resolves.toMatchObject({
        id: PROJECT_ID,
      });
    });

    it('lets a head of division open any project', async () => {
      projectRepository.findById.mockResolvedValue(makeProject({ assignedEstimators: [] }));

      await expect(service.getProjectById(PROJECT_ID, HEAD_OF_DIVISION)).resolves.toMatchObject({
        id: PROJECT_ID,
      });
    });

    it('still reports a missing project as 404, not 403', async () => {
      projectRepository.findById.mockResolvedValue(null);
      projectRepository.findByReferenceNumber.mockResolvedValue(null);

      await expect(service.getProjectById(PROJECT_ID, ASSIGNED_ESTIMATOR)).rejects.toThrow(
        new AppError('Project not found', 404),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // WRITES
  // ───────────────────────────────────────────────────────────────────────────

  describe('updateProject', () => {
    it('refuses an unassigned estimator and never touches the repository', async () => {
      projectRepository.findById.mockResolvedValue(
        makeProject({ assignedEstimators: assignedTo(OWNER_ID) }),
      );

      await expect(
        service.updateProject(PROJECT_ID, { projectName: 'Hijacked' }, OTHER_ESTIMATOR),
      ).rejects.toThrow(FORBIDDEN);
      expect(projectRepository.updateById).not.toHaveBeenCalled();
    });

    it('allows the assigned estimator', async () => {
      const project = makeProject({ assignedEstimators: assignedTo(OWNER_ID) });
      projectRepository.findById.mockResolvedValue(project);
      projectRepository.updateById.mockResolvedValue({ ...project, projectName: 'Renamed' });

      const result = await service.updateProject(
        PROJECT_ID,
        { projectName: 'Renamed' },
        ASSIGNED_ESTIMATOR,
      );

      expect(result.projectName).toBe('Renamed');
    });

    it('does not let an assigned estimator change the due date', async () => {
      projectRepository.findById.mockResolvedValue(
        makeProject({ assignedEstimators: assignedTo(OWNER_ID) }),
      );

      await expect(
        service.updateProject(PROJECT_ID, { dueDate: new Date('2026-10-01') }, ASSIGNED_ESTIMATOR),
      ).rejects.toThrow('Only managers and administrators can update the due date');
      expect(projectRepository.updateById).not.toHaveBeenCalled();
    });

    it('lets a head of division set the due date', async () => {
      const dueDate = new Date('2026-10-01');
      const project = makeProject();
      projectRepository.findById.mockResolvedValue(project);
      projectRepository.updateById.mockResolvedValue({ ...project, dueDate });

      await expect(
        service.updateProject(PROJECT_ID, { dueDate }, HEAD_OF_DIVISION),
      ).resolves.toMatchObject({ dueDate });
      expect(projectRepository.updateById).toHaveBeenCalledWith(PROJECT_ID, { dueDate });
    });
  });

  describe('updateProjectStatus', () => {
    it('refuses an unassigned estimator and never runs the transition', async () => {
      projectRepository.findById.mockResolvedValue(
        makeProject({ assignedEstimators: assignedTo(OWNER_ID) }),
      );

      await expect(
        service.updateProjectStatus(PROJECT_ID, ProjectStatus.WAITING_FOR_INPUTS, OTHER_ESTIMATOR),
      ).rejects.toThrow(FORBIDDEN);
      expect(workflowService.validateTransitionRequirements).not.toHaveBeenCalled();
      expect(projectRepository.updateById).not.toHaveBeenCalled();
    });

    it('allows the assigned estimator', async () => {
      const project = makeProject({ assignedEstimators: assignedTo(OWNER_ID) });
      projectRepository.findById.mockResolvedValue(project);
      projectRepository.updateById.mockResolvedValue({
        ...project,
        status: ProjectStatus.WAITING_FOR_INPUTS,
      });

      const result = await service.updateProjectStatus(
        PROJECT_ID,
        ProjectStatus.WAITING_FOR_INPUTS,
        ASSIGNED_ESTIMATOR,
      );

      expect(result.status).toBe(ProjectStatus.WAITING_FOR_INPUTS);
    });
  });
});
