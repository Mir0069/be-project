import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TeamsMonitoredChannel } from '@db/models/teams-monitored-channel.model';
import { TeamsProvisionOutbox } from '@db/models/teams-provision-outbox.model';
import { Notification, NotificationType } from '@db/models/notification.model';
import { Project, ProjectCreationSource, ProjectStatus, ProjectType } from '@db/models/project.model';
import { TeamsProvisioningService } from '@features/teams/teams-provisioning.service';
import { TeamsProvisionDecisionService } from '@features/teams/teams-provision-decision.service';
import { NotificationService } from '@features/notifications/notification.service';
import { MongooseTeamsMonitoredChannelRepository } from '@repositories/mongoose/teams-monitored-channel.repository';
import { MongooseTeamsProvisionOutboxRepository } from '@repositories/mongoose/teams-provision-outbox.repository';
import { MongooseNotificationRepository } from '@repositories/mongoose/notification.repository';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import type { IProjectTeamsDiscovery } from '@features/teams/teams-provision.types';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';

let mongod: MongoMemoryServer;
let monitoredRepo: MongooseTeamsMonitoredChannelRepository;
let outboxRepo: MongooseTeamsProvisionOutboxRepository;
let projectRepo: MongooseProjectRepository;
let graphClient: jest.Mocked<ITeamsGraphClient>;
let discovery: jest.Mocked<IProjectTeamsDiscovery>;
let service: TeamsProvisioningService;

let projectId: string;

const CANDIDATE = {
  teamId: 'found-team',
  teamName: 'GFS - 182 Robinson Street',
  channelId: 'found-channel',
  channelName: '182 Robinson St discussion',
  score: 0.95,
  reason: 'team-and-channel' as const,
};

const seedProject = async (
  creationSource: ProjectCreationSource,
  projectName = '182 Robinson St',
): Promise<string> => {
  const doc = await Project.create({
    referenceNumber: `GFS-TEST-${Date.now()}`,
    projectName,
    projectType: ProjectType.NEW_ESTIMATE,
    customerName: 'Test Customer',
    status: ProjectStatus.SETUP_PENDING,
    creationSource,
  });
  return doc._id.toString();
};

const enqueueJob = (): Promise<unknown> =>
  outboxRepo.enqueue({
    projectId,
    projectName: '182 Robinson St',
    teamName: 'GFS - 182 Robinson St',
    channelName: '182 Robinson St discussion',
  });

const buildGraphMock = (): jest.Mocked<ITeamsGraphClient> =>
  ({
    get: jest.fn().mockImplementation((path: string) => {
      if (path.includes('/operations/')) return Promise.resolve({ status: 'succeeded' });
      if (path.includes('/primaryChannel')) return Promise.resolve({ id: 'chan-1' });
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
    post: jest.fn().mockResolvedValue({
      status: 202,
      data: {},
      headers: {
        'content-location': "/teams('team-1')",
        location: "/teams('team-1')/operations('op-1')",
      },
    }),
    patch: jest.fn().mockResolvedValue({ status: 200, data: {}, headers: {} }),
    delete: jest.fn(),
  }) as unknown as jest.Mocked<ITeamsGraphClient>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([TeamsMonitoredChannel.syncIndexes(), TeamsProvisionOutbox.syncIndexes()]);
  monitoredRepo = new MongooseTeamsMonitoredChannelRepository();
  outboxRepo = new MongooseTeamsProvisionOutboxRepository();
  projectRepo = new MongooseProjectRepository();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    TeamsMonitoredChannel.deleteMany({}),
    TeamsProvisionOutbox.deleteMany({}),
    Notification.deleteMany({}),
    Project.deleteMany({}),
  ]);
  graphClient = buildGraphMock();
  discovery = { findCandidates: jest.fn().mockResolvedValue([]) };
  projectId = await seedProject(ProjectCreationSource.MAIL_FIRST);
  service = new TeamsProvisioningService(
    graphClient,
    monitoredRepo,
    outboxRepo,
    projectRepo,
    {
      autoProvisionEnabled: true,
      ownerGuid: 'owner-guid',
      ownerUpn: '',
      graphBaseUrl: 'https://graph.microsoft.com/v1.0',
    },
    new NotificationService(new MongooseNotificationRepository()),
    discovery,
  );
});

describe('Teams provisioning drain — mail-first (real Mongo)', () => {
  it('provisions a channel, links it to the project, notifies, and marks the job DONE', async () => {
    await enqueueJob();

    const result = await service.drainPending();
    expect(result).toMatchObject({ processed: 1, provisioned: 1, failed: 0 });
    expect(discovery.findCandidates).not.toHaveBeenCalled();

    const channel = await TeamsMonitoredChannel.findOne({ channelId: 'chan-1' }).lean();
    expect(channel).not.toBeNull();
    expect(channel!.teamId).toBe('team-1');
    expect(channel!.isActive).toBe(true);
    expect(channel!.projectIds.map((p) => p.toString())).toEqual([projectId]);

    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
    expect(job!.teamId).toBe('team-1');
    expect(job!.channelId).toBe('chan-1');

    const notifications = await Notification.find({
      type: NotificationType.TEAMS_WORKSPACE_CREATED,
    }).lean();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.projectId?.toString()).toBe(projectId);
  });

  it('keeps the job runnable (no channel) when Graph fails, then completes on a later drain', async () => {
    await enqueueJob();
    graphClient.post.mockRejectedValueOnce(new Error('graph 503'));

    await service.drainPending();

    let job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('CREATING');
    expect(job!.attempts).toBe(1);
    expect(await TeamsMonitoredChannel.countDocuments({})).toBe(0);

    // Graph recovers — the next drain resumes and completes it.
    await service.drainPending();
    job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
    expect(await TeamsMonitoredChannel.countDocuments({ channelId: 'chan-1' })).toBe(1);
  });

  it('uses the project name as it stands when the team is created', async () => {
    await enqueueJob();
    await Project.updateOne({ _id: projectId }, { $set: { projectName: '10208 Van Thompson Rd' } });

    await service.drainPending();

    expect(graphClient.post).toHaveBeenCalledWith(
      '/teams',
      expect.objectContaining({ displayName: 'GFS - 10208 Van Thompson Rd' }),
    );
    const channel = await TeamsMonitoredChannel.findOne({ channelId: 'chan-1' }).lean();
    expect(channel!.teamName).toBe('GFS - 10208 Van Thompson Rd');
  });

  it('is idempotent: skips provisioning when the project already has a channel', async () => {
    await monitoredRepo.upsert({
      teamId: 'existing-team',
      teamName: 'Existing',
      channelId: 'existing-channel',
      channelName: 'existing',
      projectIds: [projectId],
    });
    await enqueueJob();

    await service.drainPending();

    expect(graphClient.post).not.toHaveBeenCalled();
    expect(await TeamsMonitoredChannel.countDocuments({})).toBe(1);
    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
  });
});

describe('Teams provisioning drain — Zoho-first parks for a human', () => {
  beforeEach(async () => {
    projectId = await seedProject(ProjectCreationSource.ZOHO_FIRST);
  });

  it('parks with candidates and creates nothing', async () => {
    discovery.findCandidates.mockResolvedValue([CANDIDATE]);
    await enqueueJob();

    const result = await service.drainPending();

    expect(result).toMatchObject({ parked: 1, provisioned: 0 });
    expect(graphClient.post).not.toHaveBeenCalled();
    expect(await TeamsMonitoredChannel.countDocuments({})).toBe(0);

    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('AWAITING_DECISION');
    expect(job!.candidates).toHaveLength(1);
    expect(job!.candidates[0]!.channelId).toBe('found-channel');

    const notifications = await Notification.find({
      type: NotificationType.TEAMS_WORKSPACE_NEEDS_DECISION,
    }).lean();
    expect(notifications).toHaveLength(1);
  });

  it('creates only after a human approves, using the current project name', async () => {
    await enqueueJob();
    await service.drainPending();
    await Project.updateOne({ _id: projectId }, { $set: { projectName: '7 Maple Ave' } });

    const decisions = new TeamsProvisionDecisionService(
      outboxRepo,
      { addMonitoredChannel: jest.fn() },
      { drainPending: jest.fn().mockResolvedValue(undefined) },
      projectRepo,
      monitoredRepo,
      { autoProvisionEnabled: true, hasOwner: true },
    );
    const state = await decisions.approveCreate(projectId);
    expect(state.state).toBe('CREATING');

    await service.drainPending();

    expect(graphClient.post).toHaveBeenCalledWith(
      '/teams',
      expect.objectContaining({ displayName: 'GFS - 7 Maple Ave' }),
    );
    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
    expect(job!.decision).toBe('CREATE');
  });

  it('closes a parked job once the channel is connected by hand', async () => {
    await enqueueJob();
    await service.drainPending();
    expect((await TeamsProvisionOutbox.findOne({ projectId }).lean())!.status).toBe('AWAITING_DECISION');

    await monitoredRepo.upsert({
      teamId: 'manual-team',
      teamName: 'Manual',
      channelId: 'manual-channel',
      channelName: 'manual',
      projectIds: [projectId],
    });

    await service.drainPending();

    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
  });
});

describe('Teams provisioning drain — legacy rows', () => {
  it('drains a PENDING row that predates the discovery fields', async () => {
    await TeamsProvisionOutbox.collection.insertOne({
      projectId: new mongoose.Types.ObjectId(projectId),
      projectName: '182 Robinson St',
      teamName: 'GFS - 182 Robinson St',
      channelName: '182 Robinson St discussion',
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      teamId: null,
      operationId: null,
      channelId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.drainPending()).resolves.toMatchObject({ processed: 1 });
    const job = await TeamsProvisionOutbox.findOne({ projectId }).lean();
    expect(job!.status).toBe('DONE');
  });
});
