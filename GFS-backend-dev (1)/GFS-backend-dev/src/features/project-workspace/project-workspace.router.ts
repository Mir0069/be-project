import { Router } from 'express';
import { ProjectWorkspaceController } from './project-workspace.controller';
import { ProjectWorkspaceService } from './project-workspace.service';
import { WorkflowService } from './workflow.service';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { MongooseUserRepository } from '@repositories/mongoose/user.repository';
import { MongooseOutlookEmailRepository } from '@repositories/mongoose/outlook-email.repository';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { UserRole } from '@db/models/user.model';
import { notificationService } from '@features/notifications/notification.router';
import { teamsMembershipService } from '@features/teams/teams.router';
import { updateProjectSchema, getProjectsQuerySchema, projectIdSchema, updateProjectStatusSchema, assignEstimatorSchema } from './project-workspace.types';


const router = Router();

// 1. Instantiate Repositories
const projectRepository = new MongooseProjectRepository();
const userRepository = new MongooseUserRepository();
const outlookEmailRepository = new MongooseOutlookEmailRepository();

// 2. Instantiate Services
const workflowService = new WorkflowService();
export const projectWorkspaceService = new ProjectWorkspaceService(
  projectRepository,
  workflowService,
  userRepository,
  outlookEmailRepository,
  notificationService,
  teamsMembershipService,
);

// 3. Instantiate Controller
const projectWorkspaceController = new ProjectWorkspaceController(projectWorkspaceService);

// 4. Common Guards
// For now Estimators, Sales Manager and Admins have access to the workspace.
const requireAuth = authenticate;
const requireElevated = [authenticate, authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)];

// 5. Register Routes
router.get(
  '/ai-context',
  // We might want a specific machine-to-machine API key middleware here later, 
  // but for now we can use requireAuth
  requireAuth, 
  asyncHandler((req: any, res: any) => projectWorkspaceController.getActiveProjectsForAI(req, res))
);
router.get(
  '/',
  requireAuth, // Any authenticated user can view the list of projects, but the service will filter based on their role and assignments
  validateRequest(getProjectsQuerySchema),
  asyncHandler((req: any, res: any) => projectWorkspaceController.getAllProjects(req, res))
);

router.get(
  '/:id/external-contacts',
  requireAuth,
  validateRequest(projectIdSchema),
  asyncHandler((req: any, res: any) => projectWorkspaceController.getExternalContacts(req, res))
);

router.get(
  '/:id',
  requireAuth, // Any authenticated user can view a specific project, but the service will filter based on their role and assignments
  validateRequest(projectIdSchema),
  asyncHandler((req: any, res: any) => projectWorkspaceController.getProjectById(req, res))
);

router.put(
  '/:id',
  requireAuth, // Only allow updates if the user has access to the project. The service will enforce this.
  validateRequest(updateProjectSchema),
  asyncHandler((req: any, res: any) => projectWorkspaceController.updateProject(req, res))
);

router.patch(
  '/:id/status',
  requireAuth, // Estimators can update status of projects they are assigned to, Sales Managers and Admins can update status of any project. The service will enforce this.
  validateRequest(updateProjectStatusSchema),
  asyncHandler((req: any, res: any) => projectWorkspaceController.updateProjectStatus(req, res))
);

router.patch(
  '/:id/assign',
  requireElevated, // Only Sales Manager and Admins can assign estimators to projects. Estimators can be assigned to projects but don't have permissions to do so.
  validateRequest(assignEstimatorSchema),
  asyncHandler((req: any, res: any) => projectWorkspaceController.assignEstimator(req, res))
);

export const projectWorkspaceRouter = router;
