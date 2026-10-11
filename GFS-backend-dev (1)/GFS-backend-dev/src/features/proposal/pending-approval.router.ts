import { Router } from 'express';
import { PendingApprovalController } from './pending-approval.controller';
import { PendingApprovalService } from './pending-approval.service';
import { MongoosePendingChangeApprovalRepository } from '@repositories/mongoose/pending-change-approval.repository';
import { MongooseProposalRepository } from '@repositories/mongoose/proposal.repository';
import { proposalService } from './proposal.router';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { UserRole } from '@db/models/user.model';

import { dropboxSyncService } from '@features/projects/dropbox-sync.service';

const pendingApprovalRepo = new MongoosePendingChangeApprovalRepository();
const proposalRepo = new MongooseProposalRepository();

export const pendingApprovalService = new PendingApprovalService(
  pendingApprovalRepo,
  proposalRepo,
  proposalService,
);

// Inject into Dropbox sync service
dropboxSyncService.setPendingApprovalService(pendingApprovalService);

export const pendingApprovalController = new PendingApprovalController(
  pendingApprovalService,
  proposalService,
);

export function createPendingApprovalRouter(controller: PendingApprovalController): Router {
  const router = Router();

  // Every route here requires authentication, but the middleware is attached per
  // route rather than with a pathless router.use(). This router is mounted at the
  // bare `/api/v1` root, so a pathless use() runs for EVERY request that reaches
  // it, including ones meant for routers mounted after it (project-workspace,
  // notifications, mail-first) and the unauthenticated AI webhooks. That turned
  // even a nonexistent URL into 401 instead of 404.
  router.get('/projects/:projectId/pending-approvals', authenticate, controller.getPendingApprovals);

  // Get count of pending approvals for a project
  router.get('/projects/:projectId/pending-approvals/count', authenticate, controller.getPendingCount);

  // Get a specific pending approval
  router.get('/pending-approvals/:id', authenticate, controller.getPendingApproval);

  // Approve a pending change (requires estimator, sales manager, or admin role)
  router.post(
    '/pending-approvals/:id/approve',
    authenticate,
    authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
    controller.approveChange
  );

  // Reject a pending change (requires estimator, sales manager, or admin role)
  router.post(
    '/pending-approvals/:id/reject',
    authenticate,
    authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
    controller.rejectChange
  );

  // Manual re-trigger (requires estimator, sales manager, or admin role) - bypasses approval system
  router.post(
    '/projects/:projectId/manual-retrigger',
    authenticate,
    authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
    controller.manualRetrigger
  );

  return router;
}

export const pendingApprovalRouter = createPendingApprovalRouter(pendingApprovalController);
export default pendingApprovalRouter;


