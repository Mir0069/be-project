import { AppError } from '@shared/errors/app.error';
import { TeamsService } from '@features/teams/teams.service';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';
import type { TeamsTokenService } from '@features/teams/teams-token.service';
import type { TeamsAssociationService } from '@features/teams/teams-association.service';
import type { TeamsFilesService } from '@features/teams/teams-files.service';
import type { TeamsTranscriptsService } from '@features/teams/teams-transcripts.service';
import type { TeamsSubscriptionService } from '@features/teams/teams-subscription.service';
import type { TeamsCloudLinkService } from '@features/teams/teams-cloud-link.service';
import type { GraphChannelMessage } from '@features/teams/teams.types';
import type { ITeamsMonitoredChannelRepository, IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type { ITeamsMessageRepository } from '@repositories/interfaces/i-teams-message.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

const makeChannel = (overrides: Partial<IDomainMonitoredChannel> = {}): IDomainMonitoredChannel => ({
  id: 'ch-db-1',
  teamId: 'team-1',
  teamName: 'GFS Construction',
  channelId: 'channel-1',
  channelName: 'Project Alpha',
  projectIds: [],
  deltaLink: null,
  isActive: true,
  aiChatSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMessage = (overrides: Partial<GraphChannelMessage> = {}): GraphChannelMessage => ({
  id: 'msg-1',
  messageType: 'message',
  createdDateTime: '2026-05-01T10:00:00Z',
  from: { user: { id: 'u1', displayName: 'Jane' } },
  body: { contentType: 'html', content: '<p>Hello <b>world</b></p>' },
  attachments: [],
  ...overrides,
});

let graphClient: jest.Mocked<ITeamsGraphClient>;
let monitoredRepo: jest.Mocked<ITeamsMonitoredChannelRepository>;
let messageRepo: jest.Mocked<ITeamsMessageRepository>;
let projectRepo: jest.Mocked<IProjectRepository>;
let association: { resolveProject: jest.Mock };
let tokenService: { isConfigured: jest.Mock; getCachedToken: jest.Mock };
let filesService: {
  isEnabled: jest.Mock;
  ingestReferenceAttachment: jest.Mock;
  moveChannelDocuments: jest.Mock;
};
let transcriptsService: { discoverFromChannelEvent: jest.Mock; discoverFromMeetingReference: jest.Mock };
let subscriptionService: { ensureSubscription: jest.Mock; removeForChannel: jest.Mock };
let cloudLinkService: { ingestMessageLinks: jest.Mock };
let service: TeamsService;

beforeEach(() => {
  graphClient = {
    get: jest.fn().mockResolvedValue({ value: [] }), // default: backfill scan returns empty
    getAllPages: jest.fn().mockResolvedValue([]), // default: no replies / no pages

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
  monitoredRepo = {
    listActive: jest.fn(),
    findById: jest.fn(),
    findByChannel: jest.fn(),
    listByProjectId: jest.fn().mockResolvedValue([]),
    listByProjectIds: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    removeProjectLink: jest.fn(),
    updateDeltaLink: jest.fn(),
    setChatSummary: jest.fn(),
    deleteById: jest.fn(),
    deactivate: jest.fn(),
  };
  messageRepo = {
    // Return a realistic domain message so processMessageFiles can run on it.
    upsertByMessageId: jest.fn().mockImplementation(async (fields) => ({
      id: `db-${fields.messageId}`,
      routedToPipeline: false,
      sentToAI: false,
      ...fields,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findByMessageId: jest.fn(),
    listByParentMessageId: jest.fn().mockResolvedValue([]),
    listUnsentByChannelId: jest.fn().mockResolvedValue([]),
    markSentToAI: jest.fn(),
    list: jest.fn(),
    setProject: jest.fn(),
    markAttachmentsDownloaded: jest.fn(),
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
  tokenService = { isConfigured: jest.fn().mockReturnValue(true), getCachedToken: jest.fn().mockResolvedValue(null) };
  filesService = {
    isEnabled: jest.fn().mockReturnValue(true),
    ingestReferenceAttachment: jest.fn().mockResolvedValue(true),
    moveChannelDocuments: jest.fn().mockResolvedValue(0),
  };
  transcriptsService = {
    discoverFromChannelEvent: jest.fn().mockResolvedValue(undefined),
    discoverFromMeetingReference: jest.fn().mockResolvedValue(undefined),
  };
  subscriptionService = {
    ensureSubscription: jest.fn().mockResolvedValue(undefined),
    removeForChannel: jest.fn().mockResolvedValue(undefined),
  };
  cloudLinkService = {
    ingestMessageLinks: jest.fn().mockResolvedValue(0),
  };

  service = new TeamsService(
    graphClient,
    tokenService as unknown as TeamsTokenService,
    monitoredRepo,
    messageRepo,
    association as unknown as TeamsAssociationService,
    projectRepo,
    filesService as unknown as TeamsFilesService,
    transcriptsService as unknown as TeamsTranscriptsService,
    subscriptionService as unknown as TeamsSubscriptionService,
    undefined,
    cloudLinkService as unknown as TeamsCloudLinkService,
  );
});

describe('TeamsService — syncChannel', () => {
  it('ingests normal messages, skips system/deleted ones, strips HTML, and advances the deltaLink', async () => {
    graphClient.getDelta.mockResolvedValue({
      items: [
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'msg-sys', messageType: 'systemEventMessage' }),
        makeMessage({ id: 'msg-del', deletedDateTime: '2026-05-02T00:00:00Z' }),
      ],
      deltaLink: 'https://graph.microsoft.com/delta-next',
    });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    const result = await service.syncChannel(makeChannel());

    expect(result.ingested).toBe(1);
    expect(messageRepo.upsertByMessageId).toHaveBeenCalledTimes(1);
    const upserted = messageRepo.upsertByMessageId.mock.calls[0]?.[0];
    expect(upserted?.messageId).toBe('msg-1');
    expect(upserted?.contentText).toBe('Hello world'); // HTML stripped
    expect(upserted?.contentHtml).toBe('<p>Hello <b>world</b></p>');
    expect(upserted?.projectId).toBe('p1');
    expect(upserted?.linkMethod).toBe('AUTO');
    expect(monitoredRepo.updateDeltaLink).toHaveBeenCalledWith('ch-db-1', 'https://graph.microsoft.com/delta-next');
  });

  it('preserves an existing MANUAL link instead of re-resolving', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [makeMessage({ id: 'msg-1' })], deltaLink: null });
    messageRepo.findByMessageId.mockResolvedValue({
      id: 'x', messageId: 'msg-1', teamId: 'team-1', channelId: 'channel-1',
      contentText: 'prev', createdDateTime: new Date(), attachments: [],
      projectId: 'manual-project', linkMethod: 'MANUAL', routedToPipeline: false, sentToAI: false,
      createdAt: new Date(), updatedAt: new Date(),
    });

    await service.syncChannel(makeChannel());

    expect(association.resolveProject).not.toHaveBeenCalled();
    const upserted = messageRepo.upsertByMessageId.mock.calls[0]?.[0];
    expect(upserted?.projectId).toBe('manual-project');
    expect(upserted?.linkMethod).toBe('MANUAL');
  });

  it('treats an empty channel as no messages instead of a sync error', async () => {
    // Graph 400s the first delta call on a channel nobody has posted in yet.
    // Every freshly provisioned channel hits this on every poll.
    graphClient.getDelta.mockRejectedValue(
      new AppError('Microsoft Graph request failed', 400, true, {
        details: { error: { code: 'BadRequest', message: "Parameter 'DeltaToken' not supported for this request." } },
      }),
    );

    const result = await service.syncChannel(makeChannel({ deltaLink: null }));

    expect(result.ingested).toBe(0);
    expect(messageRepo.upsertByMessageId).not.toHaveBeenCalled();
  });

  it('still reports that error when it comes from a STORED cursor', async () => {
    // Against a cursor we already hold, the same response means something is
    // genuinely wrong and must not be silenced.
    graphClient.getDelta.mockRejectedValue(
      new AppError('Microsoft Graph request failed', 400, true, {
        details: { error: { message: "Parameter 'DeltaToken' not supported for this request." } },
      }),
    );

    await expect(
      service.syncChannel(makeChannel({ deltaLink: 'https://graph.microsoft.com/delta?token=abc' })),
    ).rejects.toThrow('Microsoft Graph request failed');
  });

  it('still reports unrelated Graph failures', async () => {
    graphClient.getDelta.mockRejectedValue(
      new AppError('Microsoft Graph request failed', 403, true, {
        details: { error: { code: 'accessDenied' } },
      }),
    );

    await expect(service.syncChannel(makeChannel({ deltaLink: null }))).rejects.toThrow(
      'Microsoft Graph request failed',
    );
  });

  it('starts from the stored deltaLink when present', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: null });

    await service.syncChannel(makeChannel({ deltaLink: 'https://graph.microsoft.com/saved-delta' }));

    expect(graphClient.getDelta).toHaveBeenCalledWith('https://graph.microsoft.com/saved-delta');
  });

  it('routes meeting-event messages to transcriptsService.discoverFromChannelEvent (and does not ingest them)', async () => {
    const channel = makeChannel({ projectIds: ['p1'] });
    const eventMsg: GraphChannelMessage = {
      id: 'evt-1',
      messageType: 'systemEventMessage',
      createdDateTime: '2026-05-01T10:00:00Z',
      eventDetail: {
        '@odata.type': '#microsoft.graph.callStartedEventMessageDetail',
        callId: 'call-abc',
        meetingOrganizer: { user: { id: 'organizer-1', displayName: 'PM' } },
      },
    };
    graphClient.getDelta.mockResolvedValue({
      items: [makeMessage({ id: 'msg-1' }), eventMsg],
      deltaLink: null,
    });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    const result = await service.syncChannel(channel);

    expect(transcriptsService.discoverFromChannelEvent).toHaveBeenCalledTimes(1);
    expect(transcriptsService.discoverFromChannelEvent).toHaveBeenCalledWith(channel, eventMsg);
    // Only the content message was ingested.
    expect(result.ingested).toBe(1);
    expect(messageRepo.upsertByMessageId).toHaveBeenCalledTimes(1);
  });

  it('routes a scheduled-meeting message (meetingReference) to discoverFromMeetingReference, not the chat', async () => {
    const channel = makeChannel({ projectIds: ['p1'] });
    const scheduledMsg = makeMessage({
      id: 'sched-1',
      attachments: [
        {
          id: 'att-1',
          contentType: 'meetingReference',
          name: 'decideing glass panel',
          content: JSON.stringify({ organizerId: 'org-guid', meetingJoinUrl: 'https://join' }),
        },
      ],
    });
    graphClient.getDelta.mockResolvedValue({
      items: [makeMessage({ id: 'msg-1' }), scheduledMsg],
      deltaLink: null,
    });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    const result = await service.syncChannel(channel);

    expect(transcriptsService.discoverFromMeetingReference).toHaveBeenCalledWith(channel, scheduledMsg);
    // The scheduled-meeting message is NOT ingested as a chat message.
    expect(result.ingested).toBe(1);
    expect(messageRepo.upsertByMessageId).toHaveBeenCalledTimes(1);
  });

  it('runs the 6h backfill scan after delta, routing any event messages it returns', async () => {
    const channel = makeChannel();
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: null });
    // Within the 6h backfill window — should be routed.
    const fresh: GraphChannelMessage = {
      id: 'evt-backfill',
      messageType: 'unknownFutureValue',
      createdDateTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      eventDetail: {
        '@odata.type': '#microsoft.graph.callStartedEventMessageDetail',
        callId: 'call-late',
        initiator: { user: { id: 'organizer-2' } },
      },
    };
    // Older than the 6h window — should be filtered out.
    const stale: GraphChannelMessage = {
      id: 'evt-old',
      messageType: 'unknownFutureValue',
      createdDateTime: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
      eventDetail: {
        '@odata.type': '#microsoft.graph.callStartedEventMessageDetail',
        callId: 'call-ancient',
        initiator: { user: { id: 'organizer-2' } },
      },
    };
    graphClient.get.mockResolvedValue({
      value: [
        fresh,
        stale,
        makeMessage({ id: 'unrelated-msg' }), // backfill should ignore non-events
      ],
    });

    await service.syncChannel(channel);

    // Backfill uses $top (Graph /messages does NOT support $filter).
    expect(graphClient.get).toHaveBeenCalledWith(
      `/teams/${channel.teamId}/channels/${channel.channelId}/messages`,
      expect.objectContaining({ $top: expect.any(String) }),
    );
    // Only the fresh event is routed; the stale one is filtered client-side.
    expect(transcriptsService.discoverFromChannelEvent).toHaveBeenCalledTimes(1);
    expect(transcriptsService.discoverFromChannelEvent).toHaveBeenCalledWith(channel, fresh);
  });

  it('does not abort sync when the backfill scan itself throws', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: 'd-next' });
    graphClient.get.mockRejectedValue(new Error('backfill graph 500'));

    const result = await service.syncChannel(makeChannel());

    expect(result.channelId).toBe('channel-1');
    // delta cursor still advances even though backfill failed
    expect(monitoredRepo.updateDeltaLink).toHaveBeenCalledWith('ch-db-1', 'd-next');
  });
});

describe('TeamsService — syncAll', () => {
  it('isolates per-channel failures', async () => {
    monitoredRepo.listActive.mockResolvedValue([
      makeChannel({ id: 'ch-1', channelId: 'c1' }),
      makeChannel({ id: 'ch-2', channelId: 'c2' }),
    ]);
    graphClient.getDelta
      .mockResolvedValueOnce({ items: [], deltaLink: null })
      .mockRejectedValueOnce(new Error('graph boom'));

    const summary = await service.syncAll();

    expect(summary.channels).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.channelId).toBe('c2');
  });
});

describe('TeamsService — addMonitoredChannel', () => {
  const input = {
    teamId: 'team-1', teamName: 'GFS', channelId: 'channel-1', channelName: 'Project Alpha',
  };

  it('rejects (409) when the same project is already linked to this channel', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: true, projectIds: ['p1'] }),
    );

    await expect(
      service.addMonitoredChannel({ ...input, projectId: 'p1' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(monitoredRepo.upsert).not.toHaveBeenCalled();
  });

  it('rejects (409 alreadyLinked) when linked to another project without force', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: true, projectIds: ['other'] }),
    );
    projectRepo.findById.mockResolvedValue({
      id: 'other',
      referenceNumber: 'PRJ-1',
      projectName: 'Other',
    } as never);

    await expect(
      service.addMonitoredChannel({ ...input, projectId: 'p1' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { alreadyLinked: true },
    });
    expect(monitoredRepo.upsert).not.toHaveBeenCalled();
  });

  it('shares the channel (merged projectIds) when force is set', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ id: 'ch-db-1', isActive: true, projectIds: ['other'] }),
    );
    monitoredRepo.upsert.mockImplementation(async (f) => makeChannel({ projectIds: f.projectIds }));

    await service.addMonitoredChannel({ ...input, projectId: 'p1', force: true });

    const upserted = monitoredRepo.upsert.mock.calls[0]?.[0];
    expect(upserted?.projectIds).toEqual(['other', 'p1']);
  });

  it('rejects when the mapped project does not exist', async () => {
    projectRepo.findById.mockResolvedValue(null);

    await expect(
      service.addMonitoredChannel({ ...input, projectId: 'missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('upserts a new monitored channel and ensures a subscription (best-effort)', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(null);
    const channel = makeChannel();
    monitoredRepo.upsert.mockResolvedValue(channel);

    const result = await service.addMonitoredChannel(input);

    expect(result.channelId).toBe('channel-1');
    expect(monitoredRepo.upsert).toHaveBeenCalledTimes(1);
    expect(subscriptionService.ensureSubscription).toHaveBeenCalledWith(channel);
  });

  it('still returns the channel when ensureSubscription throws (best-effort)', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(null);
    monitoredRepo.upsert.mockResolvedValue(makeChannel());
    subscriptionService.ensureSubscription.mockRejectedValue(new Error('graph down'));

    const result = await service.addMonitoredChannel(input);

    expect(result.channelId).toBe('channel-1');
  });

  it('asks Teams membership to add the project people once a project is connected', async () => {
    const teamsMembership = { syncProject: jest.fn().mockResolvedValue(undefined) };
    const withMembership = new TeamsService(
      graphClient,
      tokenService as unknown as TeamsTokenService,
      monitoredRepo,
      messageRepo,
      association as unknown as TeamsAssociationService,
      projectRepo,
      filesService as unknown as TeamsFilesService,
      transcriptsService as unknown as TeamsTranscriptsService,
      subscriptionService as unknown as TeamsSubscriptionService,
      undefined,
      cloudLinkService as unknown as TeamsCloudLinkService,
      undefined,
      teamsMembership,
    );
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    monitoredRepo.findByChannel.mockResolvedValue(null);
    monitoredRepo.upsert.mockResolvedValue(makeChannel({ projectIds: ['p1'] }));
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: null });

    await withMembership.addMonitoredChannel(input);
    expect(teamsMembership.syncProject).not.toHaveBeenCalled();

    await withMembership.addMonitoredChannel({ ...input, projectId: 'p1' });
    expect(teamsMembership.syncProject).toHaveBeenCalledWith({ projectId: 'p1' });
  });
});

describe('TeamsService — reconnecting a disconnected channel', () => {
  const input = {
    teamId: 'team-1', teamName: 'GFS', channelId: 'channel-1', channelName: 'Project Alpha',
  };
  const STALE = 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/delta?$deltatoken=abc';
  const BASE = '/teams/team-1/channels/channel-1/messages/delta';

  beforeEach(() => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: null });
  });

  it('re-imports the whole channel instead of resuming from the stale cursor', async () => {
    // The row was soft-disconnected by an older build, so it still carries the
    // cursor from the last time it was watched.
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: false, projectIds: [], deltaLink: STALE }),
    );
    monitoredRepo.upsert.mockResolvedValue(makeChannel({ projectIds: ['p1'], deltaLink: STALE }));

    await service.addMonitoredChannel({ ...input, projectId: 'p1' });

    expect(monitoredRepo.updateDeltaLink).toHaveBeenCalledWith('ch-db-1', null);
    expect(graphClient.getDelta).toHaveBeenCalledWith(BASE);
  });

  it('moves the documents it already produced into the project it is reconnected to', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: false, projectIds: [], deltaLink: STALE }),
    );
    monitoredRepo.upsert.mockResolvedValue(makeChannel({ projectIds: ['p1'] }));

    await service.addMonitoredChannel({ ...input, projectId: 'p1' });

    expect(filesService.moveChannelDocuments).toHaveBeenCalledWith('channel-1', 'p1');
  });

  it('does not move anything when reconnected without a project', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: false, projectIds: [], deltaLink: STALE }),
    );
    monitoredRepo.upsert.mockResolvedValue(makeChannel());

    await service.addMonitoredChannel(input);

    expect(filesService.moveChannelDocuments).not.toHaveBeenCalled();
  });

  it('still connects when the relocation fails (best-effort)', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: false, projectIds: [], deltaLink: STALE }),
    );
    monitoredRepo.upsert.mockResolvedValue(makeChannel({ projectIds: ['p1'] }));
    filesService.moveChannelDocuments.mockRejectedValue(new Error('dropbox down'));

    const result = await service.addMonitoredChannel({ ...input, projectId: 'p1' });

    expect(result.channelId).toBe('channel-1');
  });

  it('re-imports the history for a project shared onto a live channel, without taking its documents', async () => {
    // "Connect anyway": the new project has never seen this conversation, so it
    // needs the full re-walk. The documents stay with the project the channel is
    // already serving.
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: true, projectIds: ['other'], deltaLink: STALE }),
    );
    monitoredRepo.upsert.mockResolvedValue(
      makeChannel({ projectIds: ['other', 'p1'], deltaLink: STALE }),
    );

    await service.addMonitoredChannel({ ...input, projectId: 'p1', force: true });

    expect(monitoredRepo.updateDeltaLink).toHaveBeenCalledWith('ch-db-1', null);
    expect(graphClient.getDelta).toHaveBeenCalledWith(BASE);
    expect(filesService.moveChannelDocuments).not.toHaveBeenCalled();
  });

  it('leaves the cursor alone when nothing new is being linked', async () => {
    // Re-running connect for a project already on the channel must not trigger a
    // pointless re-walk of the whole history.
    monitoredRepo.findByChannel.mockResolvedValue(
      makeChannel({ isActive: true, projectIds: ['p1', 'other'], deltaLink: STALE }),
    );
    monitoredRepo.upsert.mockResolvedValue(
      makeChannel({ projectIds: ['p1', 'other'], deltaLink: STALE }),
    );

    await service.addMonitoredChannel({ ...input, projectId: 'p1', force: true }).catch(() => {});

    expect(monitoredRepo.updateDeltaLink).not.toHaveBeenCalledWith('ch-db-1', null);
  });
});

describe('TeamsService — removeMonitoredChannel', () => {
  it('deactivates the channel (keeps the row + summary) and removes its subscription when it was the last link', async () => {
    monitoredRepo.findById.mockResolvedValue(makeChannel({ projectIds: ['p1'] }));

    await service.removeMonitoredChannel('ch-db-1', 'p1');

    expect(monitoredRepo.deactivate).toHaveBeenCalledWith('ch-db-1');
    expect(monitoredRepo.deleteById).not.toHaveBeenCalled();
    expect(subscriptionService.removeForChannel).toHaveBeenCalledWith('ch-db-1');
  });

  it('only unlinks this project when the shared channel has other projects', async () => {
    monitoredRepo.findById.mockResolvedValue(makeChannel({ projectIds: ['p1', 'p2'] }));

    await service.removeMonitoredChannel('ch-db-1', 'p1');

    expect(monitoredRepo.removeProjectLink).toHaveBeenCalledWith('ch-db-1', 'p1');
    expect(monitoredRepo.deactivate).not.toHaveBeenCalled();
    expect(subscriptionService.removeForChannel).not.toHaveBeenCalled();
  });

  it('throws 404 when the channel is not found', async () => {
    monitoredRepo.findById.mockResolvedValue(null);
    await expect(service.removeMonitoredChannel('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(subscriptionService.removeForChannel).not.toHaveBeenCalled();
  });
});

describe('TeamsService — linkMessage', () => {
  it('throws 404 when the project is missing', async () => {
    projectRepo.findById.mockResolvedValue(null);
    await expect(service.linkMessage('msg-1', 'p-missing')).rejects.toBeInstanceOf(AppError);
  });

  it('throws 404 when the message is missing', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    messageRepo.setProject.mockResolvedValue(null);
    await expect(service.linkMessage('msg-missing', 'p1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sets a MANUAL link on success', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    messageRepo.setProject.mockResolvedValue({ id: 'x', messageId: 'msg-1' } as never);

    await service.linkMessage('msg-1', 'p1');

    expect(messageRepo.setProject).toHaveBeenCalledWith('msg-1', 'p1', 'MANUAL');
  });
});

describe('TeamsService — getStatus', () => {
  it('reports configured state and monitored channel count', async () => {
    monitoredRepo.listActive.mockResolvedValue([makeChannel(), makeChannel({ id: 'ch-2' })]);

    const status = await service.getStatus();

    expect(status.configured).toBe(true);
    expect(status.monitoredChannelCount).toBe(2);
    expect(status.cachedTokenExpiresAt).toBeNull();
  });
});

describe('TeamsService — file ingestion (#3)', () => {
  const fileMsg = makeMessage({
    id: 'msg-file',
    attachments: [
      { id: 'att1', contentType: 'reference', contentUrl: 'https://x/plan.pdf', name: 'plan.pdf' },
    ],
  });

  it('routes reference attachments when the message has a project', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [fileMsg], deltaLink: null });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    await service.syncChannel(makeChannel());

    expect(filesService.ingestReferenceAttachment).toHaveBeenCalledTimes(1);
    const arg = filesService.ingestReferenceAttachment.mock.calls[0]?.[0];
    expect(arg.projectId).toBe('p1');
    expect(arg.contentUrl).toBe('https://x/plan.pdf');
    expect(messageRepo.markAttachmentsDownloaded).toHaveBeenCalledWith('msg-file', ['att1']);
  });

  it('does NOT route files when the message has no project', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [fileMsg], deltaLink: null });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: null, linkMethod: null });

    await service.syncChannel(makeChannel());

    expect(filesService.ingestReferenceAttachment).not.toHaveBeenCalled();
    expect(messageRepo.markAttachmentsDownloaded).not.toHaveBeenCalled();
  });

  it('does NOT re-download an attachment already marked downloaded', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [fileMsg], deltaLink: null });
    messageRepo.findByMessageId.mockResolvedValue({
      id: 'db-msg-file',
      messageId: 'msg-file',
      teamId: 'team-1',
      channelId: 'channel-1',
      contentText: '',
      createdDateTime: new Date(),
      attachments: [
        {
          id: 'att1',
          contentType: 'reference',
          contentUrl: 'https://x/plan.pdf',
          name: 'plan.pdf',
          downloaded: true,
        },
      ],
      projectId: 'p1',
      linkMethod: 'AUTO',
      routedToPipeline: false,
      sentToAI: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    await service.syncChannel(makeChannel());

    expect(filesService.ingestReferenceAttachment).not.toHaveBeenCalled();
  });
});

describe('TeamsService — message ingestion (chat bodies are NOT ingested)', () => {
  it('stores a project-linked message but never routes its body to document ingestion', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [makeMessage({ id: 'msg-1' })], deltaLink: null });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    const result = await service.syncChannel(makeChannel());

    // The message is stored for the Conversation view...
    expect(messageRepo.upsertByMessageId).toHaveBeenCalled();
    expect(result.ingested).toBe(1);
    // ...but its text is never turned into a document.
    expect(messageRepo.markRoutedToPipeline).not.toHaveBeenCalled();
  });

  it('scans the stored message for cloud links (Dropbox) after file processing', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [makeMessage({ id: 'msg-1' })], deltaLink: null });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    await service.syncChannel(makeChannel());

    expect(cloudLinkService.ingestMessageLinks).toHaveBeenCalledTimes(1);
    const arg = cloudLinkService.ingestMessageLinks.mock.calls[0]?.[0];
    expect(arg.messageId).toBe('msg-1');
    expect(arg.projectId).toBe('p1');
  });

  it('does not abort sync when cloud-link ingestion throws (best-effort)', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [makeMessage({ id: 'msg-1' })], deltaLink: 'd-next' });
    messageRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });
    cloudLinkService.ingestMessageLinks.mockRejectedValue(new Error('dropbox boom'));

    const result = await service.syncChannel(makeChannel());

    expect(result.ingested).toBe(1);
    expect(monitoredRepo.updateDeltaLink).toHaveBeenCalledWith('ch-db-1', 'd-next');
  });
});
