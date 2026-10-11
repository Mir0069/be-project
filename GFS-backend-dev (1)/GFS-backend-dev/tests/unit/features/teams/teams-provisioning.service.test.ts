import { AppError } from '@shared/errors/app.error';
import { ProjectCreationSource } from '@db/models/project.model';
import {
  TeamsProvisioningService,
  type IProvisionProjectReader,
  type ITeamsWorkspaceNotifier,
  type TeamsProvisioningConfig,
} from '@features/teams/teams-provisioning.service';
import type { IProjectTeamsDiscovery } from '@features/teams/teams-provision.types';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';
import type {
  ITeamsMonitoredChannelRepository,
  IDomainMonitoredChannel,
} from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  ITeamsProvisionJob,
  ITeamsProvisionOutboxRepository,
} from '@repositories/interfaces/i-teams-provision-outbox.repository';

const makeJob = (overrides: Partial<ITeamsProvisionJob> = {}): ITeamsProvisionJob => ({
  id: 'job-1',
  projectId: 'p1',
  projectName: '182 Robinson St',
  teamName: 'GFS - 182 Robinson St',
  channelName: '182 Robinson St discussion',
  status: 'PENDING',
  attempts: 0,
  lastError: null,
  teamId: null,
  operationId: null,
  channelId: null,
  mode: null,
  candidates: [],
  discoveredAt: null,
  discoveryError: null,
  decision: null,
  decidedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeChannel = (overrides: Partial<IDomainMonitoredChannel> = {}): IDomainMonitoredChannel => ({
  id: 'ch-1',
  teamId: 'team-1',
  teamName: 'GFS - 182 Robinson St',
  channelId: 'chan-1',
  channelName: '182 Robinson St discussion',
  projectIds: ['p1'],
  deltaLink: null,
  isActive: true,
  aiChatSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeProject = (source: ProjectCreationSource, projectName = '182 Robinson St') => ({
  projectName,
  jobAddress: null as string | null,
  creationSource: source,
});

// Team creation returns the ids only in headers.
const CREATE_HEADERS = {
  'content-location': "/teams('team-1')",
  location: "/teams('team-1')/operations('op-1')",
};

let graphClient: jest.Mocked<ITeamsGraphClient>;
let monitoredRepo: jest.Mocked<ITeamsMonitoredChannelRepository>;
let outboxRepo: jest.Mocked<ITeamsProvisionOutboxRepository>;
let projectRepo: jest.Mocked<IProvisionProjectReader>;
let discovery: jest.Mocked<IProjectTeamsDiscovery>;
let notifier: jest.Mocked<ITeamsWorkspaceNotifier>;
let config: TeamsProvisioningConfig;
let service: TeamsProvisioningService;

const buildService = (withDiscovery = true): TeamsProvisioningService =>
  new TeamsProvisioningService(
    graphClient,
    monitoredRepo,
    outboxRepo,
    projectRepo,
    config,
    notifier,
    withDiscovery ? discovery : undefined,
  );

beforeEach(() => {
  graphClient = {
    get: jest.fn().mockImplementation((path: string) => {
      if (path.includes('/operations/')) return Promise.resolve({ status: 'succeeded' });
      if (path.includes('/primaryChannel')) return Promise.resolve({ id: 'chan-1', displayName: 'x' });
      return Promise.resolve({});
    }),
    getAllPages: jest.fn(),
    getDelta: jest.fn(),
    getBinary: jest.fn(),
    getAllTranscriptsByOrganizer: jest.fn(),
    getOnlineMeetingIdByJoinUrl: jest.fn(),
    resolveUserId: jest.fn((id: string) => Promise.resolve(id)),
    createSubscription: jest.fn(),
    renewSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
    listSubscriptions: jest.fn(),
    post: jest.fn().mockResolvedValue({ status: 202, data: {}, headers: CREATE_HEADERS }),
    patch: jest.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
    delete: jest.fn(),
  } as unknown as jest.Mocked<ITeamsGraphClient>;

  monitoredRepo = {
    listActive: jest.fn(),
    findById: jest.fn(),
    findByChannel: jest.fn(),
    listByProjectId: jest.fn().mockResolvedValue([]),
    listByProjectIds: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(makeChannel()),
    removeProjectLink: jest.fn(),
    updateDeltaLink: jest.fn(),
    setChatSummary: jest.fn(),
    deleteById: jest.fn(),
    deactivate: jest.fn(),
  } as unknown as jest.Mocked<ITeamsMonitoredChannelRepository>;

  outboxRepo = {
    enqueue: jest.fn().mockResolvedValue(makeJob()),
    listRunnable: jest.fn().mockResolvedValue([]),
    listAwaitingDecision: jest.fn().mockResolvedValue([]),
    findByProjectId: jest.fn(),
    update: jest.fn().mockResolvedValue(null),
    updateIfStatus: jest.fn().mockResolvedValue(null),
  };

  projectRepo = {
    findById: jest.fn().mockResolvedValue(makeProject(ProjectCreationSource.MAIL_FIRST)),
  };

  discovery = { findCandidates: jest.fn().mockResolvedValue([]) };

  notifier = {
    notifyTeamsWorkspaceCreated: jest.fn().mockResolvedValue(undefined),
    notifyTeamsWorkspaceNeedsDecision: jest.fn().mockResolvedValue(undefined),
  };

  config = {
    autoProvisionEnabled: true,
    ownerGuid: 'owner-guid',
    ownerUpn: '',
    graphBaseUrl: 'https://graph.microsoft.com/v1.0',
  };

  service = buildService();
});

describe('provisionForProject (enqueue + kick)', () => {
  it('enqueues a job with the derived team/channel names', async () => {
    await service.provisionForProject({ projectId: 'p1', projectName: '182 Robinson St' });
    expect(outboxRepo.enqueue).toHaveBeenCalledWith({
      projectId: 'p1',
      projectName: '182 Robinson St',
      teamName: 'GFS - 182 Robinson St',
      channelName: '182 Robinson St discussion',
    });
  });

  it('does nothing when auto-provision is disabled', async () => {
    config.autoProvisionEnabled = false;
    service = buildService();
    await service.provisionForProject({ projectId: 'p1', projectName: 'X' });
    expect(outboxRepo.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing (and does not throw) when no owner is configured', async () => {
    config.ownerGuid = '';
    config.ownerUpn = '';
    service = buildService();
    await service.provisionForProject({ projectId: 'p1', projectName: 'X' });
    expect(outboxRepo.enqueue).not.toHaveBeenCalled();
  });
});

describe('drainPending — mail-first creates immediately', () => {
  it('creates the team, waits, sets Threads, persists the channel and notifies', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);

    const result = await service.drainPending();

    expect(discovery.findCandidates).not.toHaveBeenCalled();
    expect(graphClient.post).toHaveBeenCalledWith(
      '/teams',
      expect.objectContaining({
        displayName: 'GFS - 182 Robinson St',
        visibility: 'private',
        firstChannelName: '182 Robinson St discussion',
        members: expect.arrayContaining([expect.objectContaining({ roles: ['owner'] })]),
      }),
    );
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'CREATING', mode: 'CREATE' });
    expect(graphClient.patch).toHaveBeenCalledWith(
      expect.stringContaining('/teams/team-1/channels/chan-1'),
      { layoutType: 'chat' },
    );
    expect(monitoredRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-1', channelId: 'chan-1', projectIds: ['p1'] }),
    );
    expect(notifier.notifyTeamsWorkspaceCreated).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', teamName: 'GFS - 182 Robinson St' }),
    );
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'DONE', lastError: null });
    expect(result).toEqual({ processed: 1, provisioned: 1, parked: 0, failed: 0 });
  });

  it('asks Teams membership to add the project people once the new team is linked', async () => {
    const membership = { syncProject: jest.fn().mockResolvedValue(undefined) };
    const withMembership = new TeamsProvisioningService(
      graphClient,
      monitoredRepo,
      outboxRepo,
      projectRepo,
      config,
      notifier,
      discovery,
      membership,
    );
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);

    await withMembership.drainPending();

    expect(membership.syncProject).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(membership.syncProject.mock.invocationCallOrder[0]).toBeGreaterThan(
      monitoredRepo.upsert.mock.invocationCallOrder[0]!,
    );
  });

  it('names the team from the CURRENT project name, not the enqueued snapshot', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob({ projectName: 'Old Name', teamName: 'GFS - Old Name' })]);
    projectRepo.findById.mockResolvedValue(makeProject(ProjectCreationSource.MAIL_FIRST, '10208 Van Thompson Rd'));

    await service.drainPending();

    expect(graphClient.post).toHaveBeenCalledWith(
      '/teams',
      expect.objectContaining({
        displayName: 'GFS - 10208 Van Thompson Rd',
        firstChannelName: '10208 Van Thompson Rd discussion',
      }),
    );
    // The names actually used are persisted onto the job.
    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        teamName: 'GFS - 10208 Van Thompson Rd',
        channelName: '10208 Van Thompson Rd discussion',
        projectName: '10208 Van Thompson Rd',
      }),
    );
  });

  it('falls back to jobAddress when the project has no name', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);
    projectRepo.findById.mockResolvedValue({
      projectName: '   ',
      jobAddress: '7 Maple Ave',
      creationSource: ProjectCreationSource.MAIL_FIRST,
    });

    await service.drainPending();

    expect(graphClient.post).toHaveBeenCalledWith(
      '/teams',
      expect.objectContaining({ displayName: 'GFS - 7 Maple Ave' }),
    );
  });
});

describe('drainPending — Zoho-first parks for a human', () => {
  beforeEach(() => {
    projectRepo.findById.mockResolvedValue(makeProject(ProjectCreationSource.ZOHO_FIRST));
  });

  it('runs discovery and parks with the candidates, creating nothing', async () => {
    const candidates = [
      {
        teamId: 't1',
        teamName: 'GFS - 182 Robinson Street',
        channelId: 'c1',
        channelName: '182 Robinson St discussion',
        score: 0.95,
        reason: 'team-and-channel' as const,
      },
    ];
    discovery.findCandidates.mockResolvedValue(candidates);
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);

    const result = await service.drainPending();

    expect(discovery.findCandidates).toHaveBeenCalledWith('182 Robinson St');
    expect(graphClient.post).not.toHaveBeenCalled();
    expect(monitoredRepo.upsert).not.toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'AWAITING_DECISION', mode: 'DISCOVER', candidates }),
    );
    expect(notifier.notifyTeamsWorkspaceNeedsDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', candidateCount: 1 }),
    );
    expect(result).toEqual({ processed: 1, provisioned: 0, parked: 1, failed: 0 });
  });

  it('parks with an empty candidate list when nothing matches', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);

    await service.drainPending();

    expect(graphClient.post).not.toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'AWAITING_DECISION', candidates: [] }),
    );
  });

  it('parks rather than creating when no discovery service is wired', async () => {
    service = buildService(false);
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);

    await service.drainPending();

    expect(graphClient.post).not.toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'AWAITING_DECISION', candidates: [] }),
    );
  });

  it('retries a discovery failure, then parks it with the error', async () => {
    discovery.findCandidates.mockRejectedValue(new Error('graph throttled'));
    outboxRepo.listRunnable.mockResolvedValue([makeJob({ attempts: 0 })]);

    await service.drainPending();

    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { attempts: 1, lastError: 'graph throttled' });
    expect(outboxRepo.update).not.toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'AWAITING_DECISION' }),
    );

    outboxRepo.update.mockClear();
    outboxRepo.listRunnable.mockResolvedValue([makeJob({ attempts: 2 })]);

    await service.drainPending();

    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'AWAITING_DECISION', discoveryError: 'graph throttled' }),
    );
  });

  it('runs the create path once a human moved the job to CREATING', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob({ status: 'CREATING', mode: 'CREATE' })]);

    await service.drainPending();

    expect(discovery.findCandidates).not.toHaveBeenCalled();
    expect(graphClient.post).toHaveBeenCalledWith('/teams', expect.anything());
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'DONE', lastError: null });
  });
});

describe('drainPending — idempotency + resumability', () => {
  it('skips (marks DONE, no Graph calls) when the project already has a channel', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);
    monitoredRepo.listByProjectId.mockResolvedValue([makeChannel()]);

    await service.drainPending();

    expect(graphClient.post).not.toHaveBeenCalled();
    expect(monitoredRepo.upsert).not.toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'DONE', lastError: null });
  });

  it('fails permanently when the project row is gone', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);
    projectRepo.findById.mockResolvedValue(null);

    await service.drainPending();

    expect(graphClient.post).not.toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', {
      status: 'FAILED',
      lastError: 'Project not found',
    });
  });

  it('resumes without recreating the team when teamId is already checkpointed', async () => {
    outboxRepo.listRunnable.mockResolvedValue([
      makeJob({ status: 'CREATING', teamId: 'team-1', operationId: 'op-1' }),
    ]);

    await service.drainPending();

    expect(graphClient.post).not.toHaveBeenCalled(); // create skipped
    expect(graphClient.get).toHaveBeenCalledWith(expect.stringContaining('/operations/op-1'));
    expect(monitoredRepo.upsert).toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'DONE', lastError: null });
  });

  it('keeps the persisted names on resume even if the project was renamed', async () => {
    outboxRepo.listRunnable.mockResolvedValue([
      makeJob({ status: 'CREATING', teamId: 'team-1', operationId: 'op-1' }),
    ]);
    projectRepo.findById.mockResolvedValue(makeProject(ProjectCreationSource.MAIL_FIRST, 'Renamed Later'));

    await service.drainPending();

    expect(monitoredRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        teamName: 'GFS - 182 Robinson St',
        channelName: '182 Robinson St discussion',
      }),
    );
  });
});

describe('drainPending — sweep of parked jobs', () => {
  it('closes a parked job once its project has a channel', async () => {
    outboxRepo.listAwaitingDecision.mockResolvedValue([makeJob({ status: 'AWAITING_DECISION' })]);
    monitoredRepo.listByProjectIds.mockResolvedValue([makeChannel()]);

    await service.drainPending();

    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'DONE', lastError: null });
  });

  it('leaves a parked job alone while its project has no channel', async () => {
    outboxRepo.listAwaitingDecision.mockResolvedValue([makeJob({ status: 'AWAITING_DECISION' })]);
    monitoredRepo.listByProjectIds.mockResolvedValue([]);

    await service.drainPending();

    expect(outboxRepo.update).not.toHaveBeenCalled();
  });
});

describe('drainPending — resilience', () => {
  it('tolerates a 403 on the Threads PATCH (still persists + marks DONE)', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);
    graphClient.patch.mockRejectedValue(new AppError('forbidden', 403));

    await service.drainPending();

    expect(monitoredRepo.upsert).toHaveBeenCalled();
    expect(outboxRepo.update).toHaveBeenCalledWith('job-1', { status: 'DONE', lastError: null });
  });

  it('keeps the job runnable and increments attempts on a create failure', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob({ status: 'CREATING' })]);
    graphClient.post.mockRejectedValue(new AppError('graph down', 503));

    const result = await service.drainPending();

    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'CREATING', attempts: 1 }),
    );
    expect(result.failed).toBe(0);
  });

  it('parks the job as FAILED after the max attempts', async () => {
    outboxRepo.listRunnable.mockResolvedValue([makeJob({ status: 'CREATING', attempts: 4 })]);
    graphClient.post.mockRejectedValue(new AppError('graph down', 503));

    const result = await service.drainPending();

    expect(outboxRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'FAILED', attempts: 5 }),
    );
    expect(result.failed).toBe(1);
  });

  it('is a no-op when auto-provision is disabled', async () => {
    config.autoProvisionEnabled = false;
    service = buildService();
    outboxRepo.listRunnable.mockResolvedValue([makeJob()]);

    await service.drainPending();

    expect(outboxRepo.listRunnable).not.toHaveBeenCalled();
    expect(graphClient.post).not.toHaveBeenCalled();
  });
});
