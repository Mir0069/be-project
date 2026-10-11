import { Router } from 'express';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { UserRole } from '@db/models/user.model';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { AuditLogsController } from './audit-logs.controller';
import { listAuditLogsSchema } from './audit-logs.validation';

const router = Router();
const controller = new AuditLogsController();

router.get(
  '/',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.HEAD_OF_DIVISION),
  validateRequest(listAuditLogsSchema),
  asyncHandler((req, res) => controller.list(req, res)),
);

export default router;
