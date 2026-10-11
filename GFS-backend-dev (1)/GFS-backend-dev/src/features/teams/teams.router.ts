import { Router } from 'express';

import { env } from '@config/index';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { UserRole } from '@db/models/user.model';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { createQueueAdapter } from '@shared/queues/queue.factory';
import {
  teamsTokenRepository,
  teamsMonitoredChannelRepository,
  teamsMessageRepository,
  teamsTranscriptRepository,
  teamsMeetingRepository,
  teamsAiJobRepository,
  teamsSubscriptionRepository,
  teamsProvisionOutboxRepository,
  teamsProjectMemberRepository,
  documentRepository,
  projectRepository,
  userRepository,
  cloudLinkAssetRepository,
} from '@repositories/index';

import { documentIngestionPipeline, blobStorage } from '@features/document-ingestion/document-ingestion.router';
import { CloudLinkService } from '@services/cloud-link.service';

import { TeamsTokenService } from './teams-token.service';
import { TeamsGraphClient } from './teams.graph-client';
import { TeamsAssociationService } from './teams-association.service';
import { TeamsFilesService } from './teams-files.service';
import { TeamsTranscriptsService } from './teams-transcripts.service';
import { TeamsMeetingsService } from './teams-meetings.service';
import { TeamsSubscriptionService } from './teams-subscription.service';
import { TeamsAiDispatchService } from './teams-ai-dispatch.service';
import { TeamsAiService } from './teams-ai.service';
import { TeamsCloudLinkService } from './teams-cloud-link.service';
import { notificationService } from '@features/notifications/notification.router';
import type { TeamsAiPayload } from './teams-ai.types';
import { PipelineDocumentIngestionAdapter } from './pipeline-document-ingestion.adapter';
import { TeamsProvisioningService } from './teams-provisioning.service';
import { TeamsDiscoveryService } from './teams-discovery.service';
import { TeamsProvisionDecisionService } from './teams-provision-decision.service';
import { TeamsMembershipService } from './teams-membership.service';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { TEAMS_WEBHOOK_PATH } from './teams.constants';
import { pendingApprovalService } from '@features/proposal/pending-approval.router';
import {
  addMonitoredChannelSchema,
  listChannelsSchema,
  removeMonitoredChannelSchema,
  provisioningProjectSchema,
  connectProvisioningCandidateSchema,
  syncSchema,
  listMessagesSchema,
  linkMessageSchema,
  processFilesSchema,
  fetchTranscriptsSchema,
  listTranscriptsSchema,
  linkTranscriptSchema,
  listMeetingsSchema,
  getMeetingSchema,
  projectAiSummarySchema,
  teamsAiResultSchema,
} from './teams.validation';

const tokenService = new TeamsTokenService(teamsTokenRepository, {
  clientId: env.teams.clientId,
  clientSecret: env.teams.clientSecret,
  tenantId: env.teams.tenantId,
  authority: env.teams.authority,
  scope: env.teams.scope,
});
export const graphClient = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);
const associationService = new TeamsAssociationService(projectRepository);

const documentIngestionPort = new PipelineDocumentIngestionAdapter(documentIngestionPipeline);
const filesService = new TeamsFilesService(
  graphClient,
  documentIngestionPort,
  env.teams.fileIngestEnabled,
);

// Meetings service is constructed before the transcript service, which records
// a meeting on every discovered channel-meeting event.
const meetingsService = new TeamsMeetingsService(
  teamsMeetingRepository,
  teamsTranscriptRepository,
  teamsMessageRepository,
  documentRepository,
  teamsMonitoredChannelRepository,
);

// Transcript service must be constructed before TeamsService so it can be
// injected — syncChannel hands meeting-event messages to it.
const transcriptsService = new TeamsTranscriptsService(
  graphClient,
  teamsTranscriptRepository,
  projectRepository,
  associationService,
  documentIngestionPort,
  meetingsService,
  env.teams.transcriptIngestEnabled,
);

// Exported so the subscription-renewal cron (started in server.ts) reuses the
// same instance as the request path.
export const teamsSubscriptionService = new TeamsSubscriptionService(
  graphClient,
  teamsSubscriptionRepository,
  teamsMonitoredChannelRepository,
  {
    webhookBaseUrl: env.teams.webhookBaseUrl,
    webhookPath: TEAMS_WEBHOOK_PATH,
    clientState: env.teams.webhookClientState,
    ttlMs: env.teams.subscriptionTtlMs,
    renewBeforeMs: env.teams.subscriptionRenewBeforeMs,
    enabled: env.teams.webhookEnabled,
  },
);

// Teams → AI hand-off: a dedicated Service Bus queue (separate from the OCR
// queue) carries the unified chat+meetings payload; the dispatcher emits after
// each channel sync, the result service applies the AI's summaries back.
const teamsAiQueue = createQueueAdapter<TeamsAiPayload>(env.azure.teamsQueueName);
// Exported so the dev scripts (payload preview, VTT-driven summary test) drive
// the same instance the sync loop uses.
export const aiDispatchService = new TeamsAiDispatchService(
  teamsAiQueue,
  blobStorage,
  documentRepository,
  teamsMessageRepository,
  teamsMeetingRepository,
  teamsAiJobRepository,
  env.teams.aiDispatchEnabled,
);
export const teamsAiService = new TeamsAiService(
  teamsAiJobRepository,
  teamsMeetingRepository,
  teamsMonitoredChannelRepository,
  // A new AI summary is what the estimator reviews, so it parks a pending
  // approval. Approving it re-runs extraction. Individual chat messages raise
  // nothing, which is what keeps the panel readable.
  pendingApprovalService,
);

// Fetches documents from Dropbox links in message bodies, reusing the shared
// cloud-link detection/dedup + Dropbox/zip utilities; streams straight to blob.
const teamsCloudLinkService = new TeamsCloudLinkService(
  new CloudLinkService(cloudLinkAssetRepository),
  cloudLinkAssetRepository,
  blobStorage,
  documentIngestionPipeline,
  notificationService,
  teamsMonitoredChannelRepository,
);

// Adds estimators, assigning sales managers and Heads of Division to project teams. Exported
// so the project routers trigger it and server.ts hands it to the poller (sweep + retries).
export const teamsMembershipService = new TeamsMembershipService(
  graphClient,
  teamsProjectMemberRepository,
  teamsMonitoredChannelRepository,
  projectRepository,
  userRepository,
  {
    enabled: env.teams.autoAddMembersEnabled,
    graphBaseUrl: env.teams.graphBaseUrl,
  },
  notificationService,
);

// Exported so the poller (started in server.ts) reuses the same instance.
export const teamsService = new TeamsService(
  graphClient,
  tokenService,
  teamsMonitoredChannelRepository,
  teamsMessageRepository,
  associationService,
  projectRepository,
  filesService,
  transcriptsService,
  teamsSubscriptionService,
  aiDispatchService,
  teamsCloudLinkService,
  pendingApprovalService,
  teamsMembershipService,
);

// Matches a project's address against existing teams/channels. TeamsService
// satisfies ITeamsDirectory structurally (listTeams + listChannels).
const teamsDiscoveryService = new TeamsDiscoveryService(teamsService);

// Provisions a project's Teams workspace (Zoho/mail-first). Exported so
// zoho.router injects it into ZohoSyncService (the enqueue hook) and server.ts
// hands it to the Teams poller (the retry drain).
export const teamsProvisioningService = new TeamsProvisioningService(
  graphClient,
  teamsMonitoredChannelRepository,
  teamsProvisionOutboxRepository,
  projectRepository,
  {
    autoProvisionEnabled: env.teams.autoProvisionEnabled,
    ownerGuid: env.teams.ownerGuid,
    ownerUpn: env.teams.ownerUpn,
    graphBaseUrl: env.teams.graphBaseUrl,
  },
  notificationService,
  teamsDiscoveryService,
  teamsMembershipService,
);

export const teamsProvisionDecisionService = new TeamsProvisionDecisionService(
  teamsProvisionOutboxRepository,
  teamsService,
  teamsProvisioningService,
  projectRepository,
  teamsMonitoredChannelRepository,
  {
    autoProvisionEnabled: env.teams.autoProvisionEnabled,
    hasOwner: Boolean(env.teams.ownerGuid || env.teams.ownerUpn),
  },
);

const teamsController = new TeamsController(
  teamsService,
  transcriptsService,
  meetingsService,
  teamsSubscriptionService,
  teamsAiService,
  teamsProvisionDecisionService,
);


const teamsAccess = authorize(
  UserRole.SUPER_ADMIN,
  UserRole.SALES_MANAGER,
  UserRole.ESTIMATOR,
);

const router = Router();

// NOTE: the Graph change-notification webhook (POST /webhook) has been removed —
// Teams now syncs purely on the poll cadence (TEAMS_POLL_INTERVAL_MS). The
// controller/subscription code is kept dormant so push can be re-enabled later.

router.get('/status', authenticate, asyncHandler((req, res) => teamsController.getStatus(req, res)));

router.get(
  '/teams',
  authenticate,
  teamsAccess,
  asyncHandler((req, res) => teamsController.listTeams(req, res)),
);

router.get(
  '/teams/:teamId/channels',
  authenticate,
  teamsAccess,
  validateRequest(listChannelsSchema),
  asyncHandler((req, res) => teamsController.listChannels(req, res)),
);

router.get(
  '/monitored-channels',
  authenticate,
  teamsAccess,
  asyncHandler((req, res) => teamsController.listMonitoredChannels(req, res)),
);

router.post(
  '/monitored-channels',
  authenticate,
  teamsAccess,
  validateRequest(addMonitoredChannelSchema),
  asyncHandler((req, res) => teamsController.addMonitoredChannel(req, res)),
);

router.delete(
  '/monitored-channels/:id',
  authenticate,
  teamsAccess,
  validateRequest(removeMonitoredChannelSchema),
  asyncHandler((req, res) => teamsController.removeMonitoredChannel(req, res)),
);

// Provisioning decision. Same guard as POST /monitored-channels: connecting a
// discovered candidate is exactly that operation, and creating a workspace is
// the alternative to it, so one role set keeps the UI honest.
router.get(
  '/provisioning/projects/:projectId',
  authenticate,
  teamsAccess,
  validateRequest(provisioningProjectSchema),
  asyncHandler((req, res) => teamsController.getProvisioningState(req, res)),
);

router.post(
  '/provisioning/projects/:projectId/connect',
  authenticate,
  teamsAccess,
  validateRequest(connectProvisioningCandidateSchema),
  asyncHandler((req, res) => teamsController.connectProvisioningCandidate(req, res)),
);

router.post(
  '/provisioning/projects/:projectId/create',
  authenticate,
  teamsAccess,
  validateRequest(provisioningProjectSchema),
  asyncHandler((req, res) => teamsController.approveProvisioningCreate(req, res)),
);

router.post(
  '/sync',
  authenticate,
  teamsAccess,
  validateRequest(syncSchema),
  asyncHandler((req, res) => teamsController.sync(req, res)),
);

router.get(
  '/messages',
  authenticate,
  validateRequest(listMessagesSchema),
  asyncHandler((req, res) => teamsController.listMessages(req, res)),
);

router.post(
  '/messages/:messageId/link',
  authenticate,
  teamsAccess,
  validateRequest(linkMessageSchema),
  asyncHandler((req, res) => teamsController.linkMessage(req, res)),
);

router.post(
  '/messages/:messageId/process-files',
  authenticate,
  teamsAccess,
  validateRequest(processFilesSchema),
  asyncHandler((req, res) => teamsController.processFiles(req, res)),
);

router.post(
  '/transcripts/fetch',
  authenticate,
  teamsAccess,
  validateRequest(fetchTranscriptsSchema),
  asyncHandler((req, res) => teamsController.fetchTranscripts(req, res)),
);

router.get(
  '/transcripts',
  authenticate,
  validateRequest(listTranscriptsSchema),
  asyncHandler((req, res) => teamsController.listTranscripts(req, res)),
);

router.post(
  '/transcripts/:transcriptId/link',
  authenticate,
  teamsAccess,
  validateRequest(linkTranscriptSchema),
  asyncHandler((req, res) => teamsController.linkTranscript(req, res)),
);

router.get(
  '/meetings',
  authenticate,
  validateRequest(listMeetingsSchema),
  asyncHandler((req, res) => teamsController.listMeetings(req, res)),
);

router.get(
  '/meetings/:id',
  authenticate,
  validateRequest(getMeetingSchema),
  asyncHandler((req, res) => teamsController.getMeeting(req, res)),
);

// Aggregated AI summaries for a project (Chat Summary + Meeting Summaries).
router.get(
  '/projects/:projectId/ai-summary',
  authenticate,
  validateRequest(projectAiSummarySchema),
  asyncHandler((req, res) => teamsController.getProjectAiSummary(req, res)),
);

// UNAUTHENTICATED by design: the AI worker cannot present our JWT. Secured by the
// opaque correlationId, which must resolve to an existing TeamsAiJob.
router.post(
  '/ai-result',
  validateRequest(teamsAiResultSchema),
  asyncHandler((req, res) => teamsController.handleAiResult(req, res)),
);

export default router;
