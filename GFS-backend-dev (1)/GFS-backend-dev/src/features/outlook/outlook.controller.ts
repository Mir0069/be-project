import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { safeJson } from '@shared/http/safe-json';

import type { OutlookService } from './outlook.service';

export class OutlookController {
  private readonly outlookService: OutlookService;

  public constructor(outlookService: OutlookService) {
    this.outlookService = outlookService;
  }

  public getAuthUrl(req: Request, res: Response): void {
    const url = this.outlookService.getAuthUrl();
    if (req.query['format'] === 'json') {
      safeJson(res, StatusCodes.OK, { success: true, data: { url } });
      return;
    }
    res.redirect(url);
  }

  public async handleAuthCallback(req: Request, res: Response): Promise<void> {
    const code = req.query['code'] as string | undefined;
    const error = req.query['error'] as string | undefined;
    const errorDescription = req.query['error_description'] as string | undefined;

    if (error) {
      res.status(StatusCodes.BAD_REQUEST).send(`
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:50px auto;padding:30px;border-radius:12px;background:#fff;border:1px solid #fee2e2;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);text-align:center;">
          <h2 style="color:#ef4444;margin-bottom:8px;">❌ Microsoft Authentication Failed</h2>
          <p style="color:#4b5563;margin-bottom:16px;"><strong>Error:</strong> ${error}</p>
          <p style="color:#6b7280;font-size:14px;">${errorDescription || ''}</p>
        </div>
      `);
      return;
    }

    if (!code) {
      res.status(StatusCodes.BAD_REQUEST).send(`
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:50px auto;padding:30px;border-radius:12px;background:#fff;border:1px solid #fee2e2;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);text-align:center;">
          <h2 style="color:#ef4444;margin-bottom:8px;">❌ Authorization Code Missing</h2>
          <p style="color:#6b7280;">No authorization code was returned by Microsoft.</p>
        </div>
      `);
      return;
    }

    await this.outlookService.handleAuthCallback(code);

    res.status(StatusCodes.OK).send(`
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:50px auto;padding:32px;border-radius:16px;background:#ffffff;border:1px solid #d1fae5;box-shadow:0 10px 15px -3px rgba(0,0,0,0.08);text-align:center;">
        <div style="width:64px;height:64px;background:#ecfdf5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;">
          ✅
        </div>
        <h2 style="color:#065f46;margin-bottom:8px;font-size:24px;">Outlook Account Connected!</h2>
        <p style="color:#374151;font-size:15px;line-height:1.5;margin-bottom:16px;">
          Your personal Microsoft Outlook account has been authenticated successfully.
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;color:#4b5563;margin-bottom:24px;text-align:left;">
          <div><strong>Token Type:</strong> Delegated (Access + Refresh Token)</div>
          <div><strong>Sync Mode:</strong> Auto-polling enabled via /me/mailFolders</div>
        </div>
        <p style="color:#9ca3af;font-size:13px;margin:0;">
          You can safely close this browser window.
        </p>
      </div>
    `);
  }

  public async getStatus(_req: Request, res: Response): Promise<void> {
    const status = await this.outlookService.getStatus();
    safeJson(res, StatusCodes.OK, { success: true, data: status });
  }

  public async listMailUsers(req: Request, res: Response): Promise<void> {
    const { search } = req.query as Record<string, string | undefined>;
    const users = await this.outlookService.listMailUsers(search);
    safeJson(res, StatusCodes.OK, { success: true, data: { users } });
  }

  public async listMailFolders(req: Request, res: Response): Promise<void> {
    const userId = req.params['userId'] as string;
    const folders = await this.outlookService.listMailFolders(userId);
    safeJson(res, StatusCodes.OK, { success: true, data: { folders } });
  }

  public async addMonitoredMailbox(req: Request, res: Response): Promise<void> {
    const mailbox = await this.outlookService.addMonitoredMailbox(req.body);
    safeJson(res, StatusCodes.CREATED, { success: true, data: { mailbox } });
  }

  public async listMonitoredMailboxes(_req: Request, res: Response): Promise<void> {
    const mailboxes = await this.outlookService.listMonitoredMailboxes();
    safeJson(res, StatusCodes.OK, { success: true, data: { mailboxes } });
  }

  public async removeMonitoredMailbox(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    await this.outlookService.removeMonitoredMailbox(id);
    safeJson(res, StatusCodes.OK, { success: true, message: 'Mailbox monitoring stopped' });
  }

  public async sync(req: Request, res: Response): Promise<void> {
    const mailboxDbId =
      req.body && typeof req.body.mailboxDbId === 'string' ? req.body.mailboxDbId : undefined;
    const result = await this.outlookService.sync(mailboxDbId);
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async listEmails(req: Request, res: Response): Promise<void> {
    const { projectId, mailboxUserId, conversationId, page, limit } = req.query as Record<
      string,
      string | undefined
    >;
    const result = await this.outlookService.listEmails({
      projectId,
      mailboxUserId,
      conversationId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async linkEmail(req: Request, res: Response): Promise<void> {
    const messageId = req.params['messageId'] as string;
    const email = await this.outlookService.linkEmail(messageId, req.body.projectId);
    safeJson(res, StatusCodes.OK, { success: true, data: { email } });
  }

  public async handleAiResult(req: Request, res: Response): Promise<void> {
    await this.outlookService.processAiResult(req.body);
    safeJson(res, StatusCodes.OK, { success: true, message: 'AI result processed successfully' });
  }

  public async moveEmail(req: Request, res: Response): Promise<void> {
    const emailId = req.params['emailId'] as string;
    const { targetProjectId, runExtraction } = req.body;
    const result = await this.outlookService.moveEmail(emailId, targetProjectId, { runExtraction });
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }
}

