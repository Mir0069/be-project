import crypto from 'crypto';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type {
  ITeamsTranscriptRepository,
  IDomainTeamsTranscript,
  ITeamsTranscriptPage,
  IListTeamsTranscriptsFilter,
} from '@repositories/interfaces/i-teams-transcript.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

import type { IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';

import type { ITeamsGraphClient } from './teams.graph-client';
import type { TeamsAssociationService } from './teams-association.service';
import type { IDocumentIngestionPort } from './document-ingestion.port';
import type { TeamsMeetingsService } from './teams-meetings.service';
import { describeError } from './teams.errors';
import type {
  GraphCalendarEvent,
  GraphCallTranscript,
  GraphChannelMessage,
  GraphList,
  GraphOnlineMeeting,
} from './teams.types';

const CHANNEL_MEETING_THREAD_MARKER = '@thread.tacv2';
const CALENDAR_WINDOW_MS = 4 * 60 * 60 * 1000;

// onlineMeeting ids are base64; the thread marker only appears once decoded.
const isChannelMeetingId = (meetingId: string): boolean =>
  meetingId.includes(CHANNEL_MEETING_THREAD_MARKER) ||
  Buffer.from(meetingId, 'base64').toString('utf8').includes(CHANNEL_MEETING_THREAD_MARKER);

export interface FetchTranscriptsChannelContext {
  monitoredChannelDbId: string;
  teamId: string;
  channelId: string;
  projectId: string | null;
}

export interface FetchTranscriptsInput {
  userId: string;
  meetingId: string;
  // Optional explicit project mapping — sets linkMethod = MANUAL.
  projectId?: string;
  // Channel context — passed in only when this fetch was triggered by a
  // discovered channel meeting event. Stamps the resulting transcript with
  // the originating monitored channel and inherits the channel's projectId.
  channelContext?: FetchTranscriptsChannelContext;
}

export interface FetchTranscriptResult {
  transcriptId: string;
  stored: boolean;
  projectId: string | null;
  linkMethod: 'AUTO' | 'MANUAL' | null;
  routedToPipeline: boolean;
  byteSize: number;
}

export interface FetchTranscriptsSummary {
  meetingId: string;
  meetingSubject: string | null;
  transcripts: FetchTranscriptResult[];
}

/**
 * Strips a VTT transcript to plain text suitable for keyword matching:
 *  - drops the WEBVTT header
 *  - drops cue identifiers (UUIDs / line numbers)
 *  - drops timing lines like "00:01:23.000 --> 00:01:27.000"
 *  - collapses whitespace and joins cue lines with spaces
 */
export const vttToText = (vtt: string): string => {
  if (!vtt) return '';
  const TIMING_LINE = /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}/;
  const CUE_ID_LINE = /^([0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
  // Strip <v Speaker> tags but keep the speech: "<v Alice>Hello" → "Hello"
  const stripSpeakerTag = (line: string): string =>
    line.replace(/<v\s+[^>]+>/gi, '').replace(/<\/v>/gi, '').replace(/<[^>]+>/g, '');

  return vtt
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (trimmed === 'WEBVTT' || trimmed.startsWith('WEBVTT')) return false;
      if (trimmed.startsWith('NOTE')) return false;
      if (TIMING_LINE.test(trimmed)) return false;
      if (CUE_ID_LINE.test(trimmed)) return false;
      return true;
    })
    .map((line) => stripSpeakerTag(line).trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export class TeamsTranscriptsService {
  private readonly graphClient: ITeamsGraphClient;
  private readonly transcriptRepository: ITeamsTranscriptRepository;
  private readonly projectRepository: IProjectRepository;
  private readonly associationService: TeamsAssociationService;
  private readonly documentPort: IDocumentIngestionPort;
  private readonly meetingsService: TeamsMeetingsService;
  private readonly pipelineEnabled: boolean;

  public constructor(
    graphClient: ITeamsGraphClient,
    transcriptRepository: ITeamsTranscriptRepository,
    projectRepository: IProjectRepository,
    associationService: TeamsAssociationService,
    documentPort: IDocumentIngestionPort,
    meetingsService: TeamsMeetingsService,
    pipelineEnabled = true,
  ) {
    this.graphClient = graphClient;
    this.transcriptRepository = transcriptRepository;
    this.projectRepository = projectRepository;
    this.associationService = associationService;
    this.documentPort = documentPort;
    this.meetingsService = meetingsService;
    this.pipelineEnabled = pipelineEnabled;
  }

  public async fetchAndStore(input: FetchTranscriptsInput): Promise<FetchTranscriptsSummary> {
    // Validate explicit project mapping up-front.
    if (input.projectId) {
      const project = await this.projectRepository.findById(input.projectId);
      if (!project) {
        throw new AppError('Project not found', StatusCodes.NOT_FOUND, true, {
          code: ErrorCode.NOT_FOUND,
        });
      }
    }

    // onlineMeetings endpoints require the user's object-id (GUID); a UPN/email
    // returns a misleading 404. Resolve once and use it for all meeting calls.
    const graphUserId = await this.graphClient.resolveUserId(input.userId);

    // Fetch meeting metadata (subject helps both naming and keyword matching).
    let meeting: GraphOnlineMeeting | null = null;
    try {
      meeting = await this.graphClient.get<GraphOnlineMeeting>(
        `/users/${graphUserId}/onlineMeetings/${input.meetingId}`,
      );
    } catch (err) {
      // If the meeting itself can't be fetched, fail hard — likely 403/404.
      throw err;
    }

    const list = await this.graphClient.get<GraphList<GraphCallTranscript>>(
      `/users/${graphUserId}/onlineMeetings/${input.meetingId}/transcripts`,
    );

    const results: FetchTranscriptResult[] = [];

    for (const t of list.value ?? []) {
      const existing = await this.transcriptRepository.findByTranscriptId(t.id);

      const buffer = await this.graphClient.getBinary(
        `/users/${graphUserId}/onlineMeetings/${input.meetingId}/transcripts/${t.id}/content?$format=text/vtt`,
      );
      const contentVtt = buffer.toString('utf8');
      const contentText = vttToText(contentVtt);

      let projectId: string | null;
      let linkMethod: 'AUTO' | 'MANUAL' | null;

      if (existing && existing.linkMethod === 'MANUAL') {
        // Preserve a previous manual link across re-fetch.
        projectId = existing.projectId ?? null;
        linkMethod = 'MANUAL';
      } else if (input.projectId) {
        projectId = input.projectId;
        linkMethod = 'MANUAL';
      } else if (input.channelContext) {
        // Deterministic channel→project mapping — no keyword guessing for
        // channel-discovered transcripts. AUTO indicates the link was system-
        // derived (vs MANUAL admin action).
        projectId = input.channelContext.projectId;
        linkMethod = projectId ? 'AUTO' : null;
      } else {
        const resolved = await this.associationService.resolveProject({
          contentText,
          channelName: meeting?.subject ?? '',
          channelProjectId: null,
        });
        projectId = resolved.projectId;
        linkMethod = resolved.linkMethod === 'CHANNEL_MAP' ? 'AUTO' : (resolved.linkMethod as 'AUTO' | null);
      }

      const stored = await this.transcriptRepository.upsertByTranscriptId({
        transcriptId: t.id,
        meetingId: input.meetingId,
        userId: input.userId,
        meetingSubject: meeting?.subject ?? null,
        meetingJoinUrl: meeting?.joinWebUrl ?? null,
        contentVtt,
        contentText,
        byteSize: buffer.length,
        transcriptCreatedDateTime: t.createdDateTime ? new Date(t.createdDateTime) : null,
        projectId,
        linkMethod,
        routedToPipeline: existing?.routedToPipeline ?? false,
        monitoredChannelDbId: input.channelContext?.monitoredChannelDbId ?? null,
        teamId: input.channelContext?.teamId ?? null,
        channelId: input.channelContext?.channelId ?? null,
        discoveredVia: input.channelContext ? 'CHANNEL_EVENT' : 'MANUAL',
        fetchedAt: new Date(),
      });

      const routed = await this.maybeRouteToPipeline(stored);

      results.push({
        transcriptId: stored.transcriptId,
        stored: true,
        projectId: stored.projectId ?? null,
        linkMethod: stored.linkMethod ?? null,
        routedToPipeline: routed || stored.routedToPipeline,
        byteSize: stored.byteSize,
      });
    }

    return {
      meetingId: input.meetingId,
      meetingSubject: meeting?.subject ?? null,
      transcripts: results,
    };
  }

  public async listTranscripts(filter: IListTeamsTranscriptsFilter): Promise<ITeamsTranscriptPage> {
    return this.transcriptRepository.list(filter);
  }

  public async linkTranscript(
    transcriptId: string,
    projectId: string,
  ): Promise<IDomainTeamsTranscript> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    const updated = await this.transcriptRepository.setProject(transcriptId, projectId, 'MANUAL');
    if (!updated) {
      throw new AppError('Transcript not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    if (!updated.routedToPipeline) {
      try {
        await this.maybeRouteToPipeline(updated);
      } catch (err) {
        console.error(
          `[TeamsTranscripts] pipeline route after manual link failed for ${transcriptId}: ${describeError(err)}`,
        );
      }
    }

    return updated;
  }

  /**
   * Called by TeamsService.syncChannel when it sees a meeting-event message.
   * Resolves the meeting id (from the event, else via the organizer's
   * calendar), then delegates to fetchAndStore with channel context so the
   * transcript inherits the channel's project mapping. Only scheduled channel
   * meetings are reachable — ad-hoc "Meet now" calls expose no resolvable id.
   *
   * Best-effort: per-event errors are logged and swallowed so one bad meeting
   * never aborts channel sync.
   */
  public async discoverFromChannelEvent(
    channel: IDomainMonitoredChannel,
    message: GraphChannelMessage,
  ): Promise<void> {
    const eventDetail = message.eventDetail;
    if (!eventDetail) return;

    const organizerUserId =
      eventDetail.initiator?.user?.id ?? eventDetail.meetingOrganizer?.user?.id;
    if (!organizerUserId) {
      console.warn(
        `[TeamsTranscripts] channel-event ${message.id} on channel ${channel.channelId} ` +
          `lacks initiator.user.id; skipping transcript discovery`,
      );
      return;
    }

    let meetingIds: string[] = [];
    if (eventDetail.meetingId) {
      meetingIds = [eventDetail.meetingId];
    } else {
      const eventTimeMs = message.createdDateTime
        ? new Date(message.createdDateTime).getTime()
        : Date.now();
      try {
        meetingIds = await this.resolveChannelMeetingIdsViaCalendar(organizerUserId, eventTimeMs);
      } catch (err) {
        console.error(
          `[TeamsTranscripts] calendar meetingId resolution failed for organizer ${organizerUserId}: ${describeError(err)}`,
        );
        return;
      }
    }

    if (meetingIds.length === 0) {
      console.warn(
        `[TeamsTranscripts] no channel meeting resolved for event ${message.id} on channel ${channel.channelId}`,
      );
      return;
    }

    const channelContext: FetchTranscriptsChannelContext = {
      monitoredChannelDbId: channel.id,
      teamId: channel.teamId,
      channelId: channel.channelId,
      // Primary (first) linked project; a shared channel's transcript record is
      // attributed here, while the meeting is shown to every linked project.
      projectId: channel.projectIds[0] ?? null,
    };

    for (const meetingId of meetingIds) {
      try {
        const summary = await this.fetchAndStore({
          userId: organizerUserId,
          meetingId,
          channelContext,
        });
        try {
          await this.meetingsService.recordFromChannelEvent({
            channelEventMessageId: message.id,
            callId: eventDetail.callId ?? null,
            meetingId,
            subject: summary.meetingSubject,
            startDateTime: message.createdDateTime ? new Date(message.createdDateTime) : null,
            channelContext,
          });
        } catch (err) {
          console.error(
            `[TeamsTranscripts] recordFromChannelEvent failed for meeting ${meetingId} ` +
              `(channel ${channel.channelId}): ${describeError(err)}`,
          );
        }
      } catch (err) {
        console.error(
          `[TeamsTranscripts] fetchAndStore failed for meeting ${meetingId} ` +
            `(organizer ${organizerUserId}, channel ${channel.channelId}): ${describeError(err)}`,
        );
      }
    }
  }

  /**
   * Records a SCHEDULED channel meeting from its `meetingReference` attachment
   * (the "… scheduled a meeting" message). Unlike discoverFromChannelEvent this
   * doesn't need a callStarted event — it resolves the online-meeting id from the
   * reference's joinUrl, fetches the transcript when available, and ALWAYS records
   * the meeting so it appears in the Meetings section even without a transcript.
   */
  public async discoverFromMeetingReference(
    channel: IDomainMonitoredChannel,
    message: GraphChannelMessage,
  ): Promise<void> {
    const ref = (message.attachments ?? []).find((a) => a.contentType === 'meetingReference');
    if (!ref?.content) return;

    let parsed: { organizerId?: string; meetingJoinUrl?: string };
    try {
      parsed = JSON.parse(ref.content);
    } catch {
      console.warn(`[TeamsTranscripts] unparseable meetingReference on message ${message.id}`);
      return;
    }
    if (!parsed.organizerId || !parsed.meetingJoinUrl) return;

    const channelContext: FetchTranscriptsChannelContext = {
      monitoredChannelDbId: channel.id,
      teamId: channel.teamId,
      channelId: channel.channelId,
      projectId: channel.projectIds[0] ?? null,
    };

    // Resolve the online-meeting id from the join URL (best-effort).
    let meetingId: string | null = null;
    try {
      meetingId = await this.graphClient.getOnlineMeetingIdByJoinUrl(
        parsed.organizerId,
        parsed.meetingJoinUrl,
      );
    } catch (err) {
      console.error(
        `[TeamsTranscripts] meetingReference id resolve failed for message ${message.id}: ${describeError(err)}`,
      );
    }

    // Fetch + store the transcript when we have a meeting id (best-effort).
    if (meetingId) {
      try {
        await this.fetchAndStore({ userId: parsed.organizerId, meetingId, channelContext });
      } catch (err) {
        console.error(
          `[TeamsTranscripts] transcript fetch failed for scheduled meeting ${meetingId} ` +
            `(channel ${channel.channelId}): ${describeError(err)}`,
        );
      }
    }

    // Record the meeting regardless — the chat thread + shared docs make it
    // useful even when the transcript isn't retrievable.
    try {
      await this.meetingsService.recordFromChannelEvent({
        channelEventMessageId: message.id,
        callId: null,
        meetingId,
        subject: ref.name ?? null,
        startDateTime: message.createdDateTime ? new Date(message.createdDateTime) : null,
        channelContext,
      });
    } catch (err) {
      console.error(
        `[TeamsTranscripts] recordFromChannelEvent failed for scheduled meeting on ` +
          `message ${message.id} (channel ${channel.channelId}): ${describeError(err)}`,
      );
    }
  }

  private async resolveChannelMeetingIdsViaCalendar(
    organizerId: string,
    eventTimeMs: number,
  ): Promise<string[]> {
    const startIso = new Date(eventTimeMs - CALENDAR_WINDOW_MS).toISOString();
    const endIso = new Date(eventTimeMs + CALENDAR_WINDOW_MS).toISOString();

    const events = await this.graphClient.get<GraphList<GraphCalendarEvent>>(
      `/users/${encodeURIComponent(organizerId)}/calendarView`,
      {
        startDateTime: startIso,
        endDateTime: endIso,
        $select: 'subject,start,end,isOnlineMeeting,onlineMeeting',
        $top: '50',
      },
    );

    const candidates: Array<{ meetingId: string; startMs: number }> = [];
    for (const ev of events.value ?? []) {
      const joinUrl = ev.onlineMeeting?.joinUrl;
      if (!ev.isOnlineMeeting || !joinUrl) continue;
      const meetingId = await this.graphClient.getOnlineMeetingIdByJoinUrl(organizerId, joinUrl);
      if (!meetingId || !isChannelMeetingId(meetingId)) continue;
      const parsedStart = ev.start?.dateTime ? new Date(ev.start.dateTime).getTime() : NaN;
      candidates.push({ meetingId, startMs: Number.isNaN(parsedStart) ? eventTimeMs : parsedStart });
    }

    if (candidates.length === 0) return [];
    if (candidates.length > 1) {
      console.warn(
        `[TeamsTranscripts] ${candidates.length} channel meetings near event time for organizer ${organizerId}; picking nearest`,
      );
    }
    candidates.sort(
      (a, b) => Math.abs(a.startMs - eventTimeMs) - Math.abs(b.startMs - eventTimeMs),
    );
    return [candidates[0]!.meetingId];
  }

  /**
   * Hands the transcript text to the Document Ingestion Pipeline as a
   * documentType:'transcript' .txt file. Idempotent via routedToPipeline.
   * Returns true if the route call was made on this invocation.
   */
  private async maybeRouteToPipeline(transcript: IDomainTeamsTranscript): Promise<boolean> {
    if (!this.pipelineEnabled) return false;
    if (!transcript.projectId) return false;
    if (transcript.routedToPipeline) return false;

    // Match the Meetings view's transcript artifact: a real ".vtt" file named
    // "<slug>-transcript-<shortId>.vtt". The short id keeps the blob storage key
    // unique when two meetings share a subject (storage keys are name-derived).
    const slug =
      (transcript.meetingSubject ?? transcript.meetingId)
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'meeting';
    // Hash the FULL id — transcriptIds share a trailing "…TranscriptV2" marker,
    // so a tail slice collides across meetings; a hash stays unique per transcript.
    const shortId = crypto.createHash('sha256').update(transcript.transcriptId).digest('hex').slice(0, 8);
    const originalName = `${slug}-transcript-${shortId}.vtt`;

    try {
      await this.documentPort.upload(
        { userId: transcript.userId },
        {
          projectId: transcript.projectId,
          file: {
            originalName,
            mimeType: 'text/vtt',
            // Store the raw VTT (speaker + timing) — the same artifact the
            // Meetings view serves, and a superset of the plain text for the AI.
            buffer: Buffer.from(transcript.contentVtt, 'utf8'),
          },
          uploadedBy: transcript.userId,
          documentType: 'transcript',
          metadata: {
            source: 'teams',
            meetingId: transcript.meetingId,
            transcriptId: transcript.transcriptId,
            // Stamp the originating channel so the transcript surfaces in EVERY
            // linked project's Documents tab via the channel-share union
            // (listByTeamsChannelIds), not only the primary project it's
            // ingested under. Mirrors how regular Teams files are stamped.
            ...(transcript.teamId ? { teamId: transcript.teamId } : {}),
            ...(transcript.channelId ? { channelId: transcript.channelId } : {}),
          },
        },
      );
      await this.transcriptRepository.markRoutedToPipeline(transcript.transcriptId);
      return true;
    } catch (err) {
      console.error(
        `[TeamsTranscripts] failed to route transcript ${transcript.transcriptId} to pipeline: ${describeError(err)}`,
      );
      return false;
    }
  }
}
