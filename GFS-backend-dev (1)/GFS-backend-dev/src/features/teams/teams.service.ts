import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type {
  ITeamsMonitoredChannelRepository,
  IDomainMonitoredChannel,
} from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  ITeamsMessageRepository,
  IDomainTeamsMessage,
  ITeamsMessagePage,
  IListTeamsMessagesFilter,
} from '@repositories/interfaces/i-teams-message.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

import type { ITeamsGraphClient } from './teams.graph-client';
import type { TeamsTokenService } from './teams-token.service';
import type { TeamsAssociationService } from './teams-association.service';
import type { TeamsFilesService } from './teams-files.service';
import type { TeamsTranscriptsService } from './teams-transcripts.service';
import type { TeamsSubscriptionService } from './teams-subscription.service';
import type { ITeamsAiDispatch } from './teams-ai-dispatch.service';
import type { TeamsCloudLinkService } from './teams-cloud-link.service';
import type { IProjectTeamsMembership } from './teams-membership.port';
import { describeError } from './teams.errors';
import {
  CALL_STARTED_EVENT_ODATA_TYPE,
  type GraphChannel,
  type GraphChannelMessage,
  type GraphList,
  type GraphTeam,
  type SyncChannelResult,
  type SyncSummary,
  type TeamsStatus,
} from './teams.types';
import type { PendingApprovalService } from '@features/proposal/pending-approval.service';
import { ChangeSource } from '@db/models/pending-change-approval.model';

const BACKFILL_WINDOW_MS = 6 * 60 * 60 * 1000;


const isMeetingEvent = (message: GraphChannelMessage): boolean =>
  message.eventDetail?.['@odata.type'] === CALL_STARTED_EVENT_ODATA_TYPE;


/**
 * Graph rejects the FIRST /messages/delta call on a channel nobody has posted in
 * yet, with 400 "Parameter 'DeltaToken' not supported for this request". It is
 * not a failure, there is simply nothing to read, and every freshly provisioned
 * channel hits it on every poll until someone writes the first message. Treated
 * as an empty result so real sync failures stay visible in the logs.
 */
const isEmptyChannelDelta = (err: unknown): boolean => {
  if (!(err instanceof AppError) || err.statusCode !== StatusCodes.BAD_REQUEST) return false;
  const body = typeof err.details === 'string' ? err.details : JSON.stringify(err.details ?? '');
  return /DeltaToken'? not supported/i.test(body);
};

const hasMeetingReference = (message: GraphChannelMessage): boolean =>
  (message.attachments ?? []).some((a) => a.contentType === 'meetingReference');

export interface AddMonitoredChannelInput {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  projectId?: string;

  force?: boolean;
}

export interface SyncOptions {

  backfillWindowMs?: number;
}

const htmlToText = (html: string): string =>
  html
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

export class TeamsService {
  private readonly graphClient: ITeamsGraphClient;
  private readonly tokenService: TeamsTokenService;
  private readonly monitoredChannelRepository: ITeamsMonitoredChannelRepository;
  private readonly messageRepository: ITeamsMessageRepository;
  private readonly associationService: TeamsAssociationService;
  private readonly projectRepository: IProjectRepository;
  private readonly filesService: TeamsFilesService;
  private readonly transcriptsService: TeamsTranscriptsService;
  private readonly subscriptionService?: TeamsSubscriptionService;
  private readonly aiDispatch?: ITeamsAiDispatch;
  private readonly cloudLinkService?: TeamsCloudLinkService;
  private readonly pendingApprovalService?: PendingApprovalService;
  private readonly teamsMembership?: IProjectTeamsMembership;

  public constructor(
    graphClient: ITeamsGraphClient,
    tokenService: TeamsTokenService,
    monitoredChannelRepository: ITeamsMonitoredChannelRepository,
    messageRepository: ITeamsMessageRepository,
    associationService: TeamsAssociationService,
    projectRepository: IProjectRepository,
    filesService: TeamsFilesService,
    transcriptsService: TeamsTranscriptsService,
    subscriptionService?: TeamsSubscriptionService,
    aiDispatch?: ITeamsAiDispatch,
    cloudLinkService?: TeamsCloudLinkService,
    pendingApprovalService?: PendingApprovalService,
    teamsMembership?: IProjectTeamsMembership,
  ) {
    this.graphClient = graphClient;
    this.tokenService = tokenService;
    this.monitoredChannelRepository = monitoredChannelRepository;
    this.messageRepository = messageRepository;
    this.associationService = associationService;
    this.projectRepository = projectRepository;
    this.filesService = filesService;
    this.transcriptsService = transcriptsService;
    this.subscriptionService = subscriptionService;
    this.aiDispatch = aiDispatch;
    this.cloudLinkService = cloudLinkService;
    this.pendingApprovalService = pendingApprovalService;
    this.teamsMembership = teamsMembership;
  }

  // ----- Discovery (feature #5 setup) -----

  public async listTeams(): Promise<GraphTeam[]> {
    return this.graphClient.getAllPages<GraphTeam>('/teams');
  }

  public async listChannels(teamId: string): Promise<GraphChannel[]> {
    return this.graphClient.getAllPages<GraphChannel>(`/teams/${teamId}/channels`);
  }

  // ----- Monitored channels -----

  public async addMonitoredChannel(
    input: AddMonitoredChannelInput,
  ): Promise<IDomainMonitoredChannel> {
    if (input.projectId) {
      const project = await this.projectRepository.findById(input.projectId);
      if (!project) {
        throw new AppError('Project not found', StatusCodes.NOT_FOUND, true, {
          code: ErrorCode.NOT_FOUND,
        });
      }
    }

    const existing = await this.monitoredChannelRepository.findByChannel(
      input.teamId,
      input.channelId,
    );

    let channel: IDomainMonitoredChannel;
    if (existing?.isActive) {
      const alreadyHere = input.projectId
        ? existing.projectIds.includes(input.projectId)
        : existing.projectIds.length > 0;
      if (alreadyHere) {
        throw new AppError(
          'This channel is already connected to this project.',
          StatusCodes.CONFLICT,
          true,
          { code: ErrorCode.CONFLICT },
        );
      }

      // Linked elsewhere: require explicit opt-in (the UI confirms "connect
      // anyway?"). Surface the other projects so the prompt can name them.
      if (!input.force) {
        const linkedProjects = await this.describeProjects(existing.projectIds);
        const names = linkedProjects
          .map((p) => `${p.referenceNumber ?? ''} ${p.projectName ?? ''}`.trim())
          .filter(Boolean)
          .join(', ');
        throw new AppError(
          `This channel is already connected to ${names || 'another project'}. Connect it to this project as well?`,
          StatusCodes.CONFLICT,
          true,
          { code: ErrorCode.CONFLICT, details: { linkedProjects, alreadyLinked: true } },
        );
      }



      const mergedProjectIds = [
        ...new Set([...existing.projectIds, ...(input.projectId ? [input.projectId] : [])]),
      ];
      channel = await this.monitoredChannelRepository.upsert({
        teamId: input.teamId,
        teamName: input.teamName,
        channelId: input.channelId,
        channelName: input.channelName,
        projectIds: mergedProjectIds,
      });
    } else {
      channel = await this.monitoredChannelRepository.upsert({
        teamId: input.teamId,
        teamName: input.teamName,
        channelId: input.channelId,
        channelName: input.channelName,
        projectIds: input.projectId ? [input.projectId] : [],
      });
    }

    // A project that has just been linked has never seen this channel's history,
    // whether it is a reconnect after a disconnect or a share onto a live
    // channel. Resuming from the stored cursor would hand it only messages
    // posted from this moment on, so the conversation, meetings and files it is
    // being connected for would never appear. Drop the cursor so the initial
    // backfill re-walks the channel; re-ingestion is idempotent (upsert by
    // message id, approvals guarded by isSourceProcessed, and files already
    // marked downloaded are not fetched again).
    const isNewLink = Boolean(input.projectId) && !existing?.projectIds.includes(input.projectId!);
    if (isNewLink && (existing?.deltaLink || channel.deltaLink)) {
      await this.monitoredChannelRepository.updateDeltaLink(channel.id, null);
      // syncChannel reads the object we pass, not the row, so clear it here too.
      channel = { ...channel, deltaLink: null };
    }

    // Documents follow the channel only on a RECONNECT, where the channel stops
    // serving its old project entirely. Sharing must never take files away from
    // the project the channel is already connected to.
    if (existing && !existing.isActive) {
      await this.relocateChannelDocuments(channel, input.projectId);
    }

    try {
      await this.subscriptionService?.ensureSubscription(channel);
    } catch (err) {
      console.error(
        `[TeamsService] subscription ensure failed for ${channel.channelId}: ${describeError(err)}`,
      );
    }

    // The project's people join the team it was just connected to (manual or decision connect).
    if (input.projectId) await this.teamsMembership?.syncProject({ projectId: input.projectId });

    // Best-effort initial backfill so the conversation/meetings appear shortly
    // after connecting. Fire-and-forget: the import (messages, meetings,
    // transcripts, AI dispatch) can take up to a minute, so we DON'T await it —
    // connect returns immediately and the content lands a few seconds later (the
    // UI refetches on a short delay). A sync failure must never fail the connect;
    // the poller retries on its cadence anyway.
    void this.syncChannel(channel).catch((err) => {
      console.error(
        `[TeamsService] initial sync failed for ${channel.channelId}: ${describeError(err)}`,
      );
    });

    return channel;
  }

  /**
   * Moves every document this channel produced into the project it has just been
   * reconnected to, mirroring move-to-project: one physical copy, relocated in
   * Dropbox, rather than a second copy left behind. Reconnecting to the SAME
   * project matches nothing and is a no-op, so no duplicates are created.
   */
  private async relocateChannelDocuments(
    channel: IDomainMonitoredChannel,
    targetProjectId?: string,
  ): Promise<void> {
    if (!targetProjectId) return;
    try {
      const moved = await this.filesService.moveChannelDocuments(
        channel.channelId,
        targetProjectId,
      );
      if (moved > 0) {
        console.log(
          `[TeamsService] relocated ${moved} document(s) from channel ${channel.channelId} ` +
            `to project ${targetProjectId}`,
        );
      }
    } catch (err) {
      console.error(
        `[TeamsService] document relocation failed for channel ${channel.channelId}: ${describeError(err)}`,
      );
    }
  }

  private async describeProjects(
    projectIds: string[],
  ): Promise<Array<{ id: string; referenceNumber?: string; projectName?: string }>> {
    const projects = await Promise.all(
      projectIds.map((id) => this.projectRepository.findById(id).catch(() => null)),
    );
    return projects
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, referenceNumber: p.referenceNumber, projectName: p.projectName }));
  }

  public async listMonitoredChannels(): Promise<IDomainMonitoredChannel[]> {
    return this.monitoredChannelRepository.listActive();
  }

  public async removeMonitoredChannel(id: string, projectId?: string): Promise<void> {
    const channel = await this.monitoredChannelRepository.findById(id);
    if (!channel) {
      throw new AppError('Monitored channel not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    // Shared channel: if a specific project is disconnecting and others remain
    // linked, just drop that one link and keep the channel (and its Graph
    // subscription) alive for the rest.
    if (projectId && channel.projectIds.length > 1 && channel.projectIds.includes(projectId)) {
      await this.monitoredChannelRepository.removeProjectLink(id, projectId);
      return;
    }

    // Otherwise this is the last (or only) link — soft-disconnect (clear links +
    // isActive=false) instead of hard-deleting, so the accumulated aiChatSummary
    // survives and a later reconnect reuses this same row (upsert by
    // teamId+channelId). isActive=false still avoids a 409 on reconnect.
    await this.monitoredChannelRepository.deactivate(id);

    // Best-effort: tell Microsoft Graph to stop pushing notifications for this
    // channel. The subscription row is keyed by channel id, so this still
    // resolves after the channel row is gone.
    try {
      await this.subscriptionService?.removeForChannel(id);
    } catch (err) {
      console.error(
        `[TeamsService] subscription removal failed for channel ${id}: ${describeError(err)}`,
      );
    }
  }

  // ----- Ingestion -----

  public async syncChannel(
    channel: IDomainMonitoredChannel,
    options?: SyncOptions,
  ): Promise<SyncChannelResult> {
    const startUrl =
      channel.deltaLink ??
      `/teams/${channel.teamId}/channels/${channel.channelId}/messages/delta`;

    let items: GraphChannelMessage[] = [];
    let deltaLink: string | null = null;
    try {
      ({ items, deltaLink } = await this.graphClient.getDelta<GraphChannelMessage>(startUrl));
    } catch (err) {
      // Only swallow this on the initial call. The same error against a STORED
      // cursor would mean something is genuinely wrong, so let it surface.
      if (channel.deltaLink || !isEmptyChannelDelta(err)) throw err;
    }

    let ingested = 0;
    for (const message of items) {
      if (message.deletedDateTime) continue;

      if (isMeetingEvent(message)) {
        // Channel meeting started — discover and fetch the transcript.
        // Best-effort; the discovery method swallows its own errors so one
        // bad meeting can't abort delta processing.
        await this.transcriptsService.discoverFromChannelEvent(channel, message);
        continue;
      }

      if (hasMeetingReference(message)) {
        // A scheduled channel meeting: pull its in-chat thread (delta omits
        // replies) so the meeting shows its conversation + shared docs, then
        // record it in the Meetings section instead of as a bare chat bubble.
        await this.ingestReplies(channel, message.id);
        await this.transcriptsService.discoverFromMeetingReference(channel, message);
        continue;
      }

      // Skip every other non-content system message type.
      if (message.messageType && message.messageType !== 'message') continue;

      await this.ingestMessage(channel, message);
      ingested += 1;
    }

    if (deltaLink) {
      await this.monitoredChannelRepository.updateDeltaLink(channel.id, deltaLink);
    }

    // 6h backfill scan: catches late-generated transcripts whose event message
    // we already passed in delta (delta only returns each event once).
    // Idempotent: discoverFromChannelEvent → fetchAndStore upsert by transcriptId.
    await this.runTranscriptBackfill(channel, options?.backfillWindowMs);

    // Hand the newly-synced content (chat batch + meetings) to the AI queue.
    // Best-effort: the dispatcher swallows its own errors so a failed hand-off
    // never aborts a sync.
    if (this.aiDispatch) {
      try {
        await this.aiDispatch.dispatchProjectSync(channel);
      } catch (err) {
        console.error(
          `[TeamsService] AI dispatch failed for channel ${channel.channelId}: ${describeError(err)}`,
        );
      }
    }

    return { channelId: channel.channelId, channelName: channel.channelName, ingested };
  }

  private async runTranscriptBackfill(
    channel: IDomainMonitoredChannel,
    backfillWindowMs: number = BACKFILL_WINDOW_MS,
  ): Promise<void> {
    // Graph's channel /messages endpoint does NOT support $filter, so we
    // fetch the top page and filter client-side. $top sorted by lastModified
    // descending gives us the most recent items.
    const since = Date.now() - backfillWindowMs;
    try {
      const response = await this.graphClient.get<GraphList<GraphChannelMessage>>(
        `/teams/${channel.teamId}/channels/${channel.channelId}/messages`,
        { $top: '50' },
      );
      for (const message of response.value ?? []) {
        if (message.deletedDateTime) continue;
        const isEvent = isMeetingEvent(message);
        const isScheduled = hasMeetingReference(message);
        if (!isEvent && !isScheduled) continue;
        const created = message.createdDateTime
          ? new Date(message.createdDateTime).getTime()
          : 0;
        if (created < since) continue;
        if (isEvent) {
          await this.transcriptsService.discoverFromChannelEvent(channel, message);
        } else {
          await this.ingestReplies(channel, message.id);
          await this.transcriptsService.discoverFromMeetingReference(channel, message);
        }
      }
    } catch (err) {
      // Backfill failures must never abort channel sync.
      console.error(
        `[TeamsService] transcript backfill failed for channel ${channel.channelId}: ${describeError(err)}`,
      );
    }
  }

  private async ingestMessage(
    channel: IDomainMonitoredChannel,
    message: GraphChannelMessage,
  ): Promise<void> {
    const isHtml = message.body?.contentType === 'html';
    const rawContent = message.body?.content ?? '';
    const contentHtml = isHtml ? rawContent : null;
    const contentText = isHtml ? htmlToText(rawContent) : rawContent;

    // Preserve a manual project link across re-ingestion of the same message.
    const existing = await this.messageRepository.findByMessageId(message.id);
    let projectId: string | null;
    let linkMethod: IDomainTeamsMessage['linkMethod'];

    if (existing && existing.linkMethod === 'MANUAL') {
      projectId = existing.projectId ?? null;
      linkMethod = 'MANUAL';
    } else {
      const resolved = await this.associationService.resolveProject({
        contentText,
        channelName: channel.channelName,
        // A shared channel attributes files/records to its primary (first)
        // linked project; the conversation itself is shown to every linked
        // project via channel lookup, independent of this stored projectId.
        channelProjectId: channel.projectIds[0] ?? null,
      });
      projectId = resolved.projectId;
      linkMethod = resolved.linkMethod;
    }

    // Preserve which attachments were already downloaded so re-sync never
    // re-downloads the same file.
    const alreadyDownloaded = new Set(
      (existing?.attachments ?? []).filter((a) => a.downloaded).map((a) => a.id),
    );

    const stored = await this.messageRepository.upsertByMessageId({
      messageId: message.id,
      teamId: channel.teamId,
      channelId: channel.channelId,
      parentMessageId: message.replyToId ?? null,
      fromName: message.from?.user?.displayName ?? null,
      fromId: message.from?.user?.id ?? null,
      contentText,
      contentHtml,
      webUrl: message.webUrl ?? null,
      createdDateTime: message.createdDateTime ? new Date(message.createdDateTime) : new Date(),
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        name: attachment.name ?? null,
        contentType: attachment.contentType ?? null,
        contentUrl: attachment.contentUrl ?? null,
        downloaded: alreadyDownloaded.has(attachment.id),
      })),
      projectId,
      linkMethod,
    });

    // The chat TEXT is not ingested (it lives in the Conversation view); only
    // channel files, transcripts, meeting-shared docs, and cloud links are.
    let newlyDownloadedDocumentIds: string[] = [];
    try {
      newlyDownloadedDocumentIds = await this.processMessageFiles(stored);
    } catch (err) {
      console.error(
        `[TeamsService] file processing failed for message ${message.id}: ${describeError(err)}`,
      );
    }
    
    // Create pending approval if new documents were downloaded and linked to a project
    if (newlyDownloadedDocumentIds.length > 0 && projectId && this.pendingApprovalService) {
      try {
        const correlationId = `teamsMessage:${message.id}`;
        const alreadyProcessed = await this.pendingApprovalService.isSourceProcessed(
          message.id,
          ChangeSource.TEAMS
        );
        
        if (!alreadyProcessed) {
          await this.pendingApprovalService.createPendingApproval({
            projectId,
            source: ChangeSource.TEAMS,
            sourceId: message.id,
            correlationId,
            documentIds: newlyDownloadedDocumentIds,
            documentNames: stored.attachments
              .filter(a => newlyDownloadedDocumentIds.includes(a.id))
              .map(a => a.name || 'Teams attachment'),
            newExtractedData: {}, // Will be extracted after approval
            subject: `Teams message from ${stored.fromName || 'unknown'}`,
            sender: stored.fromName || 'Teams',
            messageId: message.id,
          });
          
          console.log(`[TeamsService] Created pending approval for Teams message ${message.id} on project ${projectId}`);
        }
      } catch (err) {
        console.error(`[TeamsService] Failed to create pending approval for Teams message ${message.id}:`, err);
      }
    }

    // Fetch documents from any cloud links (Dropbox) in the message body.
    try {
      await this.cloudLinkService?.ingestMessageLinks(stored);
    } catch (err) {
      console.error(
        `[TeamsService] cloud-link ingest failed for message ${message.id}: ${describeError(err)}`,
      );
    }
  }

  /**
   * Ingests the reply thread under a root message. The channel /messages/delta
   * endpoint returns ROOT messages only, so a meeting's in-chat conversation
   * (and any files shared inside it) must be fetched explicitly via /replies.
   * Each reply is stored with parentMessageId = the root's id.
   */
  private async ingestReplies(
    channel: IDomainMonitoredChannel,
    parentMessageId: string,
  ): Promise<void> {
    let replies: GraphChannelMessage[];
    try {
      replies = await this.graphClient.getAllPages<GraphChannelMessage>(
        `/teams/${channel.teamId}/channels/${channel.channelId}/messages/${parentMessageId}/replies`,
      );
    } catch (err) {
      console.error(
        `[TeamsService] failed to fetch replies for message ${parentMessageId} ` +
          `(channel ${channel.channelId}): ${describeError(err)}`,
      );
      return;
    }

    for (const reply of replies) {
      if (reply.deletedDateTime) continue;
      if (reply.messageType && reply.messageType !== 'message') continue;
      await this.ingestMessage(channel, reply);
    }
  }

  public async processMessageFiles(message: IDomainTeamsMessage): Promise<string[]> {
    const projectId = message.projectId;
    if (!projectId || !this.filesService.isEnabled()) return [];

    const pending = message.attachments.filter(
      (a) => a.contentType === 'reference' && Boolean(a.contentUrl) && !a.downloaded,
    );
    if (pending.length === 0) return [];

    const downloadedIds: string[] = [];
    for (const attachment of pending) {
      const ok = await this.filesService.ingestReferenceAttachment({
        projectId,
        uploadedBy: message.fromId ?? 'teams-integration',
        contentUrl: attachment.contentUrl as string,
        fallbackName: attachment.name,
        // The stored contentUrl dies when the team or channel is renamed, so
        // hand over the channel too and let Graph resolve where the file is now.
        locator: { teamId: message.teamId, channelId: message.channelId },
        sourceMeta: {
          source: 'teams',
          messageId: message.messageId,
          teamId: message.teamId,
          channelId: message.channelId,
          // For files shared inside a channel meeting, parentMessageId is the
          // meeting-event message id (== TeamsMeeting.channelEventMessageId),
          // letting the Meetings view read its docs back from the pipeline.
          ...(message.parentMessageId ? { parentMessageId: message.parentMessageId } : {}),
        },
      });
      if (ok) downloadedIds.push(attachment.id);
    }

    if (downloadedIds.length > 0) {
      await this.messageRepository.markAttachmentsDownloaded(message.messageId, downloadedIds);
    }
    return downloadedIds;
  }

  public async sync(channelDbId?: string, options?: SyncOptions): Promise<SyncSummary> {
    if (channelDbId) {
      const channel = await this.monitoredChannelRepository.findById(channelDbId);
      if (!channel || !channel.isActive) {
        throw new AppError('Monitored channel not found', StatusCodes.NOT_FOUND, true, {
          code: ErrorCode.NOT_FOUND,
        });
      }
      const result = await this.syncChannel(channel, options);
      return { channels: [result], errors: [] };
    }
    return this.syncAll(options);
  }

  public async syncAll(options?: SyncOptions): Promise<SyncSummary> {
    const channels = await this.monitoredChannelRepository.listActive();
    const summary: SyncSummary = { channels: [], errors: [] };

    for (const channel of channels) {
      try {
        summary.channels.push(await this.syncChannel(channel, options));
      } catch (err) {
        // Isolate failures so one bad channel doesn't abort the whole run.
        summary.errors.push({
          channelId: channel.channelId,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return summary;
  }

  // ----- Messages -----

  public async listMessages(filter: IListTeamsMessagesFilter): Promise<ITeamsMessagePage> {
    // A project sees the conversation of every channel linked to it (a shared
    // channel shows the same messages to all its projects). Resolve the linked
    // channels and match by channelId rather than the message's stored projectId.
    if (filter.projectId && !filter.channelId && !filter.channelIds) {
      const channels = await this.monitoredChannelRepository.listByProjectId(filter.projectId);
      if (channels.length > 0) {
        const channelIds = [...new Set(channels.map((c) => c.channelId))];
        return this.messageRepository.list({
          channelIds,
          page: filter.page,
          limit: filter.limit,
        });
      }
    }
    return this.messageRepository.list(filter);
  }

  public async linkMessage(messageId: string, projectId: string): Promise<IDomainTeamsMessage> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    const updated = await this.messageRepository.setProject(messageId, projectId, 'MANUAL');
    if (!updated) {
      throw new AppError('Message not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    try {
      const downloadedIds = await this.processMessageFiles(updated);
      
      // Create pending approval if new documents were downloaded
      if (downloadedIds.length > 0 && this.pendingApprovalService) {
        try {
          const correlationId = `teamsMessage:${messageId}`;
          const alreadyProcessed = await this.pendingApprovalService.isSourceProcessed(
            messageId,
            ChangeSource.TEAMS
          );
          
          if (!alreadyProcessed) {
            await this.pendingApprovalService.createPendingApproval({
              projectId,
              source: ChangeSource.TEAMS,
              sourceId: messageId,
              correlationId,
              documentIds: downloadedIds,
              documentNames: updated.attachments
                .filter(a => downloadedIds.includes(a.id))
                .map(a => a.name || 'Teams attachment'),
              newExtractedData: {},
              subject: `Manually linked Teams message`,
              sender: updated.fromName || 'Teams',
              messageId,
            });
            
            console.log(`[TeamsService] Created pending approval for manually linked Teams message ${messageId} on project ${projectId}`);
          }
        } catch (err) {
          console.error(`[TeamsService] Failed to create pending approval for manually linked Teams message ${messageId}:`, err);
        }
      }
    } catch (err) {
      console.error(
        `[TeamsService] file processing failed after linking message ${messageId}: ${describeError(err)}`,
      );
    }

    // A manually linked message won't reappear in delta — ingest its links now.
    try {
      await this.cloudLinkService?.ingestMessageLinks(updated);
    } catch (err) {
      console.error(
        `[TeamsService] cloud-link ingest failed after linking message ${messageId}: ${describeError(err)}`,
      );
    }

    return updated;
  }

  public async processFilesByMessageId(messageId: string): Promise<{ routed: number }> {
    const message = await this.messageRepository.findByMessageId(messageId);
    if (!message) {
      throw new AppError('Message not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }
    const files = await this.processMessageFiles(message);
    return { routed: files.length };
  }

  // ----- Status -----

  public async getStatus(): Promise<TeamsStatus> {
    const cached = await this.tokenService.getCachedToken();
    const channels = await this.monitoredChannelRepository.listActive();
    return {
      configured: this.tokenService.isConfigured(),
      cachedTokenExpiresAt: cached?.expiresAt ?? null,
      monitoredChannelCount: channels.length,
    };
  }
}
