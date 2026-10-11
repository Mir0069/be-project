import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { safeJson } from '@shared/http/safe-json';

import type { MailFirstService } from './mail-first.service';

export class MailFirstController {
  public constructor(private readonly mailFirstService: MailFirstService) {}

  public async approve(req: Request, res: Response): Promise<void> {
    const result = await this.mailFirstService.approveDraft(req.params['emailId'] as string);
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async reject(req: Request, res: Response): Promise<void> {
    await this.mailFirstService.rejectDraft(req.params['emailId'] as string);
    safeJson(res, StatusCodes.OK, { success: true, data: { discarded: true } });
  }

  public async link(req: Request, res: Response): Promise<void> {
    const emailId = req.params['emailId'] as string;
    const projectId = req.body.projectId as string;
    const result = await this.mailFirstService.linkDraftToProject(emailId, projectId);
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async updateDraft(req: Request, res: Response): Promise<void> {
    const result = await this.mailFirstService.updateDraftProjectName(
      req.params['emailId'] as string,
      req.body.projectName as string,
    );
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async listDrafts(_req: Request, res: Response): Promise<void> {
    const drafts = await this.mailFirstService.listPendingDrafts();
    safeJson(res, StatusCodes.OK, { success: true, data: drafts });
  }

  // Streams a draft attachment through the API so the browser never sees the
  // Azure blob URL. `inline` + filename makes the browser render it and title
  // the tab with the document name.
  public async previewAttachment(req: Request, res: Response): Promise<void> {
    const file = await this.mailFirstService.previewDraftAttachment(
      req.params['emailId'] as string,
      String(req.body?.storageKey ?? '').trim(),
    );

    if (file.contentType) res.setHeader('Content-Type', file.contentType);
    if (file.contentLength !== undefined) {
      res.setHeader('Content-Length', String(file.contentLength));
    }
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/"/g, '')}"`,
    );
    file.stream.pipe(res);
  }
}
