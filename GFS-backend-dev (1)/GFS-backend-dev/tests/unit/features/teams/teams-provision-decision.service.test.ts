import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ProjectCreationSource } from '@db/models/project.model';
import {
  TeamsProvisionDecisionService,
  type IChannelConnector,
  type IProvisionDrainKicker,
  type ProvisionDecisionConfig,
} from '@features/teams/teams-provision-decision.service';
import type { IProvisionProjectReader } from '@features/teams/teams-provisioning.service';
import type {
  IDomainMonitoredChannel,
  ITeamsMonitoredChannelRepository,
} from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  ITeamsProvisionJob,
  ITeamsProvisionOutboxRepository,
} from '@repositories/interfaces/i-teams-provision-outbox.repository';

const CANDIDATE = {
  teamId: 't1',
  teamName: 'GFS - 182 Robinson Street',
  channelId: 'c1',
  channelName: '182 Robinson St discussion',
  score: 0.95,
  reason: 'team-and-channel',
};

const makeJob = (overrides: Partial<ITeamsProvisionJob> = {}): ITeamsProvisionJob => ({
  id: 'job-1',
  projectId: 'p1',
  projectName: '182 Robinson St',
  teamName: 'GFS - 182 Robinson St',
  channelName: '182 Robinson St discussion',
  status: 'AWAITING_DECISION',
  attempts: 0,
  lastError: null,
  teamId: null,
  operationId: null,
  channelId: null,
  mode: 'DISCOVER',
  candidates: [CANDIDATE],
  discoveredAt: new Date(),
  discoveryError: null,
  decision: null,
  decidedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeChannel = (overrides: Partial<IDomainMonitoredChannel> = {}): IDomainMonitoredChannel => ({
  id: 'ch-1',
  teamId: 't1',
  teamName: 'GFS - 182 Robinson Street',
  channelId: 'c1',
  channelName: '182 Robinson St discussion',
  projectIds: ['p1'],
  deltaLink: null,
  isActive: true,
  aiChatSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

let outboxRepo: jest.Mocked<ITeamsProvisionOutboxRepository>;
let connector: jest.Mocked<IChannelConnector>;
let kicker: jest.Mocked<IProvisionDrainKicker>;
let projectRepo: jest.Mocked<IProvisionProjectReader>;
let monitoredRepo: jest.Mocked<ITeamsMonitoredChannelRepository>;
let config: ProvisionDecisionConfig;
let service: TeamsProvisionDecisionService;

const build = (): TeamsProvisionDecisionService =>
  new TeamsProvisionDecisionService(outboxRepo, connector, kicker, projectRepo, monitoredRepo, config);

beforeEach(() => {
  outboxRepo = {
    enqueue: jest.fn(),
    listRunnable: jest.fn(),
    listAwaitingDecision: jest.fn(),
    findByProjectId: jest.fn().mockResolvedValue(makeJob()),
    update: jest.fn(),
    updateIfStatus: jest.fn().mockImplementation(async (_id, _expected, patch) => makeJob(patch)),
  };

  connector = { addMonitoredChannel: jest.fn().mockResolvedValue(makeChannel()) };
  kicker = { drainPending: jest.fn().mockResolvedValue(undefined) };
  projectRepo = {
    findById: jest.fn().mockResolvedValue({
      projectName: '182 Robinson St',
      jobAddress: null,
      creationSource: ProjectCreationSource.ZOHO_FIRST,
    }),
  };

  monitoredRepo = {
    listActive: jest.fn(),
    findById: jest.fn(),
    findByChannel: jest.fn().mockResolvedValue(null),
    listByProjectId: jest.fn().mockResolvedValue([]),
    listByProjectIds: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    removeProjectLink: jest.fn(),
    updateDeltaLink: jest.fn(),
    setChatSummary: jest.fn(),
    deleteById: jest.fn(),
    deactivate: jest.fn(),
  } as unknown as jest.Mocked<ITeamsMonitoredChannelRepository>;

  config = { autoProvisionEnabled: true, hasOwner: true };
  service = build();
});

describe('getForProject', () => {
  it('reports CONNECTED from the active channel, whatever the job says', async () => {
    monitoredRepo.listByProjectId.mockResolvedValue([makeChannel()]);

    const view = await service.getForProject('p1');

    expect(view).toMatchObject({
      state: 'CONNECTED',
      teamName: 'GFS - 182 Robinson Street',
      channelName: '182 Robinson St discussion',
    });
  });

  it('reports NONE when there is no job at all', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(null);
    await expect(service.getForProject('p1')).resolves.toMatchObject({ state: 'NONE', candidates: [] });
  });

  it('reports NONE for a DONE job with no active channel (the disconnect case)', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(makeJob({ status: 'DONE' }));
    await expect(service.getForProject('p1')).resolves.toMatchObject({ state: 'NONE' });
  });

  it('maps a PENDING job to DISCOVERING', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(makeJob({ status: 'PENDING' }));
    await expect(service.getForProject('p1')).resolves.toMatchObject({ state: 'DISCOVERING' });
  });

  it('passes CREATING and FAILED through', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(makeJob({ status: 'CREATING' }));
    await expect(service.getForProject('p1')).resolves.toMatchObject({ state: 'CREATING' });

    outboxRepo.findByProjectId.mockResolvedValue(makeJob({ status: 'FAILED', lastError: 'graph down' }));
    await expect(service.getForProject('p1')).resolves.toMatchObject({ state: 'FAILED', error: 'graph down' });
  });

  it('annotates candidates already linked to another project', async () => {
    monitoredRepo.findByChannel.mockResolvedValue(makeChannel({ projectIds: ['other'] }));

    const view = await service.getForProject('p1');

    expect(view.state).toBe('AWAITING_DECISION');
    expect(view.candidates[0]).toMatchObject({ channelId: 'c1', linkedProjectIds: ['other'] });
  });

  it('suggests names built from the current project name', async () => {
    projectRepo.findById.mockResolvedValue({
      projectName: '10208 Van Thompson Rd',
      jobAddress: null,
      creationSource: ProjectCreationSource.ZOHO_FIRST,
    });

    const view = await service.getForProject('p1');

    expect(view.teamName).toBe('GFS - 10208 Van Thompson Rd');
    expect(view.channelName).toBe('10208 Van Thompson Rd discussion');
  });
});

describe('connectCandidate', () => {
  it('delegates to the manual-connect path and closes the job', async () => {
    const result = await service.connectCandidate('p1', {
      teamId: 't1',
      teamName: 'GFS - 182 Robinson Street',
      channelId: 'c1',
      channelName: '182 Robinson St discussion',
    });

    expect(connector.addMonitoredChannel).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't1', channelId: 'c1', projectId: 'p1' }),
    );
    expect(outboxRepo.updateIfStatus).toHaveBeenCalledWith(
      'job-1',
      'AWAITING_DECISION',
      expect.objectContaining({ status: 'DONE', decision: 'CONNECT' }),
    );
    expect(result.channel.id).toBe('ch-1');
  });

  it('forwards force so a shared channel can be confirmed', async () => {
    await service.connectCandidate('p1', {
      teamId: 't1',
      teamName: 'T',
      channelId: 'c1',
      channelName: 'C',
      force: true,
    });

    expect(connector.addMonitoredChannel).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('propagates the already-linked 409 unchanged and leaves the job parked', async () => {
    const conflict = new AppError('Already linked', StatusCodes.CONFLICT, true, {
      details: { alreadyLinked: true, linkedProjects: ['other'] },
    });
    connector.addMonitoredChannel.mockRejectedValue(conflict);

    await expect(
      service.connectCandidate('p1', { teamId: 't1', teamName: 'T', channelId: 'c1', channelName: 'C' }),
    ).rejects.toBe(conflict);
    expect(outboxRepo.updateIfStatus).not.toHaveBeenCalled();
  });

  it('404s when no job is pending for the project', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(null);

    await expect(
      service.connectCandidate('p1', { teamId: 't1', teamName: 'T', channelId: 'c1', channelName: 'C' }),
    ).rejects.toMatchObject({ statusCode: StatusCodes.NOT_FOUND });
  });

  it('409s when the job was already decided', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(makeJob({ status: 'CREATING' }));

    await expect(
      service.connectCandidate('p1', { teamId: 't1', teamName: 'T', channelId: 'c1', channelName: 'C' }),
    ).rejects.toMatchObject({ statusCode: StatusCodes.CONFLICT });
    expect(connector.addMonitoredChannel).not.toHaveBeenCalled();
  });
});

describe('approveCreate', () => {
  it('moves the job to CREATING, resets attempts and kicks the drain', async () => {
    await service.approveCreate('p1');

    expect(outboxRepo.updateIfStatus).toHaveBeenCalledWith(
      'job-1',
      'AWAITING_DECISION',
      expect.objectContaining({ status: 'CREATING', decision: 'CREATE', attempts: 0 }),
    );
    expect(kicker.drainPending).toHaveBeenCalled();
  });

  it('409s when a concurrent request already moved the job', async () => {
    outboxRepo.updateIfStatus.mockResolvedValue(null);

    await expect(service.approveCreate('p1')).rejects.toMatchObject({ statusCode: StatusCodes.CONFLICT });
    expect(kicker.drainPending).not.toHaveBeenCalled();
  });

  it('503s when auto-provision is disabled', async () => {
    config.autoProvisionEnabled = false;
    service = build();

    await expect(service.approveCreate('p1')).rejects.toMatchObject({
      statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    });
  });

  it('503s when no owner account is configured', async () => {
    config.hasOwner = false;
    service = build();

    await expect(service.approveCreate('p1')).rejects.toMatchObject({
      statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    });
  });

  it('404s when there is no job', async () => {
    outboxRepo.findByProjectId.mockResolvedValue(null);
    await expect(service.approveCreate('p1')).rejects.toMatchObject({ statusCode: StatusCodes.NOT_FOUND });
  });
});
