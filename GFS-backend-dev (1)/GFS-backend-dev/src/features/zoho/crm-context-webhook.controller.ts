import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

/**
 * Handles inbound webhook calls from the AI service that carry an updated
 * project description derived from Zoho CRM context (notes + lead data).
 *
 * The AI service is already authenticated via the Service Bus queue that
 * triggered it, so this endpoint requires no additional auth middleware.
 */
export class CrmContextWebhookController {
  private readonly projectRepository: IProjectRepository;

  public constructor(projectRepository?: IProjectRepository) {
    this.projectRepository = projectRepository ?? new MongooseProjectRepository();
  }

  /**
   * PUT /crm-context/:projectId
   *
   * Expected body: `{ description: string }`
   */
  public async handleCrmContextUpdate(req: Request, res: Response): Promise<void> {
    const projectId = Array.isArray(req.params['projectId'])
      ? req.params['projectId'][0]
      : req.params['projectId'];
    const { description } = req.body as { description?: string };

    if (!projectId || typeof projectId !== 'string') {
      res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Missing or invalid projectId parameter.' });
      return;
    }

    if (description === undefined || description === null) {
      res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Missing description in request body.' });
      return;
    }

    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      res.status(StatusCodes.NOT_FOUND).json({ success: false, message: `Project ${projectId} not found.` });
      return;
    }

    await this.projectRepository.updateById(projectId, { description });

    res.status(StatusCodes.OK).json({ success: true, projectId });
  }
}
