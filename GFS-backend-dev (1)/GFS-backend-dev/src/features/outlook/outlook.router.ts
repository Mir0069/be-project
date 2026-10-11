import { Router } from 'express';

import { env } from '@config/index';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { UserRole } from '@db/models/user.model';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import {
  outlookTokenRepository,
  outlookMonitoredMailboxRepository,
  outlookEmailRepository,
  projectRepository,
  cloudLinkAssetRepository,
} from '@repositories/index';

import {
  documentIngestionPipeline,
  blobStorage,
} from '@features/document-ingestion/document-ingestion.router';

import { OutlookTokenService } from './outlook-token.service';
import { OutlookGraphClient } from './outlook.graph-client';
import { OutlookAssociationService } from './outlook-association.service';
import { PipelineDocumentIngestionAdapter } from './pipeline-document-ingestion.adapter';
import { OutlookService } from './outlook.service';
import { CloudLinkService } from '@services/cloud-link.service';
import { OutlookController } from './outlook.controller';
import {
  listMailUsersSchema,
  listMailFoldersSchema,
  addMonitoredMailboxSchema,
  removeMonitoredMailboxSchema,
  syncSchema,
  listEmailsSchema,
  linkEmailSchema,
  moveEmailSchema,
} from './outlook.validation';

import { aiResultSchema } from './outlook.validation';
import { notificationService } from '@features/notifications/notification.router';
import { pendingApprovalService } from '@features/proposal/pending-approval.router';

const tokenService = new OutlookTokenService(outlookTokenRepository, {
  clientId: env.outlook.clientId,
  clientSecret: env.outlook.clientSecret,
  tenantId: env.outlook.tenantId,
  authority: env.outlook.authority,
  scope: env.outlook.scope,
  redirectUri: env.outlook.redirectUri,
});
const graphClient = new OutlookGraphClient(tokenService, env.outlook.graphBaseUrl);
const associationService = new OutlookAssociationService(projectRepository);

const documentIngestionPort = new PipelineDocumentIngestionAdapter(documentIngestionPipeline);
const cloudLinkService = new CloudLinkService(
  cloudLinkAssetRepository,
  blobStorage,
  documentIngestionPipeline
);

// Exported so the poller (started in server.ts) reuses the same instance.
export const outlookService = new OutlookService(
  graphClient,
  tokenService,
  outlookMonitoredMailboxRepository,
  outlookEmailRepository,
  associationService,
  projectRepository,
  documentIngestionPort,
  blobStorage,
  env.outlook.deleteAfterIngest,
  cloudLinkService,
  notificationService,
  pendingApprovalService
);

const outlookController = new OutlookController(outlookService);

const admin = authorize(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN);

const router = Router();

// OAuth2 Delegated flow routes (Personal accounts & user consent)
router.get('/auth/login', (req, res) => outlookController.getAuthUrl(req, res));
router.get('/auth/callback', asyncHandler((req, res) => outlookController.handleAuthCallback(req, res)));

router.get('/status', authenticate, asyncHandler((req, res) => outlookController.getStatus(req, res)));

router.get(
  '/users',
  authenticate,
  admin,
  validateRequest(listMailUsersSchema),
  asyncHandler((req, res) => outlookController.listMailUsers(req, res)),
);

router.get(
  '/users/:userId/folders',
  authenticate,
  admin,
  validateRequest(listMailFoldersSchema),
  asyncHandler((req, res) => outlookController.listMailFolders(req, res)),
);

router.get(
  '/monitored-mailboxes',
  authenticate,
  admin,
  asyncHandler((req, res) => outlookController.listMonitoredMailboxes(req, res)),
);

router.post(
  '/monitored-mailboxes',
  authenticate,
  admin,
  validateRequest(addMonitoredMailboxSchema),
  asyncHandler((req, res) => outlookController.addMonitoredMailbox(req, res)),
);

router.delete(
  '/monitored-mailboxes/:id',
  authenticate,
  admin,
  validateRequest(removeMonitoredMailboxSchema),
  asyncHandler((req, res) => outlookController.removeMonitoredMailbox(req, res)),
);

router.post(
  '/sync',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(syncSchema),
  asyncHandler((req, res) => outlookController.sync(req, res)),
);

router.get(
  '/emails',
  authenticate,
  validateRequest(listEmailsSchema),
  asyncHandler((req, res) => outlookController.listEmails(req, res)),
);

router.post(
  '/emails/:messageId/link',
  authenticate,
  admin,
  validateRequest(linkEmailSchema),
  asyncHandler((req, res) => outlookController.linkEmail(req, res)),
);

router.post(
  '/emails/:emailId/move',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(moveEmailSchema),
  asyncHandler((req, res) => outlookController.moveEmail(req, res)),
);

router.post(
  '/ai-result',
  validateRequest(aiResultSchema),
  asyncHandler((req, res) => outlookController.handleAiResult(req, res))
);

// Alias: some AI worker versions post to /ai-result/process-payload — keep both working.
router.post(
  '/ai-result/process-payload',
  validateRequest(aiResultSchema),
  asyncHandler((req, res) => outlookController.handleAiResult(req, res))
);

export default router;
