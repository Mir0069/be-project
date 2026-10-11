import { WorkflowService } from './workflow.service';
import { ProjectStatus, IProjectWorkspace, ProjectType } from './project-workspace.types';
import { AppError } from '@shared/errors/app.error';

describe('WorkflowService', () => {
  let workflowService: WorkflowService;
  
  beforeEach(() => {
    workflowService = new WorkflowService();
  });

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

  describe('canTransition()', () => {
    it('should allow valid transitions', () => {
      expect(workflowService.canTransition(ProjectStatus.SETUP_PENDING, ProjectStatus.WAITING_FOR_INPUTS)).toBe(true);
      expect(workflowService.canTransition(ProjectStatus.WAITING_FOR_INPUTS, ProjectStatus.READY_FOR_ESTIMATOR)).toBe(true);
      expect(workflowService.canTransition(ProjectStatus.READY_FOR_ESTIMATOR, ProjectStatus.ESTIMATOR_DRAFTING)).toBe(true);
      expect(workflowService.canTransition(ProjectStatus.ESTIMATOR_DRAFTING, ProjectStatus.ESTIMATOR_FINAL)).toBe(true);
    });

    it('should deny invalid transitions', () => {
      expect(workflowService.canTransition(ProjectStatus.SETUP_PENDING, ProjectStatus.ESTIMATOR_FINAL)).toBe(false);
      expect(workflowService.canTransition(ProjectStatus.ADMIN_PACKAGING, ProjectStatus.SETUP_PENDING)).toBe(false);
    });
  });

  describe('validateProjectReadiness()', () => {
    it('should throw if project is inactive', () => {
      const project = createMockProject({ isActive: false });
      expect(() => workflowService.validateProjectReadiness(project, ProjectStatus.WAITING_FOR_INPUTS))
        .toThrow(new AppError('Cannot transition an inactive project.', 400));
    });

    it('should require estimator, customerName, and dueDate for READY_FOR_ESTIMATOR', () => {
      // Missing assignedEstimatorID
      let project = createMockProject({ assignedEstimators: [], customerName: 'John', dueDate: new Date() });
      expect(() => workflowService.validateProjectReadiness(project, ProjectStatus.READY_FOR_ESTIMATOR))
        .toThrow(new AppError('Project must have an assigned estimator before moving to READY_FOR_ESTIMATOR.', 400));

      // Missing customerName
      project = createMockProject({ assignedEstimators: [{ id: 'id1', name: 'Est', email: 'e@e.com' }], customerName: '', dueDate: new Date() });
      expect(() => workflowService.validateProjectReadiness(project, ProjectStatus.READY_FOR_ESTIMATOR))
        .toThrow(new AppError('Project must have a customer name before moving to READY_FOR_ESTIMATOR.', 400));

      // Missing dueDate
      project = createMockProject({ assignedEstimators: [{ id: 'id1', name: 'Est', email: 'e@e.com' }], customerName: 'John', dueDate: undefined });
      expect(() => workflowService.validateProjectReadiness(project, ProjectStatus.READY_FOR_ESTIMATOR))
        .toThrow(new AppError('Project must have a due date before moving to READY_FOR_ESTIMATOR.', 400));
    });

    it('should not throw if READY_FOR_ESTIMATOR requirements are met', () => {
      const project = createMockProject({ 
        assignedEstimators: [{ id: 'id1', name: 'Est', email: 'e@e.com' }], 
        customerName: 'John', 
        dueDate: new Date() 
      });
      expect(() => workflowService.validateProjectReadiness(project, ProjectStatus.READY_FOR_ESTIMATOR)).not.toThrow();
    });
  });

  describe('validateTransitionRequirements()', () => {
    it('should throw if target status is the same as current status', () => {
      const project = createMockProject({ status: ProjectStatus.SETUP_PENDING });
      expect(() => workflowService.validateTransitionRequirements(project, ProjectStatus.SETUP_PENDING))
        .toThrow(new AppError('Project is already in status: SETUP_PENDING', 400));
    });

    it('should throw on invalid lifecycle transition', () => {
      const project = createMockProject({ status: ProjectStatus.SETUP_PENDING });
      expect(() => workflowService.validateTransitionRequirements(project, ProjectStatus.ESTIMATOR_FINAL))
        .toThrow(new AppError('Invalid status transition from SETUP_PENDING to ESTIMATOR_FINAL', 400));
    });

    it('should pass both checks successfully for a valid request', () => {
      const project = createMockProject({ status: ProjectStatus.SETUP_PENDING });
      expect(() => workflowService.validateTransitionRequirements(project, ProjectStatus.WAITING_FOR_INPUTS)).not.toThrow();
    });
  });
});
