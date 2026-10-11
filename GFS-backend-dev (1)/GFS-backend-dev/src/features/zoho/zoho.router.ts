import { Router } from 'express';

import { validateRequest } from '@shared/middleware/validate.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { authenticate } from '@features/auth/auth.middleware';
import { zohoTokenRepository, projectRepository, notificationRepository } from '@repositories/index';
import { NotificationService } from '@features/notifications/notification.service';
import { projectCreationService } from '@features/project-creation/project-creation.router';
import { teamsProvisioningService } from '@features/teams/teams.router';


import { ZohoController } from './zoho.controller';
import { ZohoService } from './zoho.service';
import { ZohoSyncService } from './zoho-sync.service';
import { ZohoProjectService } from './zoho-project.service';
import { ZohoLeadStatusService } from './zoho-lead-status.service';
import { ZohoCrmContextService } from './zoho-crm-context.service';
import { ZohoNoteStore } from './zoho-note-store';
import { CrmContextPublisher } from './queues/crm-context.publisher';
import { pendingApprovalService } from '@features/proposal/pending-approval.router';
import { zohoCallbackSchema, zohoFetchSchema, zohoInsertSchema } from './zoho.validation';

export const zohoService = new ZohoService(zohoTokenRepository);
const zohoProjectService = new ZohoProjectService(projectCreationService, projectRepository);
const notificationService = new NotificationService(notificationRepository);
export const zohoCrmContextService = new ZohoCrmContextService(
  zohoService,
  projectRepository,
  new CrmContextPublisher(),
  () => new Date(),
  // Persists the notes the AI reads on re-extraction, and keeps every version.
  new ZohoNoteStore(),
  // Changed Zoho text parks a human approval instead of re-running the pipeline
  // on its own, matching mail and Teams.
  pendingApprovalService,
);
export const zohoSyncService = new ZohoSyncService(
  zohoService,
  zohoProjectService,
  notificationService,
  teamsProvisioningService,
  zohoCrmContextService,
);
export const zohoLeadStatusService = new ZohoLeadStatusService(zohoService, projectRepository);
const zohoController = new ZohoController(zohoService, zohoSyncService, zohoCrmContextService);

const router = Router();

router.get('/auth', (req, res) => zohoController.initiateAuth(req, res));
router.get('/auth/callback', asyncHandler((req, res) => zohoController.handleCallback(req, res)));
router.get('/callback', asyncHandler((req, res) => zohoController.handleCallback(req, res)));

router.get('/dev-connect', asyncHandler((req, res) => zohoController.devConnect(req, res)));
router.post('/dev-connect', asyncHandler((req, res) => zohoController.devConnect(req, res)));
router.get('/mock-connect', asyncHandler((req, res) => zohoController.devConnect(req, res)));
router.post('/mock-connect', asyncHandler((req, res) => zohoController.devConnect(req, res)));

router.get('/status', asyncHandler((req, res) => zohoController.getStatus(req, res)));

// Diagnostic webhook receiver — Zoho POSTs lead change notifications here.
// GET is accepted too, in case Zoho probes the URL for verification.
// No auth / no validation: the payload shape is unknown until we observe it,
// and Zoho cannot send our auth cookie. Pure receive — never calls Zoho back.
router.post('/webhook', asyncHandler((req, res) => zohoController.handleWebhook(req, res)));
router.get('/webhook', asyncHandler((req, res) => zohoController.handleWebhook(req, res)));

// Notes for a lead, shown in the project workspace's Zoho Notes tab.
router.get('/leads/:zohoLeadId/notes', authenticate, asyncHandler((req, res) => zohoController.getLeadNotes(req, res)));

router.get(
  '/data/:module',
  validateRequest(zohoFetchSchema),
  asyncHandler((req, res) => zohoController.fetchModule(req, res)),
);

router.post(
  '/data/:module',
  validateRequest(zohoInsertSchema),
  asyncHandler((req, res) => zohoController.insertModule(req, res)),
);

export default router;
