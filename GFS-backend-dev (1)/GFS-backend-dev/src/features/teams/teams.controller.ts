import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { env } from '@config/index';
import { safeJson } from '@shared/http/safe-json';

import type { TeamsService } from './teams.service';
import type { TeamsTranscriptsService } from './teams-transcripts.service';
import type { TeamsMeetingsService } from './teams-meetings.service';
import type { TeamsSubscriptionService } from './teams-subscription.service';
import type { TeamsAiService } from './teams-ai.service';
import type { TeamsProvisionDecisionService } from './teams-provision-decision.service';
import type { GraphChangeNotification } from './teams.types';
import { describeError } from './teams.errors';

export class TeamsController {
  private readonly teamsService: TeamsService;
  private readonly transcriptsService: TeamsTranscriptsService;
  private readonly meetingsService: TeamsMeetingsService;
  private readonly subscriptionService: TeamsSubscriptionService;
  private readonly aiService: TeamsAiService;
  private readonly provisionDecisionService: TeamsProvisionDecisionService;

  public constructor(
    teamsService: TeamsService,
    transcriptsService: TeamsTranscriptsService,
    meetingsService: TeamsMeetingsService,
    subscriptionService: TeamsSubscriptionService,
    aiService: TeamsAiService,
    provisionDecisionService: TeamsProvisionDecisionService,
  ) {
    this.teamsService = teamsService;
    this.transcriptsService = transcriptsService;
    this.meetingsService = meetingsService;
    this.subscriptionService = subscriptionService;
    this.aiService = aiService;
    this.provisionDecisionService = provisionDecisionService;
  }

  // AI → backend callback: apply chat/meeting summaries from the AI result.
  // Unauthenticated by design (the AI worker cannot present our JWT); secured by
  // the opaque correlationId that must match an existing TeamsAiJob.
  public async handleAiResult(req: Request, res: Response): Promise<void> {
    const outcome = await this.aiService.processAiResult(req.body);
    safeJson(res, StatusCodes.OK, { success: true, data: outcome });
  }

  // Aggregated AI summaries for a project (Chat Summary card + Meeting cards).
  public async getProjectAiSummary(req: Request, res: Response): Promise<void> {
    const projectId = req.params['projectId'] as string;
    const data = await this.meetingsService.getProjectAiSummary(projectId);
    safeJson(res, StatusCodes.OK, { success: true, data });
  }

  public async getStatus(_req: Request, res: Response): Promise<void> {
    const status = await this.teamsService.getStatus();
    safeJson(res, StatusCodes.OK, { success: true, data: status });
  }

  public async listTeams(_req: Request, res: Response): Promise<void> {
    const teams = await this.teamsService.listTeams();
    safeJson(res, StatusCodes.OK, { success: true, data: { teams } });
  }

  public async listChannels(req: Request, res: Response): Promise<void> {
    const teamId = req.params['teamId'] as string;
    const channels = await this.teamsService.listChannels(teamId);
    safeJson(res, StatusCodes.OK, { success: true, data: { channels } });
  }

  public async addMonitoredChannel(req: Request, res: Response): Promise<void> {
    const channel = await this.teamsService.addMonitoredChannel(req.body);
    safeJson(res, StatusCodes.CREATED, { success: true, data: { channel } });
  }

  public async listMonitoredChannels(_req: Request, res: Response): Promise<void> {
    const channels = await this.teamsService.listMonitoredChannels();
    safeJson(res, StatusCodes.OK, { success: true, data: { channels } });
  }

  public async removeMonitoredChannel(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    // Optional: unlink only this project from a shared channel; without it the
    // whole channel is removed once no projects remain.
    const projectId =
      typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
    await this.teamsService.removeMonitoredChannel(id, projectId);
    safeJson(res, StatusCodes.OK, { success: true, message: 'Channel monitoring stopped' });
  }

  // ----- Provisioning decision (discover -> connect / create) -----

  public async getProvisioningState(req: Request, res: Response): Promise<void> {
    const projectId = req.params['projectId'] as string;
    const data = await this.provisionDecisionService.getForProject(projectId);
    safeJson(res, StatusCodes.OK, { success: true, data });
  }

  public async connectProvisioningCandidate(req: Request, res: Response): Promise<void> {
    const projectId = req.params['projectId'] as string;
    const data = await this.provisionDecisionService.connectCandidate(projectId, req.body);
    safeJson(res, StatusCodes.OK, { success: true, data });
  }

  // 202: the team is created in the background, which can take ~90s.
  public async approveProvisioningCreate(req: Request, res: Response): Promise<void> {
    const projectId = req.params['projectId'] as string;
    const data = await this.provisionDecisionService.approveCreate(projectId);
    safeJson(res, StatusCodes.ACCEPTED, { success: true, data });
  }

  public async sync(req: Request, res: Response): Promise<void> {
    const channelDbId =
      req.body && typeof req.body.channelDbId === 'string' ? req.body.channelDbId : undefined;
    const result = await this.teamsService.sync(channelDbId);
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async listMessages(req: Request, res: Response): Promise<void> {
    const { projectId, channelId, page, limit } = req.query as Record<string, string | undefined>;
    const result = await this.teamsService.listMessages({
      projectId,
      channelId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async linkMessage(req: Request, res: Response): Promise<void> {
    const messageId = req.params['messageId'] as string;
    const message = await this.teamsService.linkMessage(messageId, req.body.projectId);
    safeJson(res, StatusCodes.OK, { success: true, data: { message } });
  }

  public async processFiles(req: Request, res: Response): Promise<void> {
    const messageId = req.params['messageId'] as string;
    const result = await this.teamsService.processFilesByMessageId(messageId);
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async fetchTranscripts(req: Request, res: Response): Promise<void> {
    const summary = await this.transcriptsService.fetchAndStore(req.body);
    safeJson(res, StatusCodes.OK, { success: true, data: summary });
  }

  public async listTranscripts(req: Request, res: Response): Promise<void> {
    const { projectId, meetingId, page, limit } = req.query as Record<string, string | undefined>;
    const result = await this.transcriptsService.listTranscripts({
      projectId,
      meetingId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async linkTranscript(req: Request, res: Response): Promise<void> {
    const transcriptId = req.params['transcriptId'] as string;
    const transcript = await this.transcriptsService.linkTranscript(transcriptId, req.body.projectId);
    safeJson(res, StatusCodes.OK, { success: true, data: { transcript } });
  }

  public async listMeetings(req: Request, res: Response): Promise<void> {
    const { projectId, channelId, page, limit } = req.query as Record<string, string | undefined>;
    const result = await this.meetingsService.listMeetings({
      projectId,
      channelId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    safeJson(res, StatusCodes.OK, { success: true, data: result });
  }

  public async getMeeting(req: Request, res: Response): Promise<void> {
    const id = req.params['id'] as string;
    const detail = await this.meetingsService.getMeeting(id);
    safeJson(res, StatusCodes.OK, { success: true, data: detail });
  }

 
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    // Graph validation handshake: echo the token as text/plain, 200, within 10s.
    // Runs first because this request carries no body and no clientState.
    const validationToken = req.query['validationToken'];
    if (typeof validationToken === 'string') {
      res.status(StatusCodes.OK).type('text/plain').send(validationToken);
      return;
    }

    const body = req.body as { value?: GraphChangeNotification[] } | undefined;
    const items = Array.isArray(body?.value) ? body.value : [];

    // ACK immediately (well under Graph's 3s window); process in the background.
    res.status(StatusCodes.ACCEPTED).json({ ok: true });

    void this.processWebhookNotifications(items);
  }

  private async processWebhookNotifications(items: GraphChangeNotification[]): Promise<void> {
    const channelDbIds = new Set<string>();

    for (const item of items) {
      if (item.clientState !== env.teams.webhookClientState) {
        console.warn('[TeamsWebhook] clientState mismatch — ignoring notification');
        continue;
      }
      if (item.lifecycleEvent) {
        void this.subscriptionService
          .handleLifecycleEvent(item.subscriptionId, item.lifecycleEvent)
          .catch((err) =>
            console.error(`[TeamsWebhook] lifecycle handling failed: ${describeError(err)}`),
          );
        continue;
      }
      const channelDbId = await this.subscriptionService.getChannelDbIdForSubscription(
        item.subscriptionId,
      );
      if (channelDbId) channelDbIds.add(channelDbId);
    }

    // Dedupe: many message notifications for one channel fire a single sync.
    for (const channelDbId of channelDbIds) {
      void this.teamsService.sync(channelDbId).catch((err) => {
        console.error(
          `[TeamsWebhook] sync failed for channel ${channelDbId}: ${describeError(err)}`,
        );
      });
    }
  }
}
