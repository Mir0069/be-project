import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { safeJson } from '@shared/http/safe-json';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  canViewAllNotifications,
  NotificationType,
} from '@db/models/notification.model';
import { UserRole } from '@db/models/user.model';

import type { NotificationService } from './notification.service';
import { notificationEventBus, NotificationEvent } from './notification.events';
import type { NotificationCreatedPayload } from './notification.events';

export class NotificationController {
  private readonly notificationService: NotificationService;

  public constructor(notificationService: NotificationService) {
    this.notificationService = notificationService;
  }

  public async list(req: Request, res: Response): Promise<void> {
    const { userId, role } = this.requireUser(req);
    const page = Number(req.query['page'] ?? 1);
    const limit = Number(req.query['limit'] ?? 20);
    const result = await this.notificationService.listForUser({ role, userId, page, limit });
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async unreadCount(req: Request, res: Response): Promise<void> {
    const { userId, role } = this.requireUser(req);
    const count = await this.notificationService.unreadCount({ role, userId });
    safeJson(res, StatusCodes.OK, { success: true, data: { count } });
  }

  public async unreadDraftAlertCount(req: Request, res: Response): Promise<void> {
    const { userId, role } = this.requireUser(req);
    const count = await this.notificationService.unreadDraftAlertCount({ role, userId });
    safeJson(res, StatusCodes.OK, { success: true, data: { count } });
  }

  public async markRead(req: Request, res: Response): Promise<void> {
    const { userId } = this.requireUser(req);
    const id = req.params['id'] as string;
    const found = await this.notificationService.markRead(id, userId);
    if (!found) {
      throw new AppError('Notification not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }
    safeJson(res, StatusCodes.OK, { success: true, message: 'Notification marked as read' });
  }

  public async markAllRead(req: Request, res: Response): Promise<void> {
    const { userId, role } = this.requireUser(req);
    const modified = await this.notificationService.markAllRead(role, userId);
    safeJson(res, StatusCodes.OK, { success: true, data: { modified } });
  }

  public async markAllDraftAlertsRead(req: Request, res: Response): Promise<void> {
    const { userId, role } = this.requireUser(req);
    const modified = await this.notificationService.markAllDraftAlertsRead(role, userId);
    safeJson(res, StatusCodes.OK, { success: true, data: { modified } });
  }

  public async clearAllMail(req: Request, res: Response): Promise<void> {
    const { userId, role } = this.requireUser(req);
    const modified = await this.notificationService.clearAllMail(role, userId);
    safeJson(res, StatusCodes.OK, { success: true, data: { modified } });
  }

  public stream(req: Request, res: Response): void {
    const { userId, role } = this.requireUser(req);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    this.write(res, { type: 'CONNECTED' });

    const onCreated = (payload: NotificationCreatedPayload): void => {
      const forRole = payload.roles.includes(role);
      const forUser = payload.userIds.includes(userId);
      const isEstimatorOpportunity = role === UserRole.ESTIMATOR
        && payload.view.type === NotificationType.DRAFT_REQUIRES_REVIEW;

      if (!isEstimatorOpportunity && (canViewAllNotifications(role) || forRole || forUser)) {
        this.write(res, { type: 'NOTIFICATION_CREATED', data: payload.view });
      }
    };

    notificationEventBus.on(NotificationEvent.CREATED, onCreated);

    req.on('close', () => {
      notificationEventBus.off(NotificationEvent.CREATED, onCreated);
      res.end();
    });
  }

  private write(res: Response, payload: unknown): void {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    const flushable = res as Response & { flush?: () => void };
    if (typeof flushable.flush === 'function') flushable.flush();
  }

  private requireUser(req: Request): { userId: string; role: UserRole } {
    if (!req.user) {
      throw new AppError('Authentication required', StatusCodes.UNAUTHORIZED, true, {
        code: ErrorCode.UNAUTHORIZED,
      });
    }
    return { userId: req.user.userId, role: req.user.role };
  }
}
