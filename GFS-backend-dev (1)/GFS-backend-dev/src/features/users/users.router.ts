import { Router } from 'express';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { userRepository, passwordResetTokenRepository } from '@repositories/index';
import { mailerService } from '@shared/mailer/index';
import { UserRole } from '@db/models/user.model';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { createUserSchema, editUserSchema } from './users.validation';

export const usersService = new UsersService(
  userRepository,
  passwordResetTokenRepository,
  mailerService,
);
const usersController = new UsersController(usersService);

const router = Router();

const guard = [authenticate, authorize(UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN)];

router.post(
  '/createuser',
  ...guard,
  validateRequest(createUserSchema),
  asyncHandler((req, res) => usersController.createUser(req, res)),
);

router.get(
  '/getalluser',
  ...guard,
  asyncHandler((req, res) => usersController.listUsers(req, res)),
);

router.get(
  '/estimators',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler((req, res) => usersController.listEstimators(req, res)),
);

router.get(
  '/sales-managers',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler((req, res) => usersController.listSalesManagers(req, res)),
);

router.put(
  '/edituser/:id',
  ...guard,
  validateRequest(editUserSchema),
  asyncHandler((req, res) => usersController.editUser(req, res)),
);

router.put(
  '/disableuser/:id',
  ...guard,
  asyncHandler((req, res) => usersController.disableUser(req, res)),
);

router.post(
  '/resetpassword/:id',
  ...guard,
  asyncHandler((req, res) => usersController.resetUserPassword(req, res)),
);

export default router;
