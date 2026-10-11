import { StatusCodes } from "http-status-codes";
import type { Request, Response } from "express";
import { safeJson } from "@shared/http/safe-json";
import type {
  ProjectsService,
  IUpdateEstimatorsRequest,
  IProjectViewer,
} from "./projects.service";
import { dropboxSyncService } from "./dropbox-sync.service";

export class ProjectsController {
  private readonly projectsService: ProjectsService;

  public constructor(projectsService: ProjectsService) {
    this.projectsService = projectsService;
  }

  private viewerFrom(req: Request): IProjectViewer {
    const user = req.user!;
    return { userId: user.userId, role: user.role };
  }

  public async listProjects(req: Request, res: Response): Promise<void> {
    const projects = await this.projectsService.listProjects(this.viewerFrom(req));
    safeJson(res, StatusCodes.OK, {
      success: true,
      data: projects,
    });
  }

  public async getProjectById(req: Request, res: Response): Promise<void> {
    const projectId = req.params["projectId"] as string;
    const project = await this.projectsService.getProjectById(projectId, this.viewerFrom(req));
    safeJson(res, StatusCodes.OK, {
      success: true,
      data: project,
    });
  }

  public async updateEstimators(req: Request, res: Response): Promise<void> {
    const projectId = req.params["projectId"] as string;
    const input = req.body as IUpdateEstimatorsRequest;

    const updated = await this.projectsService.updateEstimatorAssignments(
      projectId,
      input,
      req.user?.userId,
    );
    safeJson(res, StatusCodes.OK, {
      success: true,
      message: "Estimators updated successfully",
      data: updated,
    });
  }

  /**
   * POST /:projectId/sync-dropbox
   * Triggers an immediate bi-directional Dropbox sync for the given project in the background.
   */
  public async syncDropbox(req: Request, res: Response): Promise<void> {
    const projectId = req.params["projectId"] as string;

    // Trigger sync in the background
    dropboxSyncService.syncProject(projectId).catch((err: any) => {
      console.error(
        `[DropboxSync] Manual background sync failed for project ${projectId}:`,
        err?.message ?? err,
      );
    });

    safeJson(res, StatusCodes.ACCEPTED, {
      success: true,
      message: "Dropbox sync started in the background",
    });
  }

  /**
   * GET /:projectId/related
   * Get all related projects (competitive bidding at same address)
   */
  public async getRelatedProjects(req: Request, res: Response): Promise<void> {
    const projectId = req.params["projectId"] as string;

    const related = await this.projectsService.getRelatedProjects(projectId, this.viewerFrom(req));
    safeJson(res, StatusCodes.OK, {
      success: true,
      data: related,
    });
  }
}
