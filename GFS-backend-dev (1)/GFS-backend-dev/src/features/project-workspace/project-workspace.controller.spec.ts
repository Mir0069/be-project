import { Request, Response } from 'express';
import { ProjectWorkspaceController } from './project-workspace.controller';
import { safeJson } from '@shared/http/safe-json';
import { ProjectStatus } from './project-workspace.types';
import { UserRole } from '@db/models/user.model';

// Mock the safeJson utility
jest.mock('@shared/http/safe-json', () => ({
  safeJson: jest.fn()
}));

describe('ProjectWorkspaceController', () => {
  let projectWorkspaceController: ProjectWorkspaceController;
  
  const mockProjectWorkspaceService = {
    createProject: jest.fn(),
    getAllProjects: jest.fn(),
    getProjectById: jest.fn(),
    getExternalContacts: jest.fn(),
    updateProject: jest.fn(),
    updateProjectStatus: jest.fn(),
    assignEstimator: jest.fn()
  };

  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    projectWorkspaceController = new ProjectWorkspaceController(mockProjectWorkspaceService as any);
    req = {
      body: {},
      params: {},
      query: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  });

  describe('getExternalContacts', () => {
    it('passes the authenticated viewer to the service', async () => {
      req.params = { id: 'proj1' };
      req.user = {
        userId: 'estimator-id',
        email: 'estimator@example.com',
        role: UserRole.ESTIMATOR,
      };
      mockProjectWorkspaceService.getExternalContacts.mockResolvedValue([]);

      await projectWorkspaceController.getExternalContacts(req as Request, res as Response);

      expect(mockProjectWorkspaceService.getExternalContacts).toHaveBeenCalledWith('proj1', {
        userId: 'estimator-id',
        role: UserRole.ESTIMATOR,
      });
      expect(safeJson).toHaveBeenCalledWith(res, 200, {
        success: true,
        data: { contacts: [], total: 0 },
      });
    });
  });

  describe('getAllProjects', () => {
    it('should parse query params and forward to service returning 200', async () => {
      req.query = {
        page: '2',
        limit: '15',
        status: ProjectStatus.SETUP_PENDING,
        isActive: 'true',
        sortBy: 'dueDate',
        sortOrder: 'desc'
      };

      const paginatedResult = {
        data: [{ id: 'proj1' }],
        total: 100,
        page: 2,
        limit: 15,
        totalPages: 7
      };

      mockProjectWorkspaceService.getAllProjects.mockResolvedValue(paginatedResult);

      await projectWorkspaceController.getAllProjects(req as Request, res as Response);

      // Verify the parsed arguments sent to service
      expect(mockProjectWorkspaceService.getAllProjects).toHaveBeenCalledWith(
        {
          status: ProjectStatus.SETUP_PENDING,
          statusCategory: undefined,
          projectType: undefined,
          customerName: undefined,
          assignedEstimatorIds: undefined,
          isActive: true,
          referenceNumber: undefined,
          dueDate: undefined,
          search: undefined,
          updatedAfter: undefined
        },
        {
          page: 2,
          limit: 15,
          sortBy: 'dueDate',
          sortOrder: 'desc'
        }
      );

      // Verify response structure format including metadata
      expect(safeJson).toHaveBeenCalledWith(res, 200, { success: true, data: paginatedResult });
    });
  });

  describe('getProjectById', () => {
    it('should call service and return 200 with project', async () => {
      req.params = { id: 'proj1' };
      const project = { id: 'proj1', projectName: 'Test' };
      mockProjectWorkspaceService.getProjectById.mockResolvedValue(project);

      await projectWorkspaceController.getProjectById(req as Request, res as Response);

      expect(mockProjectWorkspaceService.getProjectById).toHaveBeenCalledWith('proj1');
      expect(safeJson).toHaveBeenCalledWith(res, 200, { success: true, data: project });
    });
  });

  describe('updateProject', () => {
    it('should call service and return 200', async () => {
      req.params = { id: 'proj1' };
      req.body = { projectName: 'Updated' };
      const updatedProject = { id: 'proj1', projectName: 'Updated' };
      mockProjectWorkspaceService.updateProject.mockResolvedValue(updatedProject);

      await projectWorkspaceController.updateProject(req as Request, res as Response);

      expect(mockProjectWorkspaceService.updateProject).toHaveBeenCalledWith('proj1', req.body);
      expect(safeJson).toHaveBeenCalledWith(res, 200, { success: true, data: updatedProject });
    });
  });

  describe('updateProjectStatus', () => {
    it('should call service and return 200', async () => {
      req.params = { id: 'proj1' };
      req.body = { status: ProjectStatus.READY_FOR_ESTIMATOR };
      const updatedProject = { id: 'proj1', status: ProjectStatus.READY_FOR_ESTIMATOR };
      mockProjectWorkspaceService.updateProjectStatus.mockResolvedValue(updatedProject);

      await projectWorkspaceController.updateProjectStatus(req as Request, res as Response);

      expect(mockProjectWorkspaceService.updateProjectStatus).toHaveBeenCalledWith('proj1', ProjectStatus.READY_FOR_ESTIMATOR);
      expect(safeJson).toHaveBeenCalledWith(res, 200, { success: true, data: updatedProject });
    });
  });

  describe('assignEstimator', () => {
    it('should call service with id, estimatorID and estimatorName and return 200', async () => {
      req.params = { id: 'proj1' };
      req.body = { assignedEstimatorIds: ['est1'] };
      const assignedProject = { id: 'proj1', assignedEstimators: [{ id: 'est1', name: 'Bob', email: 'b@b.com' }] };
      mockProjectWorkspaceService.assignEstimator.mockResolvedValue(assignedProject);

      await projectWorkspaceController.assignEstimator(req as Request, res as Response);

      expect(mockProjectWorkspaceService.assignEstimator).toHaveBeenCalledWith('proj1', ['est1']);
      expect(safeJson).toHaveBeenCalledWith(res, 200, { success: true, data: assignedProject });
    });
  });
});
