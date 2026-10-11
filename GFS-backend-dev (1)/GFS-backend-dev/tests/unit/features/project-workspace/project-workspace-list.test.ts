import { ProjectWorkspaceService } from '@features/project-workspace/project-workspace.service';
import { ProjectAnalysisStatus, ProjectStatus, ProjectType } from '@features/project-workspace/project-workspace.types';
import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import { UserRole } from '@db/models/user.model';

const MANAGER_VIEWER = { userId: 'sales-manager-1', role: UserRole.SALES_MANAGER };

const makeProject = (overrides: Partial<IDomainProject> = {}): IDomainProject => ({
  id: '60d5ecb8b392d7001f8e8e11',
  referenceNumber: 'GFS-001',
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

describe('ProjectWorkspaceService project list', () => {
  const projectRepository = {
    listActive: jest.fn(),
  } as unknown as jest.Mocked<IProjectRepository>;
  const service = new ProjectWorkspaceService(
    projectRepository,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('searches addresses and returns alphabetically sorted backend projects', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ id: '2', projectName: 'Zulu', jobAddress: '20 Main Street' }),
      makeProject({ id: '1', projectName: 'Alpha', customerName: 'Acme Glass' }),
    ]);

    const result = await service.getAllProjects(
      { search: 'main street' },
      { page: 1, limit: 15, sortBy: 'projectName', sortOrder: 'asc' },
      MANAGER_VIEWER,
    );

    expect(result.data.map((project) => project.projectName)).toEqual(['Zulu']);
    expect(result.total).toBe(1);
  });

  it('groups estimator workflow statuses for the UI filter', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ status: ProjectStatus.SETUP_PENDING }),
      makeProject({ status: ProjectStatus.ESTIMATOR_DRAFTING }),
    ]);

    const result = await service.getAllProjects(
      { statusCategory: 'IN_PROGRESS' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.status).toBe(ProjectStatus.ESTIMATOR_DRAFTING);
  });

  it('filters READY_FOR_ESTIMATOR projects separately from estimator work in progress', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ status: ProjectStatus.READY_FOR_ESTIMATOR }),
      makeProject({ status: ProjectStatus.ESTIMATOR_DRAFTING }),
    ]);

    const result = await service.getAllProjects(
      { statusCategory: 'READY_FOR_ESTIMATOR' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.status).toBe(ProjectStatus.READY_FOR_ESTIMATOR);
  });

  it('filters projects that are actively being revised', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ status: ProjectStatus.NEEDS_REVISION }),
      makeProject({ status: ProjectStatus.ESTIMATOR_DRAFTING }),
    ]);

    const result = await service.getAllProjects(
      { statusCategory: 'NEEDS_REVISION' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.status).toBe(ProjectStatus.NEEDS_REVISION);
  });

  it('filters by AI_PROCESSING when statusCategory is AI_PROCESSING', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ status: ProjectStatus.WAITING_FOR_INPUTS, analysisStatus: 'PROCESSING' as any }),
      makeProject({ status: ProjectStatus.WAITING_FOR_INPUTS, analysisStatus: 'COMPLETED' as any }),
    ]);

    const result = await service.getAllProjects(
      { statusCategory: 'AI_PROCESSING' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.analysisStatus).toBe('PROCESSING');
  });

  it('filters by PENDING (Input Pending) excluding active AI processing', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ status: ProjectStatus.WAITING_FOR_INPUTS, analysisStatus: 'PROCESSING' as any }),
      makeProject({ status: ProjectStatus.WAITING_FOR_INPUTS, analysisStatus: 'COMPLETED' as any }),
      makeProject({ status: ProjectStatus.SETUP_PENDING, analysisStatus: 'NOT_STARTED' as any }),
    ]);

    const result = await service.getAllProjects(
      { statusCategory: 'PENDING' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.status).toBe(ProjectStatus.WAITING_FOR_INPUTS);
    expect(result.data[0]?.analysisStatus).toBe('COMPLETED');
  });

  it('includes legacy PENDING records in the Input Pending filter', async () => {
    projectRepository.listActive.mockResolvedValue([
      makeProject({ status: 'PENDING' as any, analysisStatus: 'COMPLETED' as any }),
      makeProject({ status: 'PENDING' as any, analysisStatus: 'PROCESSING' as any }),
      makeProject({ status: ProjectStatus.WAITING_FOR_INPUTS, analysisStatus: 'COMPLETED' as any }),
    ]);

    const result = await service.getAllProjects(
      { statusCategory: 'PENDING' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(result.data).toHaveLength(2);
    expect(result.data.map((project) => project.status)).toEqual([
      'PENDING',
      ProjectStatus.WAITING_FOR_INPUTS,
    ]);
  });

  it('passes canonical and legacy pending statuses to the paginated repository', async () => {
    const listActivePaginated = jest.fn().mockResolvedValue({ data: [], total: 0 });
    const paginatedService = new ProjectWorkspaceService(
      { listActivePaginated } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await paginatedService.getAllProjects(
      { statusCategory: 'PENDING' },
      { page: 1, limit: 15 },
      MANAGER_VIEWER,
    );

    expect(listActivePaginated).toHaveBeenCalledWith(expect.objectContaining({
      statuses: [ProjectStatus.WAITING_FOR_INPUTS, 'PENDING'],
      excludeAnalysisStatuses: [ProjectAnalysisStatus.PROCESSING],
    }));
  });

});
