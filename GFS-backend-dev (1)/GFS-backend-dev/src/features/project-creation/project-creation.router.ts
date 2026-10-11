import { Router } from 'express';

import { authenticate, authorize } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { UserRole } from '@db/models/user.model';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { MongooseSequenceRepository } from '@repositories/mongoose/sequence.repository';
import { MongooseProjectParameterRepository } from '@repositories/mongoose/project-parameter.repository';
import { AzureBlobRepository } from '@repositories/azure/azure-blob.repository';
import { teamsMembershipService } from '@features/teams/teams.router';
import { mailerService } from '@shared/mailer';
import { notificationService } from '@features/notifications/notification.router';

import { ProjectCreationService } from './project-creation.service';
import { ProjectCreationController } from './project-creation.controller';
import { createProjectSchema } from './project-creation.validation';

const projectRepository = new MongooseProjectRepository();
const sequenceRepository = new MongooseSequenceRepository();
const projectParameterRepository = new MongooseProjectParameterRepository();
const fileStorageRepository = new AzureBlobRepository();

export const projectCreationService = new ProjectCreationService(
  projectRepository,
  sequenceRepository,
  fileStorageRepository,
  projectParameterRepository,
  teamsMembershipService,
  mailerService,
  notificationService,
);

const projectCreationController = new ProjectCreationController(projectCreationService);

const router = Router();

router.post(
  '/',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN),
  validateRequest(createProjectSchema),
  asyncHandler((req, res) => projectCreationController.create(req, res)),
);

export default router;
