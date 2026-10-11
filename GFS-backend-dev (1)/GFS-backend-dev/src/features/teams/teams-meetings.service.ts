import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type {
  ITeamsMeetingRepository,
  IDomainTeamsMeeting,
  IListTeamsMeetingsFilter,
  ITeamsMeetingPage,
} from '@repositories/interfaces/i-teams-meeting.repository';
import type {
  ITeamsTranscriptRepository,
  IDomainTeamsTranscript,
} from '@repositories/interfaces/i-teams-transcript.repository';
import type {
  ITeamsMessageRepository,
  IDomainTeamsMessage,
} from '@repositories/interfaces/i-teams-message.repository';
import type { DocumentRepository } from '@features/document-ingestion/document-ingestion.types';
import type {
  ITeamsMonitoredChannelRepository,
  IDomainMonitoredChannel,
} from '@repositories/interfaces/i-teams-monitored-channel.repository';

export interface RecordChannelMeetingInput {
  channelEventMessageId: string;
  callId?: string | null;

  meetingId: string | null;
  subject?: string | null;
  startDateTime?: Date | null;
  channelContext: {
    monitoredChannelDbId: string;
    teamId: string;
    channelId: string;
    projectId: string | null;
  };
}

export interface TeamsMeetingConversationItem {
  messageId: string;
  parentMessageId: string | null;
  fromName: string | null;
  fromId: string | null;
  contentText: string;
  createdDateTime: Date;
  webUrl: string | null;
}

export interface TeamsMeetingDocumentView {
  documentId: string | null;
  originalName: string;
  documentType: string | null;
  status: string | null;
  blobUrl: string | null;
  byteSize: number | null;
  source: string;
  sharedByName: string | null;
  sharedAt: Date | null;
  contentUrl: string | null;
}

export interface TeamsMeetingTranscriptView {
  transcriptId: string;
  createdDateTime: Date | null;
  text: string;
  vtt: string;
  byteSize: number;
  routedToPipeline: boolean;
}

export interface TeamsMeetingDetail {
  meeting: IDomainTeamsMeeting;
  conversation: TeamsMeetingConversationItem[];
  documents: TeamsMeetingDocumentView[];
  transcript: TeamsMeetingTranscriptView | null;
}

export class TeamsMeetingsService {
  private readonly meetingRepository: ITeamsMeetingRepository;
  private readonly transcriptRepository: ITeamsTranscriptRepository;
  private readonly messageRepository: ITeamsMessageRepository;
  private readonly documentRepository: DocumentRepository;
  private readonly monitoredChannelRepository: ITeamsMonitoredChannelRepository;

  public constructor(
    meetingRepository: ITeamsMeetingRepository,
    transcriptRepository: ITeamsTranscriptRepository,
    messageRepository: ITeamsMessageRepository,
    documentRepository: DocumentRepository,
    monitoredChannelRepository: ITeamsMonitoredChannelRepository,
  ) {
    this.meetingRepository = meetingRepository;
    this.transcriptRepository = transcriptRepository;
    this.messageRepository = messageRepository;
    this.documentRepository = documentRepository;
    this.monitoredChannelRepository = monitoredChannelRepository;
  }


  public static extractVttSpeakers(vtt: string): string[] {
    if (!vtt) return [];
    const re = /<v\s+([^>]+)>/gi;
    const seen = new Set<string>();
    const speakers: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(vtt)) !== null) {
      const name = (match[1] ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      speakers.push(name);
    }
    return speakers;
  }

  public static mergeDistinct(...groups: string[][]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const group of groups) {
      for (const raw of group) {
        const name = (raw ?? '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(name);
      }
    }
    return result.sort((a, b) => a.localeCompare(b));
  }

  public async recordFromChannelEvent(input: RecordChannelMeetingInput): Promise<IDomainTeamsMeeting> {
    const transcripts = input.meetingId
      ? (await this.transcriptRepository.list({ meetingId: input.meetingId, limit: 100 })).transcripts
      : [];
    const transcript = this.selectTranscript(transcripts, input.startDateTime ?? null);

    const messages = await this.messageRepository.listByParentMessageId(input.channelEventMessageId);

    const participantNames = TeamsMeetingsService.mergeDistinct(
      TeamsMeetingsService.extractVttSpeakers(transcript?.contentVtt ?? ''),
      messages.map((m) => m.fromName ?? ''),
    );

    const documentCount = messages.reduce(
      (acc, m) => acc + m.attachments.filter((a) => a.contentType === 'reference').length,
      0,
    );

    return this.meetingRepository.upsertByChannelEventMessageId({
      channelEventMessageId: input.channelEventMessageId,
      callId: input.callId ?? null,
      meetingId: input.meetingId,
      subject: input.subject ?? null,
      startDateTime: input.startDateTime ?? null,
      teamId: input.channelContext.teamId,
      channelId: input.channelContext.channelId,
      monitoredChannelDbId: input.channelContext.monitoredChannelDbId,
      projectId: input.channelContext.projectId,
      transcriptId: transcript?.transcriptId ?? null,
      participantNames,
      participantCount: participantNames.length,
      messageCount: messages.length,
      documentCount,
      hasTranscript: Boolean(transcript),
      lastRecordedAt: new Date(),
    });
  }

  // Aggregated AI summaries for a project's Teams workspace: the channel's
  // accumulated chat summary + each meeting's summary. Powers the FE cards.
  public async getProjectAiSummary(projectId: string): Promise<{
    chat: IDomainMonitoredChannel['aiChatSummary'];
    meetings: Array<{
      meetingId: string;
      subject: string | null;
      startDateTime: Date | null;
      hasTranscript: boolean;
      aiSummary: IDomainTeamsMeeting['aiSummary'];
    }>;
  }> {
    const channels = await this.monitoredChannelRepository.listByProjectId(projectId);
    const chat = channels.map((c) => c.aiChatSummary).find(Boolean) ?? null;
    const channelIds = [...new Set(channels.map((c) => c.channelId))];
    const meetings = channelIds.length
      ? (await this.meetingRepository.list({ channelIds, limit: 200 })).meetings
      : [];
    return {
      chat,
      meetings: meetings.map((m) => ({
        meetingId: m.id,
        subject: m.subject ?? null,
        startDateTime: m.startDateTime ?? null,
        hasTranscript: m.hasTranscript,
        aiSummary: m.aiSummary,
      })),
    };
  }

  public async listMeetings(filter: IListTeamsMeetingsFilter): Promise<ITeamsMeetingPage> {
    // A project sees the meetings of every channel linked to it (a shared
    // channel shows the same meetings to all its projects).
    if (filter.projectId && !filter.channelId && !filter.channelIds) {
      const channels = await this.monitoredChannelRepository.listByProjectId(filter.projectId);
      if (channels.length > 0) {
        const channelIds = [...new Set(channels.map((c) => c.channelId))];
        return this.meetingRepository.list({
          channelIds,
          page: filter.page,
          limit: filter.limit,
        });
      }
    }
    return this.meetingRepository.list(filter);
  }

  public async getMeeting(id: string): Promise<TeamsMeetingDetail> {
    const meeting = await this.meetingRepository.findById(id);
    if (!meeting) {
      throw new AppError('Meeting not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    const messages = await this.messageRepository.listByParentMessageId(
      meeting.channelEventMessageId,
    );

    const conversation: TeamsMeetingConversationItem[] = messages.map((m) => ({
      messageId: m.messageId,
      parentMessageId: m.parentMessageId ?? null,
      fromName: m.fromName ?? null,
      fromId: m.fromId ?? null,
      contentText: m.contentText,
      createdDateTime: m.createdDateTime,
      webUrl: m.webUrl ?? null,
    }));

    const documents = await this.assembleDocuments(meeting, messages);

    let transcript: TeamsMeetingTranscriptView | null = null;
    if (meeting.transcriptId) {
      const t = await this.transcriptRepository.findByTranscriptId(meeting.transcriptId);
      if (t) {
        transcript = {
          transcriptId: t.transcriptId,
          createdDateTime: t.transcriptCreatedDateTime ?? null,
          text: t.contentText,
          vtt: t.contentVtt,
          byteSize: t.byteSize,
          routedToPipeline: t.routedToPipeline,
        };
      }
    }

    return { meeting, conversation, documents, transcript };
  }

  // Meeting documents are the real ingested pipeline records (matched by the
  // meeting-event message id stamped into their metadata). Falls back to the
  // raw shared attachment only when no pipeline record exists yet.
  private async assembleDocuments(
    meeting: IDomainTeamsMeeting,
    messages: IDomainTeamsMessage[],
  ): Promise<TeamsMeetingDocumentView[]> {
    const ownerByMessageId = new Map<string, { fromName: string | null; createdDateTime: Date }>();
    for (const m of messages) {
      ownerByMessageId.set(m.messageId, {
        fromName: m.fromName ?? null,
        createdDateTime: m.createdDateTime,
      });
    }

    if (meeting.projectId) {
      const docs = await this.documentRepository.listByProjectAndParentMessageId(
        meeting.projectId,
        meeting.channelEventMessageId,
      );
      if (docs.length > 0) {
        return docs.map((d) => {
          const owner = ownerByMessageId.get(String(d.metadata['messageId'] ?? ''));
          return {
            documentId: d.id,
            originalName: d.originalName,
            documentType: d.documentType,
            status: d.status,
            blobUrl: d.blobUrl,
            byteSize: d.byteSize,
            source: String(d.metadata['source'] ?? 'teams'),
            sharedByName: owner?.fromName ?? d.uploadedBy ?? null,
            sharedAt: owner?.createdDateTime ?? d.uploadedAt,
            contentUrl: null,
          };
        });
      }
    }

    const fallback: TeamsMeetingDocumentView[] = [];
    for (const m of messages) {
      for (const att of m.attachments) {
        if (att.contentType !== 'reference') continue;
        fallback.push({
          documentId: null,
          originalName: att.name ?? 'teams-file',
          documentType: null,
          status: 'PENDING',
          blobUrl: null,
          byteSize: null,
          source: 'teams',
          sharedByName: m.fromName ?? null,
          sharedAt: m.createdDateTime,
          contentUrl: att.contentUrl ?? null,
        });
      }
    }
    return fallback;
  }

  private selectTranscript(
    transcripts: IDomainTeamsTranscript[],
    startDateTime: Date | null,
  ): IDomainTeamsTranscript | null {
    if (transcripts.length === 0) return null;
    const time = (t: IDomainTeamsTranscript): number =>
      t.transcriptCreatedDateTime ? t.transcriptCreatedDateTime.getTime() : 0;
    if (!startDateTime) {
      return [...transcripts].sort((a, b) => time(b) - time(a))[0] ?? null;
    }
    const target = startDateTime.getTime();
    return (
      [...transcripts].sort((a, b) => Math.abs(time(a) - target) - Math.abs(time(b) - target))[0] ??
      null
    );
  }
}
