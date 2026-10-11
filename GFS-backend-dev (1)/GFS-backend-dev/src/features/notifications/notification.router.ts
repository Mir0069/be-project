import { Router } from 'express';

import { authenticate } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { notificationRepository } from '@repositories/index';
import { mailerService } from '@shared/mailer';

import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { listNotificationsSchema, notificationIdSchema } from './notification.validation';

export const notificationService = new NotificationService(
  notificationRepository,
  undefined,
  mailerService,
);
const notificationController = new NotificationController(notificationService);

const router = Router();

router.get('/stream', authenticate, (req, res) => notificationController.stream(req, res));

router.get(
  '/',
  authenticate,
  validateRequest(listNotificationsSchema),
  asyncHandler((req, res) => notificationController.list(req, res)),
);

router.get(
  '/unread-count',
  authenticate,
  asyncHandler((req, res) => notificationController.unreadCount(req, res)),
);

router.get(
  '/draft-alerts/unread-count',
  authenticate,
  asyncHandler((req, res) => notificationController.unreadDraftAlertCount(req, res)),
);

router.patch(
  '/:id/read',
  authenticate,
  validateRequest(notificationIdSchema),
  asyncHandler((req, res) => notificationController.markRead(req, res)),
);

router.post(
  '/mark-all-read',
  authenticate,
  asyncHandler((req, res) => notificationController.markAllRead(req, res)),
);

router.post(
  '/mark-draft-alerts-read',
  authenticate,
  asyncHandler((req, res) => notificationController.markAllDraftAlertsRead(req, res)),
);

router.post(
  '/clear-all-mail',
  authenticate,
  asyncHandler((req, res) => notificationController.clearAllMail(req, res)),
);

export default router;
