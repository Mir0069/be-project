import { Request, Response } from 'express';
import { ProjectWorkspaceService, ProjectViewer } from './project-workspace.service';
import { safeJson } from '@shared/http/safe-json'; 
import { IProjectFilter, IPaginationOptions, ProjectStatus, ProjectType } from './project-workspace.types';

export class ProjectWorkspaceController {
  constructor(private readonly projectWorkspaceService: ProjectWorkspaceService) {}

  private viewerFrom(req: Request): ProjectViewer {
    const user = req.user!;
    return { userId: user.userId, role: user.role };
  }

  async getAllProjects(req: Request, res: Response): Promise<void> {
    const { page, limit, status, statusCategory, projectType, customerName, assignedEstimatorIds, isActive, referenceNumber, dueDate, search, updatedAfter, sortBy, sortOrder } = req.query;
    
    const filter: IProjectFilter = {
      status: status as ProjectStatus,
      statusCategory: statusCategory as IProjectFilter['statusCategory'],
      projectType: projectType as ProjectType,
      customerName: customerName as string,
      assignedEstimatorIds: assignedEstimatorIds as string[],
      isActive: isActive !== undefined ? String(isActive) === 'true' : undefined,
      referenceNumber: referenceNumber as string,
      dueDate: dueDate as string,
      search: search as string,
      updatedAfter: updatedAfter as string
    };
    
    const pagination: IPaginationOptions = {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as IPaginationOptions['sortBy'],
      sortOrder: sortOrder as 'asc' | 'desc'
    };

    const result = await this.projectWorkspaceService.getAllProjects(filter, pagination, this.viewerFrom(req));
    safeJson(res, 200, { success: true, data: result });
  }

  async getProjectById(req: Request, res: Response): Promise<void> {
    const project = await this.projectWorkspaceService.getProjectById(
      req.params['id'] as string,
      this.viewerFrom(req),
    );
    safeJson(res, 200, { success: true, data: project });
  }

  async getExternalContacts(req: Request, res: Response): Promise<void> {
    const contacts = await this.projectWorkspaceService.getExternalContacts(
      req.params['id'] as string,
      this.viewerFrom(req),
    );
    safeJson(res, 200, {
      success: true,
      data: { contacts, total: contacts.length },
    });
  }

  async updateProject(req: Request, res: Response): Promise<void> {
    const project = await this.projectWorkspaceService.updateProject(
      req.params['id'] as string,
      req.body,
      this.viewerFrom(req),
    );
    safeJson(res, 200, { success: true, data: project });
  }

  public async getActiveProjectsForAI(_req: Request, res: Response): Promise<void> {
    const projects = await this.projectWorkspaceService.getActiveProjectsForAI();
    safeJson(res, 200, { success: true, data: projects });
  }

  async updateProjectStatus(req: Request, res: Response): Promise<void> {
    const project = await this.projectWorkspaceService.updateProjectStatus(
      req.params['id'] as string,
      req.body.status,
      this.viewerFrom(req),
    );
    safeJson(res, 200, { success: true, data: project });
  }

  async assignEstimator(req: Request, res: Response): Promise<void> {
    const project = await this.projectWorkspaceService.assignEstimator(
      req.params['id'] as string,
      req.body.assignedEstimatorIds,
      req.user?.userId,
    );
    safeJson(res, 200, { success: true, data: project });
  }
}
