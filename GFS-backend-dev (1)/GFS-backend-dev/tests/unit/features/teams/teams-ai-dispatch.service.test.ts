import { TeamsAiDispatchService } from '@features/teams/teams-ai-dispatch.service';
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
import type { TeamsAiPayload } from '@features/teams/teams-ai.types';

const makeChannel = (o: Partial<IDomainMonitoredChannel> = {}): IDomainMonitoredChannel => ({
  id: 'mc-1',
  teamId: 'team-A',
  teamName: 'GFS',
  channelId: 'chan-A',
  channelName: '91 Luxic Area',
  projectIds: ['p1'],
  deltaLink: null,
  isActive: true,
  aiChatSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeMessage = (o: Partial<IDomainTeamsMessage> = {}): IDomainTeamsMessage => ({
  id: 'db-m1',
  messageId: 'm1',
  teamId: 'team-A',
  channelId: 'chan-A',
  parentMessageId: null,
  fromName: 'Pradeep',
  fromId: 'u-pradeep',
  contentText: 'please share staircase diagrams',
  contentHtml: null,
  webUrl: 'https://teams/msg/m1',
  createdDateTime: new Date('2026-07-07T18:20:00Z'),
  attachments: [],
  projectId: 'p1',
  linkMethod: 'CHANNEL_MAP',
  routedToPipeline: false,
  sentToAI: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeMeeting = (o: Partial<IDomainTeamsMeeting> = {}): IDomainTeamsMeeting => ({
  id: 'meeting-db-1',
  channelEventMessageId: 'evt-1',
  callId: null,
  meetingId: 'graph-meet-1',
  subject: 'discussion about glass strairs',
  startDateTime: new Date('2026-07-07T18:22:00Z'),
  teamId: 'team-A',
  channelId: 'chan-A',
  monitoredChannelDbId: 'mc-1',
  projectId: 'p1',
  transcriptId: 't1',
  participantNames: ['gfs2', 'pradeep'],
  participantCount: 2,
  messageCount: 1,
  documentCount: 1,
  hasTranscript: true,
  lastRecordedAt: new Date(),
  sentToAI: false,
  aiSummary: null,
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
  documentType: 'other',
  status: 'PROCESSED',
  originalName: 'query_form.pdf',
  mimeType: 'application/pdf',
  extension: '.pdf',
  storageKey: 'projects/p1/documents/query_form.pdf',
  blobUrl: 'https://blob/query_form.pdf',
  sha256: 'abc',
  byteSize: 1234,
  uploadedBy: 'u-gfs2',
  uploadedAt: new Date('2026-07-07T18:19:00Z'),
  updatedAt: new Date(),
  metadata: { source: 'teams', messageId: 'm1' },
  ...o,
});

let queue: { publish: jest.Mock; subscribe: jest.Mock; close: jest.Mock };
let blobStorage: { createSignedDownloadUrl: jest.Mock; put: jest.Mock; putStream: jest.Mock; delete: jest.Mock };
let documentRepo: {
  listByTeamsMessageIds: jest.Mock;
  listByProjectAndParentMessageId: jest.Mock;
  listByTeamsTranscriptId: jest.Mock;
};
let messageRepo: {
  listUnsentByChannelId: jest.Mock;
  listByParentMessageId: jest.Mock;
  markSentToAI: jest.Mock;
};
let meetingRepo: { listUnsentByChannelId: jest.Mock; markSentToAI: jest.Mock };
let aiJobRepo: { create: jest.Mock; markFailed: jest.Mock };

const build = (enabled = true): TeamsAiDispatchService =>
  new TeamsAiDispatchService(
    queue as unknown as IQueueAdapter<TeamsAiPayload>,
    blobStorage as unknown as BlobStorage,
    documentRepo as unknown as DocumentRepository,
    messageRepo as unknown as ITeamsMessageRepository,
    meetingRepo as unknown as ITeamsMeetingRepository,
    aiJobRepo as unknown as ITeamsAiJobRepository,
    enabled,
  );

beforeEach(() => {
  queue = { publish: jest.fn().mockResolvedValue(undefined), subscribe: jest.fn(), close: jest.fn() };
  blobStorage = {
    createSignedDownloadUrl: jest.fn().mockResolvedValue('https://sas-url?sig=x'),
    put: jest.fn(),
    putStream: jest.fn(),
    delete: jest.fn(),
  };
  documentRepo = {
    listByTeamsMessageIds: jest.fn().mockResolvedValue([]),
    listByProjectAndParentMessageId: jest.fn().mockResolvedValue([]),
    listByTeamsTranscriptId: jest.fn().mockResolvedValue([]),
  };
  messageRepo = {
    listUnsentByChannelId: jest.fn().mockResolvedValue([]),
    listByParentMessageId: jest.fn().mockResolvedValue([]),
    markSentToAI: jest.fn().mockResolvedValue(undefined),
  };
  meetingRepo = {
    listUnsentByChannelId: jest.fn().mockResolvedValue([]),
    markSentToAI: jest.fn().mockResolvedValue(undefined),
  };
  aiJobRepo = {
    create: jest.fn().mockResolvedValue({ id: 'job-1', correlationId: 'teamsAiJob:job-1' }),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
});

describe('TeamsAiDispatchService — dispatchProjectSync', () => {
  it('emits a unified payload with the chat batch + a fresh SAS doc, and marks messages sent', async () => {
    messageRepo.listUnsentByChannelId.mockResolvedValue([makeMessage()]);
    documentRepo.listByTeamsMessageIds.mockResolvedValue([makeDoc()]);

    await build().dispatchProjectSync(makeChannel());

    expect(aiJobRepo.create).toHaveBeenCalledTimes(1);
    expect(aiJobRepo.create.mock.calls[0][0]).toMatchObject({
      projectId: 'p1',
      channelId: 'chan-A',
      hasChat: true,
      meetingCount: 0,
      messageIds: ['m1'],
      documentIds: ['doc-1'],
    });

    expect(queue.publish).toHaveBeenCalledTimes(1);
    const [envelope, opts] = queue.publish.mock.calls[0];
    expect(envelope.jobType).toBe('TEAMS_PROPOSAL');
    expect(envelope.correlationId).toBe('teamsAiJob:job-1');
    expect(opts).toEqual({ deduplicationKey: 'teamsAiJob:job-1' });
    expect(envelope.payload.projectId).toBe('p1');
    expect(envelope.payload.team).toEqual({ id: 'team-A', name: 'GFS' });
    expect(envelope.payload.channel).toEqual({ id: 'chan-A', name: '91 Luxic Area' });
    expect(envelope.payload.chat.delta).toBe(true);
    expect(envelope.payload.chat.messages).toHaveLength(1);
    expect(envelope.payload.chat.messages[0]).toMatchObject({ messageId: 'm1', from: 'Pradeep', replyToId: null });
    expect(envelope.payload.chat.documents).toHaveLength(1);
    expect(envelope.payload.chat.documents[0]).toMatchObject({
      documentId: 'doc-1',
      role: 'shared-file',
      blobUrl: 'https://sas-url?sig=x',
      sharedBy: 'Pradeep',
    });
    expect(envelope.payload.meetings).toEqual([]);

    expect(messageRepo.markSentToAI).toHaveBeenCalledWith(['m1']);
  });

  it('bundles a meeting with its conversation, shared doc, and transcript (role=transcript)', async () => {
    meetingRepo.listUnsentByChannelId.mockResolvedValue([makeMeeting()]);
    messageRepo.listByParentMessageId.mockResolvedValue([
      makeMessage({ id: 'db-r1', messageId: 'r1', parentMessageId: 'evt-1', fromName: 'gfs2' }),
    ]);
    documentRepo.listByProjectAndParentMessageId.mockResolvedValue([
      makeDoc({ id: 'doc-shared', originalName: 'plan.pdf', metadata: { source: 'teams', messageId: 'r1', parentMessageId: 'evt-1' } }),
    ]);
    documentRepo.listByTeamsTranscriptId.mockResolvedValue([
      makeDoc({ id: 'doc-vtt', documentType: 'transcript', originalName: 'meeting-transcript.vtt', mimeType: 'text/vtt', metadata: { source: 'teams', transcriptId: 't1' } }),
    ]);

    await build().dispatchProjectSync(makeChannel());

    const envelope = queue.publish.mock.calls[0][0];
    expect(envelope.payload.meetings).toHaveLength(1);
    const meeting = envelope.payload.meetings[0];
    expect(meeting.meetingId).toBe('meeting-db-1'); // stable round-trip key = DB id
    expect(meeting.onlineMeetingId).toBe('graph-meet-1');
    expect(meeting.subject).toBe('discussion about glass strairs');
    expect(meeting.messages).toHaveLength(1);
    expect(meeting.documents).toHaveLength(2);
    const roles = meeting.documents.map((d: { role: string }) => d.role).sort();
    expect(roles).toEqual(['shared-file', 'transcript']);
    const transcript = meeting.documents.find((d: { role: string }) => d.role === 'transcript');
    expect(transcript.sharedBy).toBeNull();

    expect(meetingRepo.markSentToAI).toHaveBeenCalledWith('meeting-db-1');
    expect(messageRepo.markSentToAI).toHaveBeenCalledWith(['r1']);
  });

  it('skips entirely when there is no unsent chat and no unsent meetings', async () => {
    await build().dispatchProjectSync(makeChannel());
    expect(aiJobRepo.create).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('does nothing when disabled, even with unsent content', async () => {
    messageRepo.listUnsentByChannelId.mockResolvedValue([makeMessage()]);
    await build(false).dispatchProjectSync(makeChannel());
    expect(queue.publish).not.toHaveBeenCalled();
    expect(aiJobRepo.create).not.toHaveBeenCalled();
  });

  it('skips a channel not linked to any project', async () => {
    messageRepo.listUnsentByChannelId.mockResolvedValue([makeMessage()]);
    await build().dispatchProjectSync(makeChannel({ projectIds: [] }));
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('marks the job failed and does NOT flag messages sent when publish throws', async () => {
    messageRepo.listUnsentByChannelId.mockResolvedValue([makeMessage()]);
    queue.publish.mockRejectedValue(new Error('service bus down'));

    await build().dispatchProjectSync(makeChannel());

    expect(aiJobRepo.markFailed).toHaveBeenCalledWith('job-1', expect.stringContaining('service bus down'));
    expect(messageRepo.markSentToAI).not.toHaveBeenCalled();
  });

  it('excludes meeting-reply messages from the chat section (root messages only)', async () => {
    messageRepo.listUnsentByChannelId.mockResolvedValue([
      makeMessage({ id: 'db-root', messageId: 'root', parentMessageId: null }),
      makeMessage({ id: 'db-reply', messageId: 'reply', parentMessageId: 'evt-1' }),
    ]);

    await build().dispatchProjectSync(makeChannel());

    const envelope = queue.publish.mock.calls[0][0];
    expect(envelope.payload.chat.messages.map((m: { messageId: string }) => m.messageId)).toEqual(['root']);
  });
});
