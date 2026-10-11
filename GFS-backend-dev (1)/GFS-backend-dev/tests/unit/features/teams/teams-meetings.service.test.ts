import { TeamsMeetingsService } from '@features/teams/teams-meetings.service';
import type { ITeamsMeetingRepository, IDomainTeamsMeeting } from '@repositories/interfaces/i-teams-meeting.repository';
import type { ITeamsTranscriptRepository, IDomainTeamsTranscript } from '@repositories/interfaces/i-teams-transcript.repository';
import type { ITeamsMessageRepository, IDomainTeamsMessage } from '@repositories/interfaces/i-teams-message.repository';
import type { DocumentRepository, DocumentRecord } from '@features/document-ingestion/document-ingestion.types';
import type { ITeamsMonitoredChannelRepository } from '@repositories/interfaces/i-teams-monitored-channel.repository';

const VTT = `WEBVTT

00:00:00.000 --> 00:00:03.000
<v Alice>Hello everyone.

00:00:03.500 --> 00:00:06.000
<v Bob>Hi Alice.
`;

const makeTranscript = (o: Partial<IDomainTeamsTranscript> = {}): IDomainTeamsTranscript => ({
  id: 'db-t',
  transcriptId: 't1',
  meetingId: 'meet-1',
  userId: 'u1',
  meetingSubject: 'Sync',
  meetingJoinUrl: null,
  contentVtt: VTT,
  contentText: 'Hello everyone. Hi Alice.',
  byteSize: VTT.length,
  transcriptCreatedDateTime: new Date('2026-07-01T10:45:00Z'),
  projectId: 'p1',
  linkMethod: 'AUTO',
  routedToPipeline: true,
  monitoredChannelDbId: 'mc-1',
  teamId: 'team-A',
  channelId: 'chan-A',
  discoveredVia: 'CHANNEL_EVENT',
  fetchedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeMessage = (o: Partial<IDomainTeamsMessage> = {}): IDomainTeamsMessage => ({
  id: 'db-m',
  messageId: 'm1',
  teamId: 'team-A',
  channelId: 'chan-A',
  parentMessageId: 'evt-1',
  fromName: 'Carol',
  fromId: 'u-carol',
  contentText: 'here is the plan',
  contentHtml: null,
  webUrl: 'https://teams/msg/m1',
  createdDateTime: new Date('2026-07-01T10:05:00Z'),
  attachments: [],
  projectId: 'p1',
  linkMethod: 'CHANNEL_MAP',
  routedToPipeline: false,
  sentToAI: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeDoc = (o: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 'doc-1',
  projectId: 'p1',
  rootDocumentId: 'root-1',
  version: 1,
  isLatest: true,
  isDeleted: false,
  isFinalInput: false,
  documentType: 'drawing',
  status: 'PROCESSED',
  originalName: 'floor-plan.pdf',
  mimeType: 'application/pdf',
  extension: '.pdf',
  storageKey: 'key',
  blobUrl: 'https://blob/floor-plan.pdf',
  sha256: 'abc',
  byteSize: 1234,
  uploadedBy: 'teams-integration',
  uploadedAt: new Date('2026-07-01T10:06:00Z'),
  updatedAt: new Date(),
  metadata: { source: 'teams', messageId: 'm1', parentMessageId: 'evt-1' },
  ...o,
});

let meetingRepo: jest.Mocked<ITeamsMeetingRepository>;
let transcriptRepo: { list: jest.Mock; findByTranscriptId: jest.Mock };
let messageRepo: { listByParentMessageId: jest.Mock };
let documentRepo: { listByProjectAndParentMessageId: jest.Mock };
let channelRepo: { listByProjectId: jest.Mock };
let service: TeamsMeetingsService;

beforeEach(() => {
  meetingRepo = {
    upsertByChannelEventMessageId: jest.fn().mockImplementation(async (f) => ({ id: 'meeting-db-1', ...f })),
    findById: jest.fn(),
    list: jest.fn(),
    listUnsentByChannelId: jest.fn().mockResolvedValue([]),
    markSentToAI: jest.fn(),
    setAiSummary: jest.fn(),
  };
  transcriptRepo = {
    list: jest.fn().mockResolvedValue({ transcripts: [], total: 0 }),
    findByTranscriptId: jest.fn(),
  };
  messageRepo = { listByParentMessageId: jest.fn().mockResolvedValue([]) };
  documentRepo = { listByProjectAndParentMessageId: jest.fn().mockResolvedValue([]) };
  channelRepo = { listByProjectId: jest.fn().mockResolvedValue([]) };

  service = new TeamsMeetingsService(
    meetingRepo,
    transcriptRepo as unknown as ITeamsTranscriptRepository,
    messageRepo as unknown as ITeamsMessageRepository,
    documentRepo as unknown as DocumentRepository,
    channelRepo as unknown as ITeamsMonitoredChannelRepository,
  );
});

describe('extractVttSpeakers', () => {
  it('returns distinct speakers, first-seen casing, ignoring timing/cues', () => {
    expect(TeamsMeetingsService.extractVttSpeakers(VTT)).toEqual(['Alice', 'Bob']);
  });

  it('dedupes case-insensitively', () => {
    const vtt = '<v Alice>a</v>\n<v alice>b</v>\n<v ALICE>c';
    expect(TeamsMeetingsService.extractVttSpeakers(vtt)).toEqual(['Alice']);
  });

  it('returns [] for empty input', () => {
    expect(TeamsMeetingsService.extractVttSpeakers('')).toEqual([]);
  });
});

describe('recordFromChannelEvent', () => {
  const input = {
    channelEventMessageId: 'evt-1',
    callId: 'call-1',
    meetingId: 'meet-1',
    subject: 'Weekly Sync',
    startDateTime: new Date('2026-07-01T10:00:00Z'),
    channelContext: {
      monitoredChannelDbId: 'mc-1',
      teamId: 'team-A',
      channelId: 'chan-A',
      projectId: 'p1',
    },
  };

  it('derives participants (VTT speakers UNION message senders), counts, and hasTranscript', async () => {
    transcriptRepo.list.mockResolvedValue({ transcripts: [makeTranscript()], total: 1 });
    messageRepo.listByParentMessageId.mockResolvedValue([
      makeMessage({ messageId: 'm1', fromName: 'Carol', attachments: [{ id: 'a1', name: 'f.pdf', contentType: 'reference', contentUrl: 'u', downloaded: true }] }),
      // "alice " collapses into VTT "Alice"; one reference + one non-reference attachment
      makeMessage({ messageId: 'm2', fromName: 'alice ', attachments: [
        { id: 'a2', name: 'g.pdf', contentType: 'reference', contentUrl: 'u', downloaded: false },
        { id: 'a3', name: 'x', contentType: 'other', contentUrl: null, downloaded: false },
      ] }),
    ]);

    await service.recordFromChannelEvent(input);

    const payload = meetingRepo.upsertByChannelEventMessageId.mock.calls[0]?.[0];
    expect(payload?.channelEventMessageId).toBe('evt-1');
    expect(payload?.callId).toBe('call-1');
    expect(payload?.transcriptId).toBe('t1');
    expect(payload?.hasTranscript).toBe(true);
    expect(payload?.participantNames).toEqual(['Alice', 'Bob', 'Carol']); // sorted, deduped
    expect(payload?.participantCount).toBe(3);
    expect(payload?.messageCount).toBe(2);
    expect(payload?.documentCount).toBe(2); // only 'reference' attachments
    expect(payload?.projectId).toBe('p1');
  });

  it('handles the no-transcript path (participants from senders only)', async () => {
    transcriptRepo.list.mockResolvedValue({ transcripts: [], total: 0 });
    messageRepo.listByParentMessageId.mockResolvedValue([makeMessage({ fromName: 'Dan' })]);

    await service.recordFromChannelEvent(input);

    const payload = meetingRepo.upsertByChannelEventMessageId.mock.calls[0]?.[0];
    expect(payload?.hasTranscript).toBe(false);
    expect(payload?.transcriptId).toBeNull();
    expect(payload?.participantNames).toEqual(['Dan']);
  });

  it('selects the transcript nearest the meeting start for recurring meetings', async () => {
    transcriptRepo.list.mockResolvedValue({
      transcripts: [
        makeTranscript({ transcriptId: 't-far', transcriptCreatedDateTime: new Date('2026-07-08T10:45:00Z') }),
        makeTranscript({ transcriptId: 't-near', transcriptCreatedDateTime: new Date('2026-07-01T10:50:00Z') }),
      ],
      total: 2,
    });

    await service.recordFromChannelEvent(input);

    expect(meetingRepo.upsertByChannelEventMessageId.mock.calls[0]?.[0]?.transcriptId).toBe('t-near');
  });
});

describe('listMeetings', () => {
  it('passes the filter to the repository', async () => {
    const page = { meetings: [], total: 0 };
    meetingRepo.list.mockResolvedValue(page);
    const result = await service.listMeetings({ projectId: 'p1' });
    expect(meetingRepo.list).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(result).toBe(page);
  });
});

describe('getMeeting', () => {
  const meeting: IDomainTeamsMeeting = {
    id: 'meeting-db-1',
    channelEventMessageId: 'evt-1',
    callId: 'call-1',
    meetingId: 'meet-1',
    subject: 'Weekly Sync',
    startDateTime: new Date('2026-07-01T10:00:00Z'),
    teamId: 'team-A',
    channelId: 'chan-A',
    monitoredChannelDbId: 'mc-1',
    projectId: 'p1',
    transcriptId: 't1',
    participantNames: ['Alice', 'Bob'],
    participantCount: 2,
    messageCount: 1,
    documentCount: 1,
    hasTranscript: true,
    lastRecordedAt: new Date(),
    sentToAI: false,
    aiSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('rejects with 404 when the meeting is missing', async () => {
    meetingRepo.findById.mockResolvedValue(null);
    await expect(service.getMeeting('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('assembles conversation, pipeline-backed documents, and transcript', async () => {
    meetingRepo.findById.mockResolvedValue(meeting);
    messageRepo.listByParentMessageId.mockResolvedValue([
      makeMessage({ messageId: 'm1', fromName: 'Carol' }),
    ]);
    documentRepo.listByProjectAndParentMessageId.mockResolvedValue([makeDoc()]);
    transcriptRepo.findByTranscriptId.mockResolvedValue(makeTranscript());

    const detail = await service.getMeeting('meeting-db-1');

    expect(documentRepo.listByProjectAndParentMessageId).toHaveBeenCalledWith('p1', 'evt-1');
    expect(detail.conversation).toHaveLength(1);
    expect(detail.conversation[0]?.messageId).toBe('m1');

    // Document is the real pipeline record, annotated with who/when shared it.
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]).toMatchObject({
      documentId: 'doc-1',
      originalName: 'floor-plan.pdf',
      blobUrl: 'https://blob/floor-plan.pdf',
      source: 'teams',
      sharedByName: 'Carol',
    });

    expect(detail.transcript).toMatchObject({ transcriptId: 't1', text: 'Hello everyone. Hi Alice.' });
  });

  it('falls back to the raw shared attachment when no pipeline record exists yet', async () => {
    meetingRepo.findById.mockResolvedValue(meeting);
    messageRepo.listByParentMessageId.mockResolvedValue([
      makeMessage({ messageId: 'm1', fromName: 'Carol', attachments: [
        { id: 'a1', name: 'pending.pdf', contentType: 'reference', contentUrl: 'https://share/pending', downloaded: false },
      ] }),
    ]);
    documentRepo.listByProjectAndParentMessageId.mockResolvedValue([]);
    transcriptRepo.findByTranscriptId.mockResolvedValue(makeTranscript());

    const detail = await service.getMeeting('meeting-db-1');

    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]).toMatchObject({
      documentId: null,
      originalName: 'pending.pdf',
      contentUrl: 'https://share/pending',
      sharedByName: 'Carol',
    });
  });

  it('returns transcript:null when the meeting has no transcriptId', async () => {
    meetingRepo.findById.mockResolvedValue({ ...meeting, transcriptId: null });
    messageRepo.listByParentMessageId.mockResolvedValue([]);
    documentRepo.listByProjectAndParentMessageId.mockResolvedValue([]);

    const detail = await service.getMeeting('meeting-db-1');

    expect(detail.transcript).toBeNull();
    expect(transcriptRepo.findByTranscriptId).not.toHaveBeenCalled();
  });
});
