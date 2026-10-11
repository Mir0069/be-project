import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UserRole } from '@db/models/user.model';
import { safeJson } from '@shared/http/safe-json';
import { auditLogService } from './audit-logs.service';
import type { AuditLogCategory, AuditLogListQuery } from './audit-logs.types';

export class AuditLogsController {
  public async list(req: Request, res: Response): Promise<void> {
    const user = req.user!;
    const query: AuditLogListQuery = {
      since: typeof req.query['since'] === 'string' ? req.query['since'] : undefined,
      actorEmail: typeof req.query['actorEmail'] === 'string' ? req.query['actorEmail'] : undefined,
      projectId: typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined,
      page: Number(req.query['page'] ?? 1),
      limit: Number(req.query['limit'] ?? 25),
      action: typeof req.query['action'] === 'string' ? req.query['action'] : undefined,
      category: typeof req.query['category'] === 'string'
        ? req.query['category'] as AuditLogCategory
        : undefined,
    };

    const data = await auditLogService.listForViewer(
      { userId: user.userId, role: user.role as UserRole },
      query,
    );
    safeJson(res, StatusCodes.OK, { success: true, data });
  }
}
