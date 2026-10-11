import { ProjectWorkspaceService } from './project-workspace.service';
import { IProjectWorkspace, ProjectStatus, ProjectType } from './project-workspace.types';
import { AppError } from '@shared/errors/app.error';
import { UserRole } from '@db/models/user.model';

describe('ProjectWorkspaceService', () => {
  let projectWorkspaceService: ProjectWorkspaceService;
  
  const mockProjectRepository = {
    create: jest.fn(),
    listActive: jest.fn(),
    findById: jest.fn(),
    updateById: jest.fn(),
  };

  const mockWorkflowService = {
    canTransition: jest.fn(),
    validateProjectReadiness: jest.fn(),
    validateTransitionRequirements: jest.fn(),
    executeTransitionActions: jest.fn()
  };

  const mockUserRepository = {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  };

  const mockOutlookEmailRepository = {
    listParticipantsByProjectId: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    projectWorkspaceService = new ProjectWorkspaceService(
      mockProjectRepository as any,
      mockWorkflowService as any,
      mockUserRepository as any,
      mockOutlookEmailRepository as any,
    );
  });

  const MANAGER_VIEWER = { userId: 'sales-manager-id', role: UserRole.SALES_MANAGER };

  const createMockProject = (overrides?: Partial<IProjectWorkspace>): IProjectWorkspace => ({
    id: '60d5ecb8b392d7001f8e8e11',
    referenceNumber: 'PRJ-2023-0001',
    projectName: 'Test Project',
    customerName: 'Test Customer',
    status: ProjectStatus.SETUP_PENDING,
    projectType: ProjectType.NEW_ESTIMATE,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  describe('getAllProjects', () => {
    it('should forward filters and pagination to repository', async () => {
      const mockProject = createMockProject();
      mockProjectRepository.listActive.mockResolvedValue([mockProject]);

      const filter = { status: ProjectStatus.SETUP_PENDING };
      const pagination = { page: 1, limit: 10 };
      
      const result = await projectWorkspaceService.getAllProjects(filter, pagination, MANAGER_VIEWER);

      expect(mockProjectRepository.listActive).toHaveBeenCalled();
      expect(result.total).toBe(1);
    });

    it('should search project identity fields and sort names before pagination', async () => {
      mockProjectRepository.listActive.mockResolvedValue([
        createMockProject({ id: '2', projectName: 'Zulu', jobAddress: '20 Main Street' }),
        createMockProject({ id: '1', projectName: 'Alpha', customerName: 'Acme Glass' }),
      ]);

      const result = await projectWorkspaceService.getAllProjects(
        { search: 'main street' },
        { page: 1, limit: 10, sortBy: 'projectName', sortOrder: 'asc' },
        MANAGER_VIEWER,
      );

      expect(result.data.map((project) => project.projectName)).toEqual(['Zulu']);
      expect(result.total).toBe(1);
    });

    it('should map grouped project statuses', async () => {
      mockProjectRepository.listActive.mockResolvedValue([
        createMockProject({ status: ProjectStatus.SETUP_PENDING }),
        createMockProject({ status: ProjectStatus.ESTIMATOR_DRAFTING }),
      ]);

      const result = await projectWorkspaceService.getAllProjects(
        { statusCategory: 'IN_PROGRESS' },
        { page: 1, limit: 10 },
        MANAGER_VIEWER,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.status).toBe(ProjectStatus.ESTIMATOR_DRAFTING);
    });
  });

  describe('getProjectById', () => {
    it('should return project if found', async () => {
      const project = createMockProject();
      mockProjectRepository.findById.mockResolvedValue(project);

      const result = await projectWorkspaceService.getProjectById(project.id, MANAGER_VIEWER);
      expect(result).toEqual(project);
    });

    it('should throw AppError if project not found', async () => {
      mockProjectRepository.findById.mockResolvedValue(null);

      await expect(projectWorkspaceService.getProjectById('invalid-id', MANAGER_VIEWER))
        .rejects.toThrow(new AppError('Project not found', 404));
    });
  });

  describe('getExternalContacts', () => {
    it('returns unique external participants and excludes Amberflux addresses', async () => {
      const project = createMockProject();
      mockProjectRepository.findById.mockResolvedValue(project);
      mockOutlookEmailRepository.listParticipantsByProjectId.mockResolvedValue([
        {
          fromName: 'Customer Contact',
          fromAddress: ' Customer@Client.com ',
          toRecipients: ['gfs2@amberflux.in', 'architect@designfirm.com'],
          ccRecipients: ['CUSTOMER@client.com', 'employee@amberflux.com'],
          receivedDateTime: new Date('2026-08-01T10:00:00.000Z'),
        },
        {
          fromName: null,
          fromAddress: 'vendor@supplier.com',
          toRecipients: ['customer@client.com'],
          ccRecipients: [],
          receivedDateTime: new Date('2026-08-02T10:00:00.000Z'),
        },
      ]);

      const result = await projectWorkspaceService.getExternalContacts(project.id, {
        userId: 'sales-manager-id',
        role: UserRole.SALES_MANAGER,
      });

      expect(result.map((contact) => contact.email)).toEqual([
        'architect@designfirm.com',
        'customer@client.com',
        'vendor@supplier.com',
      ]);
      expect(result.find((contact) => contact.email === 'customer@client.com')).toMatchObject({
        name: 'Customer Contact',
        sources: ['FROM', 'CC', 'TO'],
      });
      expect(mockOutlookEmailRepository.listParticipantsByProjectId).toHaveBeenCalledWith(project.id);
    });
  });

  describe('updateProject', () => {
    it('should update and return project', async () => {
      const updatedProject = createMockProject({ projectName: 'Updated Name' });
      mockProjectRepository.updateById.mockResolvedValue(updatedProject);

      const result = await projectWorkspaceService.updateProject('id', { projectName: 'Updated Name' }, MANAGER_VIEWER);
      
      expect(mockProjectRepository.updateById).toHaveBeenCalledWith('id', { projectName: 'Updated Name' });
      expect(result).toEqual(updatedProject);
    });

    it('should throw AppError if project not found during update', async () => {
      mockProjectRepository.findById.mockResolvedValue(null);
      mockProjectRepository.updateById.mockResolvedValue(null);

      await expect(projectWorkspaceService.updateProject('invalid-id', {}, MANAGER_VIEWER))
        .rejects.toThrow(new AppError('Project not found', 404));
    });
  });

  describe('updateProjectStatus', () => {
    it('should validate transition and update status', async () => {
      const existingProject = createMockProject();
      mockProjectRepository.findById.mockResolvedValue(existingProject);
      mockProjectRepository.updateById.mockResolvedValue({ ...existingProject, status: ProjectStatus.WAITING_FOR_INPUTS });

      const result = await projectWorkspaceService.updateProjectStatus(existingProject.id, ProjectStatus.WAITING_FOR_INPUTS, MANAGER_VIEWER);

      expect(mockWorkflowService.validateTransitionRequirements).toHaveBeenCalledWith(existingProject, ProjectStatus.WAITING_FOR_INPUTS);
      expect(mockProjectRepository.updateById).toHaveBeenCalledWith(existingProject.id, { status: ProjectStatus.WAITING_FOR_INPUTS });
      expect(result.status).toBe(ProjectStatus.WAITING_FOR_INPUTS);
    });

    it('should bubble up error if workflow validation fails', async () => {
      const existingProject = createMockProject();
      mockProjectRepository.findById.mockResolvedValue(existingProject);
      mockWorkflowService.validateTransitionRequirements.mockImplementation(() => {
        throw new AppError('Invalid transition', 400);
      });

      await expect(projectWorkspaceService.updateProjectStatus(existingProject.id, ProjectStatus.ESTIMATOR_FINAL, MANAGER_VIEWER))
        .rejects.toThrow(new AppError('Invalid transition', 400));
    });
  });

  describe('assignEstimator', () => {
    it('should throw if estimator not found', async () => {
      mockProjectRepository.findById.mockResolvedValue(createMockProject());
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(projectWorkspaceService.assignEstimator('projId', ['estId']))
        .rejects.toThrow(new AppError('Estimator not found or invalid ObjectId: estId', 404));
    });

    it('should throw if estimator is inactive', async () => {
      mockProjectRepository.findById.mockResolvedValue(createMockProject());
      mockUserRepository.findById.mockResolvedValue({ id: 'estId', isActive: false });

      await expect(projectWorkspaceService.assignEstimator('projId', ['estId']))
        .rejects.toThrow(new AppError('Cannot assign an inactive estimator: undefined', 400));
    });

    it('should successfully assign estimator', async () => {
      const existingProject = createMockProject();
      mockProjectRepository.findById.mockResolvedValue(existingProject);
      mockUserRepository.findById.mockResolvedValue({ id: 'estId', isActive: true });
      
      const updatedProject = { ...existingProject, assignedEstimators: [{ id: 'estId', name: 'Est Name', email: 'est@example.com' }] };
      mockProjectRepository.updateById.mockResolvedValue(updatedProject);

      const result = await projectWorkspaceService.assignEstimator(existingProject.id, ['estId']);

      expect(mockProjectRepository.updateById).toHaveBeenCalledWith(existingProject.id, { 
        assignedEstimators: ['estId']
      });
      expect(result).toEqual(updatedProject);
    });
  });
});
