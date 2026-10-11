import { Router } from 'express';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { UserRole } from '@db/models/user.model';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { MongooseUserRepository } from '@repositories/mongoose/user.repository';
import { notificationService } from '@features/notifications/notification.router';
import { teamsMembershipService } from '@features/teams/teams.router';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';

const projectRepository = new MongooseProjectRepository();
const userRepository = new MongooseUserRepository();

const projectsService = new ProjectsService(
  projectRepository,
  userRepository,
  notificationService,
  teamsMembershipService,
);
const projectsController = new ProjectsController(projectsService);

const router = Router();

// Everyone authenticated can list and view projects
router.get(
  '/',
  authenticate,
  asyncHandler((req, res) => projectsController.listProjects(req, res))
);

router.get(
  '/:projectId',
  authenticate,
  asyncHandler((req, res) => projectsController.getProjectById(req, res))
);

router.get(
  '/:projectId/related',
  authenticate,
  asyncHandler((req, res) => projectsController.getRelatedProjects(req, res))
);

// Only Sales Managers and Admins can update estimator assignments
router.put(
  '/:projectId/estimators',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler((req, res) => projectsController.updateEstimators(req, res))
);

// Trigger immediate bi-directional Dropbox sync for a project
router.post(
  '/:projectId/sync-dropbox',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler((req, res) => projectsController.syncDropbox(req, res))
);

export default router;
