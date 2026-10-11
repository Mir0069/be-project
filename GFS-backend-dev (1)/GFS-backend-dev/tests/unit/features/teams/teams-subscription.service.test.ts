import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import {
  TeamsSubscriptionService,
  type TeamsSubscriptionConfig,
} from '@features/teams/teams-subscription.service';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';
import type { ITeamsSubscriptionRepository, IDomainTeamsSubscription } from '@repositories/interfaces/i-teams-subscription.repository';
import type { ITeamsMonitoredChannelRepository, IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';

const CONFIG: TeamsSubscriptionConfig = {
  webhookBaseUrl: 'https://api.example.com',
  webhookPath: '/api/v1/teams/webhook',
  clientState: 'secret-state',
  ttlMs: 3_300_000,
  renewBeforeMs: 900_000,
  enabled: true,
};

const futureIso = (): string => new Date(Date.now() + 3_300_000).toISOString();

const makeChannel = (o: Partial<IDomainMonitoredChannel> = {}): IDomainMonitoredChannel => ({
  id: 'mc-1',
  teamId: 'team-A',
  teamName: 'GFS',
  channelId: 'chan-A',
  channelName: 'Alpha',
  projectIds: ['p1'],
  deltaLink: null,
  isActive: true,
  aiChatSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeSub = (o: Partial<IDomainTeamsSubscription> = {}): IDomainTeamsSubscription => ({
  id: 'db-1',
  subscriptionId: 'sub-1',
  monitoredChannelDbId: 'mc-1',
  teamId: 'team-A',
  channelId: 'chan-A',
  resource: '/teams/team-A/channels/chan-A/messages',
  changeType: 'created,updated',
  notificationUrl: 'https://api.example.com/api/v1/teams/webhook',
  clientState: 'secret-state',
  expirationDateTime: new Date(Date.now() + 3_300_000),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
let graph: any;
let subRepo: any;
let channelRepo: any;

const build = (config: TeamsSubscriptionConfig = CONFIG): TeamsSubscriptionService =>
  new TeamsSubscriptionService(
    graph as ITeamsGraphClient,
    subRepo as ITeamsSubscriptionRepository,
    channelRepo as ITeamsMonitoredChannelRepository,
    config,
  );

beforeEach(() => {
  graph = {
    createSubscription: jest.fn().mockResolvedValue({ id: 'sub-new', expirationDateTime: futureIso() }),
    renewSubscription: jest.fn().mockResolvedValue({ id: 'sub-1', expirationDateTime: futureIso() }),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
    listSubscriptions: jest.fn().mockResolvedValue([]),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  subRepo = {
    create: jest.fn().mockImplementation(async (f) => makeSub({ subscriptionId: f.subscriptionId })),
    findBySubscriptionId: jest.fn(),
    findActiveByChannelDbId: jest.fn(),
    listActive: jest.fn().mockResolvedValue([]),
    listActiveExpiringBefore: jest.fn().mockResolvedValue([]),
    updateExpiration: jest.fn(),
    deactivateBySubscriptionId: jest.fn(),
    deactivateByChannelDbId: jest.fn(),
  };
  channelRepo = {
    listActive: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findByChannel: jest.fn(),
    upsert: jest.fn(),
    updateDeltaLink: jest.fn(),
    deactivate: jest.fn(),
  };
});

describe('isEnabled', () => {
  it('is false when disabled or missing config', () => {
    expect(build({ ...CONFIG, enabled: false }).isEnabled()).toBe(false);
    expect(build({ ...CONFIG, webhookBaseUrl: '' }).isEnabled()).toBe(false);
    expect(build({ ...CONFIG, clientState: '' }).isEnabled()).toBe(false);
    expect(build().isEnabled()).toBe(true);
  });
});

describe('ensureSubscription', () => {
  it('creates and persists a subscription when none exists', async () => {
    subRepo.findActiveByChannelDbId.mockResolvedValue(null);
    await build().ensureSubscription(makeChannel());
    expect(graph.createSubscription).toHaveBeenCalledTimes(1);
    const arg = graph.createSubscription.mock.calls[0][0];
    expect(arg.resource).toBe('/teams/team-A/channels/chan-A/messages');
    expect(arg.notificationUrl).toBe('https://api.example.com/api/v1/teams/webhook');
    expect(arg.clientState).toBe('secret-state');
    expect(subRepo.create).toHaveBeenCalledTimes(1);
  });

  it('deletes an orphaned Graph subscription for the same resource before creating', async () => {
    subRepo.findActiveByChannelDbId.mockResolvedValue(null);
    // Graph still holds a stale subscription for this resource (different case /
    // leading slash) that our DB does not track — it must be deleted first.
    graph.listSubscriptions.mockResolvedValue([
      { id: 'sub-orphan', resource: 'teams/team-A/channels/CHAN-A/messages' },
      { id: 'sub-other', resource: 'teams/team-A/channels/other/messages' },
    ]);
    await build().ensureSubscription(makeChannel());
    expect(graph.deleteSubscription).toHaveBeenCalledWith('sub-orphan');
    expect(graph.deleteSubscription).not.toHaveBeenCalledWith('sub-other');
    expect(graph.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: returns the existing active subscription without creating', async () => {
    subRepo.findActiveByChannelDbId.mockResolvedValue(makeSub());
    const result = await build().ensureSubscription(makeChannel());
    expect(graph.createSubscription).not.toHaveBeenCalled();
    expect(result?.subscriptionId).toBe('sub-1');
  });

  it('no-ops when disabled', async () => {
    const result = await build({ ...CONFIG, enabled: false }).ensureSubscription(makeChannel());
    expect(result).toBeNull();
    expect(graph.createSubscription).not.toHaveBeenCalled();
  });
});

describe('renewDueSubscriptions', () => {
  it('creates subscriptions for channels that lack one', async () => {
    channelRepo.listActive.mockResolvedValue([makeChannel()]);
    subRepo.listActive.mockResolvedValue([]);
    const summary = await build().renewDueSubscriptions();
    expect(graph.createSubscription).toHaveBeenCalledTimes(1);
    expect(summary.created).toBe(1);
  });

  it('renews subscriptions expiring soon', async () => {
    channelRepo.listActive.mockResolvedValue([makeChannel()]);
    const sub = makeSub();
    subRepo.listActive.mockResolvedValue([sub]);
    subRepo.listActiveExpiringBefore.mockResolvedValue([sub]);
    const summary = await build().renewDueSubscriptions();
    expect(graph.renewSubscription).toHaveBeenCalledWith('sub-1', expect.any(String));
    expect(subRepo.updateExpiration).toHaveBeenCalled();
    expect(summary.renewed).toBe(1);
  });

  it('recreates a subscription when renewal returns 404/410 (gone)', async () => {
    channelRepo.listActive.mockResolvedValue([makeChannel()]);
    const sub = makeSub();
    subRepo.listActive.mockResolvedValue([sub]);
    subRepo.listActiveExpiringBefore.mockResolvedValue([sub]);
    graph.renewSubscription.mockRejectedValue(new AppError('gone', StatusCodes.GONE));
    const summary = await build().renewDueSubscriptions();
    expect(subRepo.deactivateBySubscriptionId).toHaveBeenCalledWith('sub-1');
    expect(graph.createSubscription).toHaveBeenCalledTimes(1);
    expect(summary.recreated).toBe(1);
  });

  it('deletes and deactivates orphaned subscriptions (channel no longer active)', async () => {
    channelRepo.listActive.mockResolvedValue([]);
    const orphan = makeSub({ subscriptionId: 'sub-orphan', monitoredChannelDbId: 'mc-gone' });
    subRepo.listActive.mockResolvedValue([orphan]);
    const summary = await build().renewDueSubscriptions();
    expect(graph.deleteSubscription).toHaveBeenCalledWith('sub-orphan');
    expect(subRepo.deactivateBySubscriptionId).toHaveBeenCalledWith('sub-orphan');
    expect(summary.deleted).toBe(1);
  });

  it('isolates per-item failures so one create throw does not abort the sweep', async () => {
    channelRepo.listActive.mockResolvedValue([
      makeChannel({ id: 'mc-1', channelId: 'c1' }),
      makeChannel({ id: 'mc-2', channelId: 'c2' }),
    ]);
    subRepo.listActive.mockResolvedValue([]);
    graph.createSubscription
      .mockRejectedValueOnce(new AppError('boom', StatusCodes.INTERNAL_SERVER_ERROR))
      .mockResolvedValueOnce({ id: 'sub-2', expirationDateTime: futureIso() });
    const summary = await build().renewDueSubscriptions();
    expect(summary.errors).toBe(1);
    expect(summary.created).toBe(1);
  });

  it('no-ops when disabled', async () => {
    const summary = await build({ ...CONFIG, enabled: false }).renewDueSubscriptions();
    expect(channelRepo.listActive).not.toHaveBeenCalled();
    expect(summary).toEqual({ created: 0, renewed: 0, recreated: 0, deleted: 0, errors: 0 });
  });
});

describe('removeForChannel', () => {
  it('deletes the Graph subscription and deactivates locally', async () => {
    subRepo.findActiveByChannelDbId.mockResolvedValue(makeSub());
    await build().removeForChannel('mc-1');
    expect(graph.deleteSubscription).toHaveBeenCalledWith('sub-1');
    expect(subRepo.deactivateByChannelDbId).toHaveBeenCalledWith('mc-1');
  });

  it('swallows a Graph 404 during delete', async () => {
    subRepo.findActiveByChannelDbId.mockResolvedValue(makeSub());
    graph.deleteSubscription.mockRejectedValue(new AppError('gone', StatusCodes.NOT_FOUND));
    await expect(build().removeForChannel('mc-1')).resolves.toBeUndefined();
    expect(subRepo.deactivateByChannelDbId).toHaveBeenCalledWith('mc-1');
  });

  it('no-ops when no active subscription exists', async () => {
    subRepo.findActiveByChannelDbId.mockResolvedValue(null);
    await build().removeForChannel('mc-1');
    expect(graph.deleteSubscription).not.toHaveBeenCalled();
  });
});

describe('handleLifecycleEvent', () => {
  it('recreates on subscriptionRemoved', async () => {
    subRepo.findBySubscriptionId.mockResolvedValue(makeSub());
    channelRepo.findById.mockResolvedValue(makeChannel());
    await build().handleLifecycleEvent('sub-1', 'subscriptionRemoved');
    expect(subRepo.deactivateBySubscriptionId).toHaveBeenCalledWith('sub-1');
    expect(graph.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('renews on reauthorizationRequired', async () => {
    subRepo.findBySubscriptionId.mockResolvedValue(makeSub());
    channelRepo.findById.mockResolvedValue(makeChannel());
    await build().handleLifecycleEvent('sub-1', 'reauthorizationRequired');
    expect(graph.renewSubscription).toHaveBeenCalledWith('sub-1', expect.any(String));
    expect(subRepo.updateExpiration).toHaveBeenCalled();
  });

  it('ignores an unknown subscriptionId', async () => {
    subRepo.findBySubscriptionId.mockResolvedValue(null);
    await build().handleLifecycleEvent('unknown', 'missed');
    expect(graph.renewSubscription).not.toHaveBeenCalled();
    expect(graph.createSubscription).not.toHaveBeenCalled();
  });
});

describe('getChannelDbIdForSubscription', () => {
  it('returns the channelDbId for an active subscription', async () => {
    subRepo.findBySubscriptionId.mockResolvedValue(makeSub());
    expect(await build().getChannelDbIdForSubscription('sub-1')).toBe('mc-1');
  });

  it('returns null for an inactive or unknown subscription', async () => {
    subRepo.findBySubscriptionId.mockResolvedValue(makeSub({ isActive: false }));
    expect(await build().getChannelDbIdForSubscription('sub-1')).toBeNull();
    subRepo.findBySubscriptionId.mockResolvedValue(null);
    expect(await build().getChannelDbIdForSubscription('nope')).toBeNull();
  });
});
