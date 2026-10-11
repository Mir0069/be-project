import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { safeJson } from '@shared/http/safe-json';
import { ProjectCreationSource } from '@db/models/project.model';

import type { ProjectCreationService } from './project-creation.service';
import type { CreateProjectInput } from './project-creation.types';
import { toCentralizedView } from './project-creation.mapper';

export class ProjectCreationController {
  public constructor(private readonly projectCreationService: ProjectCreationService) {}

  public async create(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateProjectInput;
    const project = await this.projectCreationService.create(input, {
      creationSource: ProjectCreationSource.MANUAL,
      assignedBy: req.user?.userId ?? null,
    });
    safeJson(res, StatusCodes.CREATED, { success: true, data: toCentralizedView(project) });
  }
}
