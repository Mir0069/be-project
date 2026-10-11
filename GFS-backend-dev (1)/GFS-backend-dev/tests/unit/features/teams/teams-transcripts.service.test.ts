import { AppError } from '@shared/errors/app.error';
import {
  TeamsTranscriptsService,
  vttToText,
} from '@features/teams/teams-transcripts.service';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';
import type { IDocumentIngestionPort } from '@features/teams/document-ingestion.port';
import type { TeamsAssociationService } from '@features/teams/teams-association.service';
import type { TeamsMeetingsService } from '@features/teams/teams-meetings.service';
import type {
  GraphChannelMessage,
  GraphList,
  GraphOnlineMeeting,
  GraphCallTranscript,
} from '@features/teams/teams.types';
import type {
  ITeamsTranscriptRepository,
  IDomainTeamsTranscript,
} from '@repositories/interfaces/i-teams-transcript.repository';
import type { IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

const SAMPLE_VTT = `WEBVTT

00:00:00.000 --> 00:00:03.000
<v Alice>Good morning, this is about Project Alpha drawings.

00:00:03.500 --> 00:00:06.000
<v Bob>Yes, I'll send the spec update.
`;

let graph: jest.Mocked<ITeamsGraphClient>;
let repo: jest.Mocked<ITeamsTranscriptRepository>;
let projectRepo: jest.Mocked<IProjectRepository>;
let association: { resolveProject: jest.Mock };
let port: { upload: jest.Mock };
let meetingsService: { recordFromChannelEvent: jest.Mock };
let service: TeamsTranscriptsService;

const makeStored = (overrides: Partial<IDomainTeamsTranscript> = {}): IDomainTeamsTranscript => ({
  id: 'db-1',
  transcriptId: 't1',
  meetingId: 'm1',
  userId: 'u1',
  meetingSubject: 'Project Sync',
  meetingJoinUrl: null,
  contentVtt: SAMPLE_VTT,
  contentText: 'Good morning, this is about Project Alpha drawings. Yes, I\'ll send the spec update.',
  byteSize: SAMPLE_VTT.length,
  transcriptCreatedDateTime: null,
  projectId: null,
  linkMethod: null,
  routedToPipeline: false,
  fetchedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  graph = {
    get: jest.fn(),
    getAllPages: jest.fn(),
    getDelta: jest.fn(),
    getBinary: jest.fn(),
    getAllTranscriptsByOrganizer: jest.fn(),
    getOnlineMeetingIdByJoinUrl: jest.fn(),
    resolveUserId: jest.fn((id: string) => Promise.resolve(id)),
    createSubscription: jest.fn(),
    renewSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
    listSubscriptions: jest.fn().mockResolvedValue([]),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  repo = {
    upsertByTranscriptId: jest.fn(),
    findByTranscriptId: jest.fn(),
    list: jest.fn(),
    setProject: jest.fn(),
    markRoutedToPipeline: jest.fn(),
  };
  projectRepo = {
    findById: jest.fn(),
    findByReferenceNumber: jest.fn(),
    findByZohoLeadId: jest.fn(),
    listActive: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  };
  association = { resolveProject: jest.fn().mockResolvedValue({ projectId: null, linkMethod: null }) };
  port = { upload: jest.fn().mockResolvedValue(undefined) };
  meetingsService = { recordFromChannelEvent: jest.fn().mockResolvedValue(undefined) };

  service = new TeamsTranscriptsService(
    graph,
    repo,
    projectRepo,
    association as unknown as TeamsAssociationService,
    port as unknown as IDocumentIngestionPort,
    meetingsService as unknown as TeamsMeetingsService,
    true,
  );
});

describe('vttToText', () => {
  it('strips WEBVTT header, timing cues, and speaker tags', () => {
    const text = vttToText(SAMPLE_VTT);
    expect(text).toContain('Good morning');
    expect(text).toContain('Project Alpha');
    expect(text).toContain('spec update');
    expect(text).not.toContain('WEBVTT');
    expect(text).not.toContain('-->');
    expect(text).not.toContain('<v ');
  });

  it('returns empty string for empty input', () => {
    expect(vttToText('')).toBe('');
  });
});

describe('TeamsTranscriptsService — fetchAndStore', () => {
  const setupGraphFor = (transcripts: GraphCallTranscript[]) => {
    // Meeting metadata + transcript list + binary content for each
    graph.get.mockImplementation(async (path: string) => {
      if (path.endsWith(`/onlineMeetings/m1`)) {
        return { id: 'm1', subject: 'Project Sync' } as GraphOnlineMeeting as never;
      }
      if (path.endsWith(`/transcripts`)) {
        return { value: transcripts } as GraphList<GraphCallTranscript> as never;
      }
      return {} as never;
    });
    graph.getBinary.mockResolvedValue(Buffer.from(SAMPLE_VTT, 'utf8'));
  };

  it('fetches a transcript, stores it, auto-links by keyword, and routes to the pipeline', async () => {
    setupGraphFor([{ id: 't1', createdDateTime: '2026-05-28T10:00:00Z' }]);
    repo.findByTranscriptId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });
    repo.upsertByTranscriptId.mockImplementation(async (fields) =>
      makeStored({ ...fields, id: `db-${fields.transcriptId}` }),
    );

    const summary = await service.fetchAndStore({ userId: 'u1', meetingId: 'm1' });

    expect(summary.transcripts).toHaveLength(1);
    expect(summary.transcripts[0]?.projectId).toBe('p1');
    expect(summary.transcripts[0]?.linkMethod).toBe('AUTO');
    expect(summary.transcripts[0]?.routedToPipeline).toBe(true);

    // Upsert received parsed text + raw VTT
    const upserted = repo.upsertByTranscriptId.mock.calls[0]?.[0];
    expect(upserted?.contentText).toContain('Project Alpha');
    expect(upserted?.contentVtt).toContain('WEBVTT');
    expect(upserted?.projectId).toBe('p1');

    // Pipeline handoff: documentType:'transcript' as a real .vtt file carrying
    // the raw VTT (same artifact the Meetings view serves).
    expect(port.upload).toHaveBeenCalledTimes(1);
    const [ctx, input] = port.upload.mock.calls[0];
    expect(ctx).toEqual({ userId: 'u1' });
    expect(input.documentType).toBe('transcript');
    expect(input.file.mimeType).toBe('text/vtt');
    expect(input.file.originalName).toMatch(/\.vtt$/);
    expect(input.file.buffer.toString('utf8')).toContain('WEBVTT');
    expect(input.projectId).toBe('p1');
    expect(repo.markRoutedToPipeline).toHaveBeenCalledWith('t1');
  });

  it('uses an explicitly provided projectId (MANUAL) and skips association', async () => {
    setupGraphFor([{ id: 't1' }]);
    repo.findByTranscriptId.mockResolvedValue(null);
    projectRepo.findById.mockResolvedValue({ id: 'pX' } as never);
    repo.upsertByTranscriptId.mockImplementation(async (fields) => makeStored({ ...fields }));

    await service.fetchAndStore({ userId: 'u1', meetingId: 'm1', projectId: 'pX' });

    expect(association.resolveProject).not.toHaveBeenCalled();
    const upserted = repo.upsertByTranscriptId.mock.calls[0]?.[0];
    expect(upserted?.projectId).toBe('pX');
    expect(upserted?.linkMethod).toBe('MANUAL');
  });

  it('does NOT route to the pipeline when no project is resolved', async () => {
    setupGraphFor([{ id: 't1' }]);
    repo.findByTranscriptId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: null, linkMethod: null });
    repo.upsertByTranscriptId.mockImplementation(async (fields) => makeStored({ ...fields }));

    const summary = await service.fetchAndStore({ userId: 'u1', meetingId: 'm1' });

    expect(port.upload).not.toHaveBeenCalled();
    expect(repo.markRoutedToPipeline).not.toHaveBeenCalled();
    expect(summary.transcripts[0]?.routedToPipeline).toBe(false);
  });

  it('preserves an existing MANUAL link across re-fetch', async () => {
    setupGraphFor([{ id: 't1' }]);
    repo.findByTranscriptId.mockResolvedValue(makeStored({ projectId: 'pManual', linkMethod: 'MANUAL', routedToPipeline: true }));
    repo.upsertByTranscriptId.mockImplementation(async (fields) => makeStored({ ...fields }));

    await service.fetchAndStore({ userId: 'u1', meetingId: 'm1' });

    expect(association.resolveProject).not.toHaveBeenCalled();
    const upserted = repo.upsertByTranscriptId.mock.calls[0]?.[0];
    expect(upserted?.projectId).toBe('pManual');
    expect(upserted?.linkMethod).toBe('MANUAL');
    expect(port.upload).not.toHaveBeenCalled(); // already routed
  });

  it('rejects with 404 when an explicit projectId is not found', async () => {
    projectRepo.findById.mockResolvedValue(null);

    await expect(
      service.fetchAndStore({ userId: 'u1', meetingId: 'm1', projectId: 'missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('TeamsTranscriptsService — linkTranscript', () => {
  it('throws 404 when the project is missing', async () => {
    projectRepo.findById.mockResolvedValue(null);
    await expect(service.linkTranscript('t1', 'pMissing')).rejects.toBeInstanceOf(AppError);
  });

  it('throws 404 when the transcript is missing', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    repo.setProject.mockResolvedValue(null);
    await expect(service.linkTranscript('tMissing', 'p1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sets MANUAL link and routes to pipeline if not yet routed', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    repo.setProject.mockResolvedValue(makeStored({ projectId: 'p1', linkMethod: 'MANUAL', routedToPipeline: false }));

    await service.linkTranscript('t1', 'p1');

    expect(repo.setProject).toHaveBeenCalledWith('t1', 'p1', 'MANUAL');
    expect(port.upload).toHaveBeenCalledTimes(1);
    expect(repo.markRoutedToPipeline).toHaveBeenCalledWith('t1');
  });

  it('does not re-route to pipeline if already routed', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    repo.setProject.mockResolvedValue(makeStored({ projectId: 'p1', linkMethod: 'MANUAL', routedToPipeline: true }));

    await service.linkTranscript('t1', 'p1');

    expect(port.upload).not.toHaveBeenCalled();
  });
});

describe('TeamsTranscriptsService — discoverFromChannelEvent', () => {
  const channel: IDomainMonitoredChannel = {
    id: 'mc-1',
    teamId: 'team-A',
    teamName: 'GFS Construction',
    channelId: 'chan-A',
    channelName: 'Project Alpha',
    projectIds: ['project-alpha'],
    deltaLink: null,
    isActive: true,
    aiChatSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const setupGraphForMeeting = (meetingIdOnGraph: string, transcripts: GraphCallTranscript[]) => {
    graph.get.mockImplementation(async (path: string) => {
      if (path.endsWith(`/onlineMeetings/${meetingIdOnGraph}`)) {
        return { id: meetingIdOnGraph, subject: 'Channel Meeting' } as GraphOnlineMeeting as never;
      }
      if (path.endsWith(`/transcripts`)) {
        return { value: transcripts } as GraphList<GraphCallTranscript> as never;
      }
      return {} as never;
    });
    graph.getBinary.mockResolvedValue(Buffer.from(SAMPLE_VTT, 'utf8'));
  };

  it('with eventDetail.meetingId present: calls fetchAndStore with channelContext and stamps the transcript', async () => {
    const message: GraphChannelMessage = {
      id: 'evt-1',
      messageType: 'systemEventMessage',
      eventDetail: {
        meetingId: 'meet-direct',
        meetingOrganizer: { user: { id: 'organizer-1' } },
      },
    };
    setupGraphForMeeting('meet-direct', [{ id: 't-A' }]);
    repo.findByTranscriptId.mockResolvedValue(null);
    repo.upsertByTranscriptId.mockImplementation(async (fields) => makeStored({ ...fields }));

    await service.discoverFromChannelEvent(channel, message);

    // No callId resolution path
    expect(graph.getAllTranscriptsByOrganizer).not.toHaveBeenCalled();

    const upserted = repo.upsertByTranscriptId.mock.calls[0]?.[0];
    expect(upserted?.meetingId).toBe('meet-direct');
    expect(upserted?.userId).toBe('organizer-1');
    expect(upserted?.monitoredChannelDbId).toBe('mc-1');
    expect(upserted?.teamId).toBe('team-A');
    expect(upserted?.channelId).toBe('chan-A');
    expect(upserted?.discoveredVia).toBe('CHANNEL_EVENT');
    expect(upserted?.projectId).toBe('project-alpha'); // inherited from channel
    expect(upserted?.linkMethod).toBe('AUTO'); // CHANNEL_MAP collapsed to AUTO in the service

    // Records the meeting aggregate after storing the transcript.
    expect(meetingsService.recordFromChannelEvent).toHaveBeenCalledTimes(1);
    const recorded = meetingsService.recordFromChannelEvent.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({ channelEventMessageId: 'evt-1', meetingId: 'meet-direct' });
    expect(recorded.channelContext).toMatchObject({
      monitoredChannelDbId: 'mc-1',
      teamId: 'team-A',
      channelId: 'chan-A',
      projectId: 'project-alpha',
    });
  });

  it('without meetingId: resolves the channel meeting via the organizer calendar joinWebUrl', async () => {
    const channelMeetingId = '1*organizer-2*0**19:m-abc@thread.tacv2';
    const joinUrl = 'https://teams.microsoft.com/l/meetup-join/JOIN';
    const message: GraphChannelMessage = {
      id: 'evt-2',
      messageType: 'systemEventMessage',
      createdDateTime: '2026-05-29T16:00:00Z',
      eventDetail: {
        callId: 'call-xyz',
        initiator: { user: { id: 'organizer-2' } },
      },
    };
    graph.get.mockImplementation(async (path: string) => {
      if (path.includes('/calendarView')) {
        return {
          value: [
            {
              id: 'e1',
              subject: 'Channel Sync',
              isOnlineMeeting: true,
              onlineMeeting: { joinUrl },
              start: { dateTime: '2026-05-29T16:00:00Z' },
            },
          ],
        } as never;
      }
      if (path.endsWith(`/onlineMeetings/${channelMeetingId}`)) {
        return { id: channelMeetingId, subject: 'Channel Sync' } as never;
      }
      if (path.endsWith('/transcripts')) {
        return { value: [{ id: 't-cal-1' }] } as never;
      }
      return {} as never;
    });
    graph.getOnlineMeetingIdByJoinUrl.mockResolvedValue(channelMeetingId);
    graph.getBinary.mockResolvedValue(Buffer.from(SAMPLE_VTT, 'utf8'));
    repo.findByTranscriptId.mockResolvedValue(null);
    repo.upsertByTranscriptId.mockImplementation(async (fields) => makeStored({ ...fields }));

    await service.discoverFromChannelEvent(channel, message);

    expect(graph.getAllTranscriptsByOrganizer).not.toHaveBeenCalled();
    expect(graph.getOnlineMeetingIdByJoinUrl).toHaveBeenCalledWith('organizer-2', joinUrl);
    const upserted = repo.upsertByTranscriptId.mock.calls[0]?.[0];
    expect(upserted?.meetingId).toBe(channelMeetingId);
    expect(upserted?.userId).toBe('organizer-2');
    expect(upserted?.channelId).toBe('chan-A');

    expect(meetingsService.recordFromChannelEvent).toHaveBeenCalledTimes(1);
    expect(meetingsService.recordFromChannelEvent.mock.calls[0]?.[0]).toMatchObject({
      channelEventMessageId: 'evt-2',
      callId: 'call-xyz',
      meetingId: channelMeetingId,
    });
  });

  it('records the meeting even when the transcript list is empty', async () => {
    const message: GraphChannelMessage = {
      id: 'evt-empty',
      messageType: 'systemEventMessage',
      eventDetail: { meetingId: 'meet-empty', meetingOrganizer: { user: { id: 'org-e' } } },
    };
    setupGraphForMeeting('meet-empty', []); // no transcripts on the meeting

    await service.discoverFromChannelEvent(channel, message);

    expect(repo.upsertByTranscriptId).not.toHaveBeenCalled();
    expect(meetingsService.recordFromChannelEvent).toHaveBeenCalledTimes(1);
    expect(meetingsService.recordFromChannelEvent.mock.calls[0]?.[0]).toMatchObject({
      channelEventMessageId: 'evt-empty',
      meetingId: 'meet-empty',
    });
  });

  it('swallows a recordFromChannelEvent failure so the transcript is still stored', async () => {
    const message: GraphChannelMessage = {
      id: 'evt-rec-fail',
      messageType: 'systemEventMessage',
      eventDetail: { meetingId: 'meet-rec', meetingOrganizer: { user: { id: 'org-r' } } },
    };
    setupGraphForMeeting('meet-rec', [{ id: 't-rec' }]);
    repo.findByTranscriptId.mockResolvedValue(null);
    repo.upsertByTranscriptId.mockImplementation(async (fields) => makeStored({ ...fields }));
    meetingsService.recordFromChannelEvent.mockRejectedValue(new Error('record boom'));

    await expect(service.discoverFromChannelEvent(channel, message)).resolves.toBeUndefined();
    expect(repo.upsertByTranscriptId).toHaveBeenCalled();
  });

  it('without meetingId: skips when the calendar has no matching channel meeting', async () => {
    const message: GraphChannelMessage = {
      id: 'evt-2b',
      messageType: 'systemEventMessage',
      createdDateTime: '2026-05-29T16:00:00Z',
      eventDetail: { callId: 'call-none', initiator: { user: { id: 'organizer-2' } } },
    };
    graph.get.mockImplementation(async (path: string) => {
      if (path.includes('/calendarView')) return { value: [] } as never;
      return {} as never;
    });

    await service.discoverFromChannelEvent(channel, message);

    expect(repo.upsertByTranscriptId).not.toHaveBeenCalled();
  });

  it('skips silently (no throw, no fetch) when meetingOrganizer is missing', async () => {
    const message: GraphChannelMessage = {
      id: 'evt-3',
      messageType: 'systemEventMessage',
      eventDetail: { meetingId: 'meet-orphan' },
    };

    await expect(service.discoverFromChannelEvent(channel, message)).resolves.toBeUndefined();
    expect(graph.get).not.toHaveBeenCalled();
    expect(repo.upsertByTranscriptId).not.toHaveBeenCalled();
  });

  it('swallows fetchAndStore errors so one bad meeting cannot abort discovery', async () => {
    const message: GraphChannelMessage = {
      id: 'evt-4',
      messageType: 'systemEventMessage',
      eventDetail: {
        meetingId: 'meet-broken',
        meetingOrganizer: { user: { id: 'organizer-4' } },
      },
    };
    // Meeting fetch throws — discoverFromChannelEvent should log and return.
    graph.get.mockRejectedValue(new Error('graph 403 forbidden'));

    await expect(service.discoverFromChannelEvent(channel, message)).resolves.toBeUndefined();
    expect(repo.upsertByTranscriptId).not.toHaveBeenCalled();
  });

  it('returns immediately when eventDetail is absent', async () => {
    const message: GraphChannelMessage = { id: 'evt-5', messageType: 'systemEventMessage' };
    await service.discoverFromChannelEvent(channel, message);
    expect(graph.get).not.toHaveBeenCalled();
    expect(graph.getAllTranscriptsByOrganizer).not.toHaveBeenCalled();
  });
});
