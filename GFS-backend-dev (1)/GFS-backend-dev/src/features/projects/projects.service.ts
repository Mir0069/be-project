import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { hasAnyRole } from '@shared/security/role-access';
import { UserRole } from '@db/models/user.model';
import type { IProjectRepository, IDomainProject } from '@repositories/interfaces/i-project.repository';
import type { IUserRepository } from '@repositories/interfaces/i-user.repository';
import type { NotificationService } from '@features/notifications/notification.service';
import type { IProjectTeamsMembership } from '@features/teams/teams-membership.port';

export interface IUpdateEstimatorsRequest {
  estimatorIds: string[];
}

export interface IProjectViewer {
  userId: string;
  role: UserRole;
}

const ROLES_WITH_FULL_PROJECT_ACCESS: UserRole[] = [
  UserRole.SALES_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
];

const canViewAllProjects = (viewer: IProjectViewer): boolean =>
  hasAnyRole(viewer.role, ROLES_WITH_FULL_PROJECT_ACCESS);

const isAssignedEstimator = (project: IDomainProject, viewer: IProjectViewer): boolean =>
  project.assignedEstimators?.some(
    (estimator: any) => String(estimator?.id ?? estimator) === String(viewer.userId),
  ) ?? false;

export class ProjectsService {
  private readonly projectRepository: IProjectRepository;
  private readonly userRepository: IUserRepository;
  private readonly notificationService?: NotificationService;
  private readonly teamsMembership?: IProjectTeamsMembership;

  public constructor(
    projectRepository: IProjectRepository,
    userRepository: IUserRepository,
    notificationService?: NotificationService,
    teamsMembership?: IProjectTeamsMembership,
  ) {
    this.projectRepository = projectRepository;
    this.userRepository = userRepository;
    this.notificationService = notificationService;
    this.teamsMembership = teamsMembership;
  }

  private async findProjectByKey(key: string): Promise<IDomainProject | null> {
    // Public routes use reference numbers; legacy API consumers can continue
    // sending Mongo ObjectIds until they are migrated.
    if (/^[0-9a-fA-F]{24}$/.test(key)) {
      const byId = await this.projectRepository.findById(key);
      if (byId) return byId;
    }
    return this.projectRepository.findByReferenceNumber(key);
  }

  public async getProjectById(id: string, viewer: IProjectViewer): Promise<IDomainProject> {
    const project = await this.findProjectByKey(id);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND, true);
    }
    if (!canViewAllProjects(viewer) && !isAssignedEstimator(project, viewer)) {
      throw new AppError('You do not have permission to view this project', StatusCodes.FORBIDDEN, true);
    }
    return project;
  }

  /**
   * Estimators only get the projects assigned to them. Unassigned projects have
   * no estimator to match, so they drop out of the list entirely.
   */
  public async listProjects(viewer: IProjectViewer): Promise<IDomainProject[]> {
    const projects = await this.projectRepository.listActive();
    if (canViewAllProjects(viewer)) return projects;
    return projects.filter((project) => isAssignedEstimator(project, viewer));
  }

  public async updateEstimatorAssignments(
    id: string,
    input: IUpdateEstimatorsRequest,
    assignedBy?: string,
  ): Promise<IDomainProject> {
    const project = await this.findProjectByKey(id);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND, true);
    }

    const estimatorIds = input.estimatorIds || [];
    const previouslyAssignedIds = new Set((project.assignedEstimators ?? []).map((e) => e.id));
    const nameById = new Map<string, string | null>();
    const emailById = new Map<string, string | null>();

    for (const estimatorId of estimatorIds) {
      const user = await this.userRepository.findById(estimatorId);
      if (!user) {
        throw new AppError(`User with ID ${estimatorId} not found`, StatusCodes.BAD_REQUEST, true);
      }
      if (!hasAnyRole(user.role, [UserRole.ESTIMATOR])) {
        throw new AppError(`User with ID ${estimatorId} is not an Estimator`, StatusCodes.BAD_REQUEST, true);
      }
      nameById.set(estimatorId, `${user.firstName} ${user.lastName}`.trim() || null);
      emailById.set(estimatorId, user.email?.trim() || null);
    }

    const updated = await this.projectRepository.updateById(project.id, {
      assignedEstimators: estimatorIds,
    });

    if (!updated) {
      throw new AppError('Failed to update project', StatusCodes.INTERNAL_SERVER_ERROR, true);
    }

    const newlyAssigned = estimatorIds
      .filter((estimatorId) => !previouslyAssignedIds.has(estimatorId))
      .map((estimatorId) => {
        const email = emailById.get(estimatorId);
        return {
          id: estimatorId,
          name: nameById.get(estimatorId) ?? null,
          ...(email ? { email } : {}),
        };
      });

    if (this.notificationService && newlyAssigned.length > 0) {
      let assignedByName: string | null = null;
      if (assignedBy) {
        try {
          const assigner = await this.userRepository.findById(assignedBy);
          if (assigner) {
            assignedByName = `${assigner.firstName} ${assigner.lastName}`.trim() || null;
          }
        } catch {
          // ignore lookup failure
        }
      }

      await this.notificationService.notifyEstimatorAssigned({
        projectId: updated.id,
        referenceNumber: updated.referenceNumber,
        projectName: updated.projectName ?? null,
        estimators: newlyAssigned,
        assignedByName,
      });
    }

    if (newlyAssigned.length > 0) {
      await this.teamsMembership?.syncProject({ projectId: updated.id, assignedBy: assignedBy ?? null });
    }

    return updated;
  }

  public async getRelatedProjects(projectId: string, viewer: IProjectViewer): Promise<IDomainProject[]> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND, true);
    }
    if (!canViewAllProjects(viewer) && !isAssignedEstimator(project, viewer)) {
      throw new AppError('You do not have permission to view this project', StatusCodes.FORBIDDEN, true);
    }

    // If project has relatedProjectIds, fetch those
    const relatedIds = project.relatedProjectIds;
    if (relatedIds && relatedIds.length > 0) {
      const relatedProjects: IDomainProject[] = [];
      for (const id of relatedIds) {
        try {
          const p = await this.projectRepository.findById(String(id));
          if (p) relatedProjects.push(p);
        } catch (err) {
          // Skip invalid IDs
        }
      }
      return relatedProjects;
    }

    // If no relatedProjectIds but has groupId, find by groupId
    const groupId = project.groupId;
    if (groupId && this.projectRepository.findByGroupId) {
      const groupedProjects = await this.projectRepository.findByGroupId(groupId);
      return groupedProjects.filter((candidate) => candidate.id !== projectId);
    }

    return [];
  }
}
