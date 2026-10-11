import { IProjectRepository, IDomainProject } from '@repositories/interfaces/i-project.repository';
import { WorkflowService } from './workflow.service';
import { IProjectWorkspace, IProjectFilter, IPaginationOptions, IPaginatedResult, ProjectStatus, ProjectAnalysisStatus, IProjectExternalContact } from './project-workspace.types';
import type { StoredProjectStatus } from '@repositories/interfaces/i-project.repository';
import { AppError } from '@shared/errors/app.error';
import { IUserRepository } from '@repositories/interfaces/i-user.repository';
import type { IOutlookEmailRepository } from '@repositories/interfaces/i-outlook-email.repository';
import type { NotificationService } from '@features/notifications/notification.service';
import type { IProjectTeamsMembership } from '@features/teams/teams-membership.port';
import { refreshExternalContactsForProject } from './external-contacts';
import { UserRole } from '@db/models/user.model';
import { hasAnyRole } from '@shared/security/role-access';

export type ProjectViewer = {
  userId: string;
  role: UserRole;
};

const ROLES_WITH_FULL_PROJECT_ACCESS: UserRole[] = [
  UserRole.SALES_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
];

// A due date is a delivery commitment, so estimators may see it but cannot
// change it. Head of Division inherits Sales Manager access.
const ROLES_THAT_CAN_SET_DUE_DATE: UserRole[] = [
  UserRole.SALES_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
];

export class ProjectWorkspaceService {
  constructor(
    private readonly projectRepository: IProjectRepository,
    private readonly workflowService: WorkflowService,
    private readonly userRepository: IUserRepository,
    private readonly outlookEmailRepository: IOutlookEmailRepository,
    private readonly notificationService?: NotificationService,
    private readonly teamsMembership?: IProjectTeamsMembership,
  ) {}

  /**
   * Sales managers and admins work across the whole pipeline; an estimator only
   * ever sees the projects they are assigned to. An unassigned project belongs
   * to nobody, so it stays invisible to estimators until somebody assigns it.
   */
  private canViewAllProjects(viewer: ProjectViewer): boolean {
    return hasAnyRole(viewer.role, ROLES_WITH_FULL_PROJECT_ACCESS);
  }

  private isAssignedEstimator(project: IDomainProject, viewer: ProjectViewer): boolean {
    return project.assignedEstimators?.some(
      (estimator) => String(estimator?.id ?? estimator) === String(viewer.userId),
    ) ?? false;
  }

  /**
   * Throws 403 unless the viewer may open this project. Every project-scoped
   * read and write funnels through here so a new route cannot forget the check.
   */
  private assertCanAccessProject(project: IDomainProject, viewer: ProjectViewer): void {
    if (this.canViewAllProjects(viewer)) return;
    if (this.isAssignedEstimator(project, viewer)) return;
    throw new AppError('You do not have permission to view this project', 403);
  }

  private assertCanSetDueDate(viewer: ProjectViewer): void {
    if (hasAnyRole(viewer.role, ROLES_THAT_CAN_SET_DUE_DATE)) return;
    throw new AppError('Only managers and administrators can update the due date', 403);
  }

  /**
   * Narrows a list filter to what the viewer is allowed to see. For an estimator
   * this pins the estimator filter to their own id, which both hides other
   * people's projects and drops unassigned ones (an empty assignment array can
   * never match).
   */
  private scopeFilterToViewer(filter: IProjectFilter, viewer: ProjectViewer): IProjectFilter {
    if (this.canViewAllProjects(viewer)) return filter;
    return { ...filter, assignedEstimatorIds: [viewer.userId] };
  }

  private async findProjectByKey(key: string): Promise<IDomainProject | null> {
    // Keep existing ObjectId links working while allowing public reference
    // numbers in browser-facing routes.
    if (/^[0-9a-fA-F]{24}$/.test(key)) {
      const byId = await this.projectRepository.findById(key);
      if (byId) return byId;
    }
    return this.projectRepository.findByReferenceNumber(key);
  }

  // Mapper to safely convert IDomainProject to IProjectWorkspace (DTO)
  private toWorkspaceDTO(project: IDomainProject): IProjectWorkspace {
    const isUnderEstimation = [
      ProjectStatus.ESTIMATOR_DRAFTING,
      ProjectStatus.ESTIMATOR_FINAL,
      ProjectStatus.READY_FOR_ESTIMATOR,
      ProjectStatus.ADMIN_PACKAGING,
    ].includes(project.status as ProjectStatus);

    if (isUnderEstimation && project.analysisStatus === ProjectAnalysisStatus.PROCESSING) {
      this.projectRepository.updateById(project.id, { analysisStatus: ProjectAnalysisStatus.COMPLETED }).catch(() => {});
    }

    return {
      id: project.id,
      referenceNumber: project.referenceNumber,
      blobStorageURL: project.blobStorageURL,
      projectName: project.projectName,
      customerName: project.customerName,
      status: project.status,
      analysisStatus: isUnderEstimation && project.analysisStatus === ProjectAnalysisStatus.PROCESSING
        ? ProjectAnalysisStatus.COMPLETED
        : (project.analysisStatus ?? ProjectAnalysisStatus.NOT_STARTED),
      projectType: project.projectType,
      creationSource: project.creationSource,
      identifierHash: project.identifierHash,
      zohoLeadId: project.zohoLeadId,
      jobAddress: project.jobAddress,
      quoteNumber: project.quoteNumber,
      leadStatus: project.leadStatus,
      assignedEstimators: project.assignedEstimators,
      customerEmail: project.customerEmail,
      customerPhone: project.customerPhone,
      company: project.company,
      customerWebsite: project.customerWebsite,
      description: project.description,
      externalContacts: project.externalContacts ?? [],
      receivedDate: project.receivedDate,
      address: project.address,
      estimatorName: project.assignedEstimators?.[0]?.name || null,
      estimatorEmail: project.assignedEstimators?.[0]?.email || null,
      estimatorPhone: null,
      lastZohoSyncedAt: project.lastZohoSyncedAt,
      dueDate: project.dueDate,
      estimatedCost: project.estimatedCost,
      totalSqFt: project.totalSqFt,
      revisionRequest: project.revisionRequest ?? null,
      isActive: project.isActive,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };
  }

  async getAllProjects(
    rawFilter: IProjectFilter,
    pagination: IPaginationOptions,
    viewer: ProjectViewer,
  ): Promise<IPaginatedResult<IProjectWorkspace>> {
    const filter = this.scopeFilterToViewer(rawFilter, viewer);
    const page = pagination.page || 1;
    const limit = pagination.limit || 10;
    const sortBy = pagination.sortBy || 'createdAt';
    const sortOrder = pagination.sortOrder || 'desc';
    const statusesByCategory: Partial<Record<NonNullable<IProjectFilter['statusCategory']>, StoredProjectStatus[]>> = {
      NOT_STARTED: [ProjectStatus.SETUP_PENDING],
      // Include the legacy value so existing projects do not disappear from
      // the Pending filter after the status contract was renamed.
      PENDING: [ProjectStatus.WAITING_FOR_INPUTS, 'PENDING'],
      READY_FOR_ESTIMATOR: [ProjectStatus.READY_FOR_ESTIMATOR],
      IN_PROGRESS: [ProjectStatus.ESTIMATOR_DRAFTING, ProjectStatus.ESTIMATOR_FINAL],
      NEEDS_REVISION: [ProjectStatus.NEEDS_REVISION],
      COMPLETED: [ProjectStatus.ADMIN_PACKAGING],
    };
    const statuses = filter.status
      ? [filter.status]
      : filter.statusCategory && filter.statusCategory !== 'AI_PROCESSING'
        ? statusesByCategory[filter.statusCategory]
        : undefined;

    const analysisStatuses = filter.statusCategory === 'AI_PROCESSING'
      ? [ProjectAnalysisStatus.PROCESSING]
      : undefined;

    const excludeAnalysisStatuses = filter.statusCategory === 'PENDING'
      ? [ProjectAnalysisStatus.PROCESSING]
      : undefined;

    if (this.projectRepository.listActivePaginated) {
      const result = await this.projectRepository.listActivePaginated({
        page,
        limit,
        statuses,
        analysisStatuses,
        excludeAnalysisStatuses,
        projectType: filter.projectType,
        customerName: filter.customerName,
        assignedEstimatorIds: filter.assignedEstimatorIds,
        referenceNumber: filter.referenceNumber,
        search: filter.search,
        updatedAfter: filter.updatedAfter ? new Date(filter.updatedAfter) : undefined,
        sortBy,
        sortOrder,
      });
      return {
        data: result.data.map((project) => this.toWorkspaceDTO(project)),
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      };
    }

    let projects = await this.projectRepository.listActive();

    if (filter.status) projects = projects.filter(p => p.status === filter.status);
    if (filter.statusCategory === 'AI_PROCESSING') {
      projects = projects.filter(p => p.analysisStatus === ProjectAnalysisStatus.PROCESSING);
    } else if (filter.statusCategory === 'PENDING') {
      const pendingStatuses = statusesByCategory.PENDING ?? [];
      projects = projects.filter(p => pendingStatuses.includes(p.status) && p.analysisStatus !== ProjectAnalysisStatus.PROCESSING);
    } else if (filter.statusCategory && statusesByCategory[filter.statusCategory]) {
      const allowed = statusesByCategory[filter.statusCategory]!;
      projects = projects.filter((project) => allowed.includes(project.status));
    }
    if (filter.projectType) projects = projects.filter(p => p.projectType === filter.projectType);
    if (filter.customerName) projects = projects.filter(p => p.customerName.toLowerCase().includes(filter.customerName!.toLowerCase()));
    if (filter.assignedEstimatorIds && filter.assignedEstimatorIds.length > 0) projects = projects.filter(p => p.assignedEstimators?.some(e => filter.assignedEstimatorIds!.includes(e.id)));
    if (filter.referenceNumber) projects = projects.filter(p => p.referenceNumber.includes(filter.referenceNumber!));
    if (filter.search) {
      const search = filter.search.toLowerCase();
      projects = projects.filter((project) => {
        const address = project.address
          ? Object.values(project.address).filter(Boolean).join(' ')
          : '';
        return [
          project.projectName,
          project.customerName,
          project.referenceNumber,
          project.jobAddress,
          address,
        ].some((value) => String(value ?? '').toLowerCase().includes(search));
      });
    }
    if (filter.updatedAfter) {
      const updatedAfter = new Date(filter.updatedAfter).getTime();
      projects = projects.filter((project) => project.updatedAt.getTime() >= updatedAfter);
    }

    const sortMultiplier = sortOrder === 'asc' ? 1 : -1;
    projects.sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];
      if (valA instanceof Date || valB instanceof Date) {
        return ((valA instanceof Date ? valA.getTime() : 0) - (valB instanceof Date ? valB.getTime() : 0)) * sortMultiplier;
      }
      return String(valA ?? '').localeCompare(String(valB ?? ''), undefined, { sensitivity: 'base' }) * sortMultiplier;
    });

    const total = projects.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedData = projects.slice((page - 1) * limit, page * limit);

    return {
      data: paginatedData.map(p => this.toWorkspaceDTO(p)),
      total,
      page,
      limit,
      totalPages
    };
  }

  async getProjectById(id: string, viewer: ProjectViewer): Promise<IProjectWorkspace> {
    const project = await this.findProjectByKey(id);
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    this.assertCanAccessProject(project, viewer);
    return this.toWorkspaceDTO(project);
  }

  async getExternalContacts(
    id: string,
    viewer: ProjectViewer,
  ): Promise<IProjectExternalContact[]> {
    const project = await this.findProjectByKey(id);
    if (!project) {
      throw new AppError('Project not found', 404);
    }

    this.assertCanAccessProject(project, viewer);

    return refreshExternalContactsForProject(
      project.id,
      this.projectRepository,
      this.outlookEmailRepository,
    );
  }

  async updateProject(
    id: string,
    data: Partial<IProjectWorkspace>,
    viewer: ProjectViewer,
  ): Promise<IProjectWorkspace> {
    const existing = await this.findProjectByKey(id);
    if (!existing) {
      throw new AppError('Project not found', 404);
    }
    this.assertCanAccessProject(existing, viewer);
    if (data.dueDate !== undefined) this.assertCanSetDueDate(viewer);
    const updated = await this.projectRepository.updateById(existing.id, data as any);
    if (!updated) {
      throw new AppError('Project not found', 404);
    }
    return this.toWorkspaceDTO(updated);
  }

  async updateProjectStatus(
    id: string,
    newStatus: ProjectStatus,
    viewer: ProjectViewer,
  ): Promise<IProjectWorkspace> {
    const project = await this.findProjectByKey(id);
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    this.assertCanAccessProject(project, viewer);
    const existing = this.toWorkspaceDTO(project);

    this.workflowService.validateTransitionRequirements(existing, newStatus);

    const updateFields: any = { status: newStatus };
    if (newStatus === ProjectStatus.ADMIN_PACKAGING) {
      updateFields.analysisStatus = ProjectAnalysisStatus.COMPLETED;
    }

    const updated = await this.projectRepository.updateById(project.id, updateFields);
    if (!updated) {
      throw new AppError('Failed to update project status', 500);
    }

    return this.toWorkspaceDTO(updated);
  }

  async archiveProject(id: string): Promise<IProjectWorkspace> {
    const existing = await this.findProjectByKey(id);
    if (!existing) {
      throw new AppError('Project not found', 404);
    }
    const archived = await this.projectRepository.updateById(existing.id, { isActive: false });
    if (!archived) {
      throw new AppError('Project not found', 404);
    }
    return this.toWorkspaceDTO(archived);
  }

  async assignEstimator(id: string, estimatorIds: string[], assignedBy?: string): Promise<IProjectWorkspace> {
    const project = await this.findProjectByKey(id);
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    const existing = this.toWorkspaceDTO(project);
    const previouslyAssignedIds = new Set((existing.assignedEstimators ?? []).map((e) => e.id));

    const estimators = await Promise.all(
      estimatorIds.map(async (estimatorId) => {
        const estimator = await this.userRepository.findById(estimatorId);
        if (!estimator) {
          throw new AppError(`Estimator not found or invalid ObjectId: ${estimatorId}`, 404);
        }
        if (!estimator.isActive) {
          throw new AppError(`Cannot assign an inactive estimator: ${estimator.email}`, 400);
        }
        return estimator;
      })
    );

    const updated = await this.projectRepository.updateById(project.id, {
      assignedEstimators: estimators.map(e => e.id)
    });

    if (!updated) {
      throw new AppError('Failed to assign estimator to project', 500);
    }

    const newlyAssigned = estimators
      .filter((e) => !previouslyAssignedIds.has(e.id))
      .map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim() || null,
        ...(e.email ? { email: e.email.trim() } : {}),
      }));

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

    return this.toWorkspaceDTO(updated);
  }

  public async getActiveProjectsForAI(): Promise<any[]> {
    // Fetch all active projects
    const projects = await this.projectRepository.listActive();
    
    // Map to a lightweight object for the AI context window
    return projects.map(p => ({
      projectId: p.id,
      referenceNumber: p.referenceNumber,
      projectName: p.projectName,
      customerName: p.customerName,
      jobAddress: p.jobAddress,
      address: p.address,
      status: p.status,
      customerEmail: p.customerEmail
    }));
  }
}
