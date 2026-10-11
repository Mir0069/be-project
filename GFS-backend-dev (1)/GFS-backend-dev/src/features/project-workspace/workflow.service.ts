import { ProjectStatus, ALLOWED_TRANSITIONS, IProjectWorkspace } from './project-workspace.types';
import { AppError } from '@shared/errors/app.error';

/**
 * Lightweight service for workflow and lifecycle logic.
 * Responsible for checking state transitions and enforcing business readiness validations.
 */
export class WorkflowService {
  constructor() {}

  canTransition(currentStatus: ProjectStatus, nextStatus: ProjectStatus): boolean {
    const allowedNextStates = ALLOWED_TRANSITIONS[currentStatus];
    return allowedNextStates?.includes(nextStatus) ?? false;
  }

  validateProjectReadiness(project: IProjectWorkspace, targetStatus: ProjectStatus): void {
    if (!project.isActive) {
      throw new AppError('Cannot transition an inactive project.', 400);
    }

    switch (targetStatus) {
      case ProjectStatus.READY_FOR_ESTIMATOR:
        if (!project.assignedEstimators || project.assignedEstimators.length === 0) {
          throw new AppError('Project must have an assigned estimator before moving to READY_FOR_ESTIMATOR.', 400);
        }
        if (!project.customerName) {
          throw new AppError('Project must have a customer name before moving to READY_FOR_ESTIMATOR.', 400);
        }
        if (!project.dueDate) {
          throw new AppError('Project must have a due date before moving to READY_FOR_ESTIMATOR.', 400);
        }
        break;
      
      // Extensible: Future business rules for states like ESTIMATOR_FINAL can be cleanly added here.
      default:
        break;
    }
  }

  validateTransitionRequirements(project: IProjectWorkspace, nextStatus: ProjectStatus): void {
    if (project.status === nextStatus) {
      throw new AppError(`Project is already in status: ${project.status}`, 400);
    }

    if (!this.canTransition(project.status, nextStatus)) {
      throw new AppError(`Invalid status transition from ${project.status} to ${nextStatus}`, 400);
    }

    this.validateProjectReadiness(project, nextStatus);
  }

  async executeTransitionActions(_projectId: string, _newStatus: string): Promise<void> {
    throw new Error('Not implemented yet');
  }
}