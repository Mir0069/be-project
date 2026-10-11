import type { IQueueAdapter } from '@shared/queues/queue.types';
import type {
  BlobStorage,
  DocumentRepository,
  DocumentRecord,
} from '@features/document-ingestion/document-ingestion.types';
import type {
  ITeamsMessageRepository,
  IDomainTeamsMessage,
} from '@repositories/interfaces/i-teams-message.repository';
import type {
  ITeamsMeetingRepository,
  IDomainTeamsMeeting,
} from '@repositories/interfaces/i-teams-meeting.repository';
import type { ITeamsAiJobRepository } from '@repositories/interfaces/i-teams-ai-job.repository';
import type { IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';

import { describeError } from './teams.errors';
import {
  TEAMS_AI_JOB_TYPE,
  TEAMS_AI_CORRELATION_PREFIX,
  type TeamsAiPayload,
  type TeamsAiPayloadBody,
  type TeamsAiMessageEntry,
  type TeamsAiDocumentEntry,
  type TeamsAiMeetingEntry,
} from './teams-ai.types';

// The AI-facing SAS URL lifetime (minutes). Kept generous (6h) because the AI
// worker downloads doc/transcript blobs AFTER the message clears the queue —
// with any backlog a 60-min URL expired before it was read (403), leaving
// meeting summaries empty. Chat is unaffected (its text is inline, no blob).
const SAS_TTL_MIN = 360;

// Injected into TeamsService so the sync loop can emit without a hard dependency
// on the concrete service (keeps the wiring one-directional / testable).
export interface ITeamsAiDispatch {
  dispatchProjectSync(channel: IDomainMonitoredChannel): Promise<void>;
}

interface CollectedSync {
  projectId: string;
  chatMessages: IDomainTeamsMessage[]; // root channel messages (parentMessageId null)
  meetings: Array<{ meeting: IDomainTeamsMeeting; conversation: IDomainTeamsMessage[] }>;
}

interface BuiltPayload {
  body: TeamsAiPayloadBody;
  chatMessageIds: string[];
  meetingMessageIds: string[];
  meetingDbIds: string[];
  documentIds: string[];
}

export class TeamsAiDispatchService implements ITeamsAiDispatch {
  private readonly queue: IQueueAdapter<TeamsAiPayload>;
  private readonly blobStorage: BlobStorage;
  private readonly documentRepository: DocumentRepository;
  private readonly messageRepository: ITeamsMessageRepository;
  private readonly meetingRepository: ITeamsMeetingRepository;
  private readonly aiJobRepository: ITeamsAiJobRepository;
  private readonly enabled: boolean;

  public constructor(
    queue: IQueueAdapter<TeamsAiPayload>,
    blobStorage: BlobStorage,
    documentRepository: DocumentRepository,
    messageRepository: ITeamsMessageRepository,
    meetingRepository: ITeamsMeetingRepository,
    aiJobRepository: ITeamsAiJobRepository,
    enabled = true,
  ) {
    this.queue = queue;
    this.blobStorage = blobStorage;
    this.documentRepository = documentRepository;
    this.messageRepository = messageRepository;
    this.meetingRepository = meetingRepository;
    this.aiJobRepository = aiJobRepository;
    this.enabled = enabled;
  }

  /**
   * Emit one unified payload for everything newly synced on this channel: the
   * incremental chat batch + every not-yet-sent meeting (each with its
   * conversation, shared docs, and transcript). Best-effort — never throws into
   * the sync loop. Idempotent via the per-message/per-meeting `sentToAI` flags.
   */
  public async dispatchProjectSync(channel: IDomainMonitoredChannel): Promise<void> {
    if (!this.enabled) return;

    let collected: CollectedSync | null;
    try {
      collected = await this.collect(channel);
    } catch (err) {
      console.error(
        `[TeamsAiDispatch] collect failed for channel ${channel.channelId}: ${describeError(err)}`,
      );
      return;
    }
    if (!collected) return; // nothing new, or channel not linked to a project

    const sentAt = new Date();
    let built: BuiltPayload;
    try {
      built = await this.buildPayload(channel, collected, sentAt);
    } catch (err) {
      console.error(
        `[TeamsAiDispatch] payload build failed for channel ${channel.channelId}: ${describeError(err)}`,
      );
      return;
    }

    const job = await this.aiJobRepository.create({
      projectId: collected.projectId,
      teamId: channel.teamId,
      channelId: channel.channelId,
      monitoredChannelDbId: channel.id,
      messageIds: [...built.chatMessageIds, ...built.meetingMessageIds],
      meetingDbIds: built.meetingDbIds,
      documentIds: built.documentIds,
      hasChat: collected.chatMessages.length > 0,
      meetingCount: collected.meetings.length,
      sentAt,
    });

    try {
      const envelope: TeamsAiPayload = {
        jobType: TEAMS_AI_JOB_TYPE,
        correlationId: job.correlationId,
        payload: built.body,
      };
      await this.queue.publish(envelope, { deduplicationKey: job.correlationId });
    } catch (err) {
      // Leave the source `sentToAI` flags unset so the next sync retries.
      await this.aiJobRepository.markFailed(job.id, describeError(err));
      console.error(
        `[TeamsAiDispatch] publish failed for job ${job.id} (channel ${channel.channelId}): ${describeError(err)}`,
      );
      return;
    }

    // Mark everything sent AFTER a successful publish.
    await this.messageRepository.markSentToAI([
      ...built.chatMessageIds,
      ...built.meetingMessageIds,
    ]);
    for (const meetingDbId of built.meetingDbIds) {
      await this.meetingRepository.markSentToAI(meetingDbId);
    }
  }

  /**
   * Builds the exact payload WITHOUT publishing or persisting anything — used by
   * the dev preview script to print the real shape for the AI team.
   */
  public async previewPayload(channel: IDomainMonitoredChannel): Promise<TeamsAiPayload | null> {
    // Preview ignores the `sentToAI` guard so it always renders a representative
    // payload from the channel's full content.
    const collected = await this.collect(channel, true);
    if (!collected) return null;
    const built = await this.buildPayload(channel, collected, new Date());
    return {
      jobType: TEAMS_AI_JOB_TYPE,
      correlationId: `${TEAMS_AI_CORRELATION_PREFIX}:preview`,
      payload: built.body,
    };
  }

  private async collect(
    channel: IDomainMonitoredChannel,
    includeAll = false,
  ): Promise<CollectedSync | null> {
    const projectId = channel.projectIds[0];
    if (!projectId) return null; // unlinked channel — nothing to attribute

    const allMessages = includeAll
      ? (await this.messageRepository.list({ channelId: channel.channelId, limit: 500 })).messages
      : await this.messageRepository.listUnsentByChannelId(channel.channelId);
    // Channel chat = root messages; meeting replies (parentMessageId set) go with
    // their meeting bundle instead.
    const chatMessages = allMessages
      .filter((m) => !m.parentMessageId)
      .sort((a, b) => a.createdDateTime.getTime() - b.createdDateTime.getTime());

    const candidateMeetings = includeAll
      ? (await this.meetingRepository.list({ channelIds: [channel.channelId], limit: 200 })).meetings
      : await this.meetingRepository.listUnsentByChannelId(channel.channelId);
    const meetings: CollectedSync['meetings'] = [];
    for (const meeting of candidateMeetings) {
      const conversation = await this.messageRepository.listByParentMessageId(
        meeting.channelEventMessageId,
      );
      meetings.push({ meeting, conversation });
    }

    if (chatMessages.length === 0 && meetings.length === 0) return null;
    return { projectId, chatMessages, meetings };
  }

  private async buildPayload(
    channel: IDomainMonitoredChannel,
    collected: CollectedSync,
    sentAt: Date,
  ): Promise<BuiltPayload> {
    // Sender display names for attaching `sharedBy` to documents.
    const ownerByMessageId = new Map<string, string>();
    for (const m of collected.chatMessages) if (m.fromName) ownerByMessageId.set(m.messageId, m.fromName);
    for (const mt of collected.meetings)
      for (const c of mt.conversation) if (c.fromName) ownerByMessageId.set(c.messageId, c.fromName);

    const documentIds: string[] = [];

    // ---- Chat section ----
    const chatDocs = await this.documentRepository.listByTeamsMessageIds(
      collected.chatMessages.map((m) => m.messageId),
    );
    const chatDocEntries = await this.toDocEntries(chatDocs, ownerByMessageId);
    documentIds.push(...chatDocs.map((d) => d.id));

    // ---- Meetings section ----
    const meetingEntries: TeamsAiMeetingEntry[] = [];
    const meetingMessageIds: string[] = [];
    for (const { meeting, conversation } of collected.meetings) {
      const sharedDocs = meeting.projectId
        ? await this.documentRepository.listByProjectAndParentMessageId(
            meeting.projectId,
            meeting.channelEventMessageId,
          )
        : [];
      const transcriptDocs = meeting.transcriptId
        ? await this.documentRepository.listByTeamsTranscriptId(meeting.transcriptId)
        : [];
      const meetingDocs = [...sharedDocs, ...transcriptDocs.slice(0, 1)];
      documentIds.push(...meetingDocs.map((d) => d.id));
      meetingMessageIds.push(...conversation.map((c) => c.messageId));

      meetingEntries.push({
        meetingId: meeting.id,
        onlineMeetingId: meeting.meetingId ?? null,
        subject: meeting.subject ?? null,
        startDateTime: meeting.startDateTime ? meeting.startDateTime.toISOString() : null,
        participants: meeting.participantNames ?? [],
        messages: conversation.map((m) => this.toMessageEntry(m)),
        documents: await this.toDocEntries(meetingDocs, ownerByMessageId),
      });
    }

    const body: TeamsAiPayloadBody = {
      source: 'teams',
      projectId: collected.projectId,
      sentAt: sentAt.toISOString(),
      team: { id: channel.teamId, name: channel.teamName },
      channel: { id: channel.channelId, name: channel.channelName },
      chat: {
        delta: true,
        messages: collected.chatMessages.map((m) => this.toMessageEntry(m)),
        documents: chatDocEntries,
      },
      meetings: meetingEntries,
    };

    return {
      body,
      chatMessageIds: collected.chatMessages.map((m) => m.messageId),
      meetingMessageIds,
      meetingDbIds: collected.meetings.map((mt) => mt.meeting.id),
      documentIds,
    };
  }

  private toMessageEntry(m: IDomainTeamsMessage): TeamsAiMessageEntry {
    return {
      messageId: m.messageId,
      from: m.fromName ?? null,
      fromId: m.fromId ?? null,
      text: m.contentText,
      html: m.contentHtml ?? null,
      createdAt: m.createdDateTime.toISOString(),
      replyToId: m.parentMessageId ?? null,
      webUrl: m.webUrl ?? null,
    };
  }

  private async toDocEntries(
    docs: DocumentRecord[],
    ownerByMessageId: Map<string, string>,
  ): Promise<TeamsAiDocumentEntry[]> {
    return Promise.all(docs.map((d) => this.toDocEntry(d, ownerByMessageId)));
  }

  private async toDocEntry(
    doc: DocumentRecord,
    ownerByMessageId: Map<string, string>,
  ): Promise<TeamsAiDocumentEntry> {
    const role = doc.documentType === 'transcript' ? 'transcript' : 'shared-file';
    const messageId = typeof doc.metadata['messageId'] === 'string' ? doc.metadata['messageId'] : null;
    const sharedBy =
      role === 'transcript'
        ? null
        : (messageId ? ownerByMessageId.get(messageId) : undefined) ?? doc.uploadedBy ?? null;
    const blobUrl = await this.blobStorage.createSignedDownloadUrl(doc.storageKey, SAS_TTL_MIN, {
      fileName: doc.originalName,
    });
    return {
      documentId: doc.id,
      originalName: doc.originalName,
      documentType: doc.documentType,
      role,
      mimeType: doc.mimeType,
      byteSize: doc.byteSize,
      blobUrl,
      sharedBy,
      sharedAt: doc.uploadedAt ? doc.uploadedAt.toISOString() : null,
    };
  }
}
