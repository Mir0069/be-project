import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import type {
  ITeamsSubscriptionRepository,
  IDomainTeamsSubscription,
} from '@repositories/interfaces/i-teams-subscription.repository';
import type {
  ITeamsMonitoredChannelRepository,
  IDomainMonitoredChannel,
} from '@repositories/interfaces/i-teams-monitored-channel.repository';

import type { ITeamsGraphClient } from './teams.graph-client';
import { describeError } from './teams.errors';

const CHANGE_TYPE = 'created,updated';
const GONE_STATUSES = new Set<number>([StatusCodes.NOT_FOUND, StatusCodes.GONE]);

export interface TeamsSubscriptionConfig {
  webhookBaseUrl: string;
  webhookPath: string;
  clientState: string;
  ttlMs: number;
  renewBeforeMs: number;
  enabled: boolean;
}

export interface RenewSubscriptionsSummary {
  created: number;
  renewed: number;
  recreated: number;
  deleted: number;
  errors: number;
}

export type TeamsLifecycleEvent = 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';

export class TeamsSubscriptionService {
  private readonly graphClient: ITeamsGraphClient;
  private readonly subscriptionRepository: ITeamsSubscriptionRepository;
  private readonly monitoredChannelRepository: ITeamsMonitoredChannelRepository;
  private readonly config: TeamsSubscriptionConfig;

  public constructor(
    graphClient: ITeamsGraphClient,
    subscriptionRepository: ITeamsSubscriptionRepository,
    monitoredChannelRepository: ITeamsMonitoredChannelRepository,
    config: TeamsSubscriptionConfig,
  ) {
    this.graphClient = graphClient;
    this.subscriptionRepository = subscriptionRepository;
    this.monitoredChannelRepository = monitoredChannelRepository;
    this.config = config;
  }

  public isEnabled(): boolean {
    return (
      this.config.enabled &&
      Boolean(this.config.webhookBaseUrl) &&
      Boolean(this.config.clientState)
    );
  }

  public async ensureSubscription(
    channel: IDomainMonitoredChannel,
  ): Promise<IDomainTeamsSubscription | null> {
    if (!this.isEnabled()) return null;
    const existing = await this.subscriptionRepository.findActiveByChannelDbId(channel.id);
    if (existing) return existing;
    return this.createOne(channel);
  }

  public async removeForChannel(monitoredChannelDbId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const sub = await this.subscriptionRepository.findActiveByChannelDbId(monitoredChannelDbId);
    if (!sub) return;
    await this.safeDeleteGraph(sub.subscriptionId);
    await this.subscriptionRepository.deactivateByChannelDbId(monitoredChannelDbId);
  }

  public async getChannelDbIdForSubscription(subscriptionId: string): Promise<string | null> {
    const sub = await this.subscriptionRepository.findBySubscriptionId(subscriptionId);
    return sub && sub.isActive ? sub.monitoredChannelDbId : null;
  }

  // Cron + boot reconcile: create missing subscriptions, renew expiring ones
  // (recreate on 404/410), and delete orphans. Each item is isolated so one
  // failure never aborts the sweep.
  public async renewDueSubscriptions(): Promise<RenewSubscriptionsSummary> {
    const summary: RenewSubscriptionsSummary = {
      created: 0,
      renewed: 0,
      recreated: 0,
      deleted: 0,
      errors: 0,
    };
    if (!this.isEnabled()) return summary;

    const channels = await this.monitoredChannelRepository.listActive();
    const subs = await this.subscriptionRepository.listActive();
    const subChannelIds = new Set(subs.map((s) => s.monitoredChannelDbId));
    const activeChannelIds = new Set(channels.map((c) => c.id));

    for (const channel of channels) {
      if (subChannelIds.has(channel.id)) continue;
      try {
        await this.createOne(channel);
        summary.created += 1;
      } catch (err) {
        summary.errors += 1;
        console.error(
          `[TeamsSubscription] create failed for channel ${channel.channelId}: ${describeError(err)}`,
        );
      }
    }

    const cutoff = new Date(Date.now() + this.config.renewBeforeMs);
    const expiring = await this.subscriptionRepository.listActiveExpiringBefore(cutoff);
    for (const sub of expiring) {
      try {
        const renewed = await this.graphClient.renewSubscription(
          sub.subscriptionId,
          this.nextExpiry(),
        );
        await this.subscriptionRepository.updateExpiration(
          sub.subscriptionId,
          new Date(renewed.expirationDateTime),
        );
        summary.renewed += 1;
      } catch (err) {
        if (this.isGone(err)) {
          await this.subscriptionRepository.deactivateBySubscriptionId(sub.subscriptionId);
          const channel = channels.find((c) => c.id === sub.monitoredChannelDbId);
          if (channel) {
            try {
              await this.createOne(channel);
              summary.recreated += 1;
            } catch (recreateErr) {
              summary.errors += 1;
              console.error(
                `[TeamsSubscription] recreate failed for channel ${channel.channelId}: ${describeError(recreateErr)}`,
              );
            }
          }
        } else {
          summary.errors += 1;
          console.error(
            `[TeamsSubscription] renew failed for ${sub.subscriptionId}: ${describeError(err)}`,
          );
        }
      }
    }

    for (const sub of subs) {
      if (activeChannelIds.has(sub.monitoredChannelDbId)) continue;
      try {
        await this.safeDeleteGraph(sub.subscriptionId);
        await this.subscriptionRepository.deactivateBySubscriptionId(sub.subscriptionId);
        summary.deleted += 1;
      } catch (err) {
        summary.errors += 1;
        console.error(
          `[TeamsSubscription] orphan delete failed for ${sub.subscriptionId}: ${describeError(err)}`,
        );
      }
    }

    return summary;
  }

  public async handleLifecycleEvent(
    subscriptionId: string,
    lifecycleEvent: TeamsLifecycleEvent,
  ): Promise<void> {
    if (!this.isEnabled()) return;
    const sub = await this.subscriptionRepository.findBySubscriptionId(subscriptionId);
    if (!sub) return;
    const channel = await this.monitoredChannelRepository.findById(sub.monitoredChannelDbId);

    if (lifecycleEvent === 'subscriptionRemoved') {
      await this.subscriptionRepository.deactivateBySubscriptionId(subscriptionId);
      if (channel) await this.createOne(channel);
      return;
    }

    // reauthorizationRequired | missed — renew (reauthorize/extend); recreate on failure.
    try {
      const renewed = await this.graphClient.renewSubscription(subscriptionId, this.nextExpiry());
      await this.subscriptionRepository.updateExpiration(
        subscriptionId,
        new Date(renewed.expirationDateTime),
      );
    } catch {
      await this.subscriptionRepository.deactivateBySubscriptionId(subscriptionId);
      if (channel) await this.createOne(channel);
    }
  }

  private async createOne(channel: IDomainMonitoredChannel): Promise<IDomainTeamsSubscription> {
    const resource = `/teams/${channel.teamId}/channels/${channel.channelId}/messages`;
    const notificationUrl = `${this.config.webhookBaseUrl}${this.config.webhookPath}`;
    const expirationDateTime = this.nextExpiry();

    // Graph allows only ONE subscription per app+resource+tenant. We reach here
    // only when our DB has no active record for this channel, so any Graph
    // subscription still live for this resource is an orphan (stale deploy /
    // prior local run / reconnected channel) — delete it first, or the create
    // 403s with "has reached its limit of '1' ... subscription".
    await this.reconcileOrphanGraphSubscriptions(resource);

    const sub = await this.graphClient.createSubscription({
      resource,
      changeType: CHANGE_TYPE,
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      clientState: this.config.clientState,
      expirationDateTime,
    });

    return this.subscriptionRepository.create({
      subscriptionId: sub.id,
      monitoredChannelDbId: channel.id,
      teamId: channel.teamId,
      channelId: channel.channelId,
      resource,
      changeType: CHANGE_TYPE,
      notificationUrl,
      clientState: this.config.clientState,
      expirationDateTime: new Date(sub.expirationDateTime ?? expirationDateTime),
    });
  }

  private async safeDeleteGraph(subscriptionId: string): Promise<void> {
    try {
      await this.graphClient.deleteSubscription(subscriptionId);
    } catch (err) {
      if (!this.isGone(err)) throw err;
    }
  }

  // Delete any Graph subscription the app still holds for this resource but that
  // our DB isn't tracking. Best-effort: on a list/delete failure we log and let
  // the create proceed (it will surface the real error if a true orphan remains).
  private async reconcileOrphanGraphSubscriptions(resource: string): Promise<void> {
    try {
      const subs = await this.graphClient.listSubscriptions();
      const target = this.normalizeResource(resource);
      for (const sub of subs) {
        if (this.normalizeResource(sub.resource ?? '') === target) {
          await this.safeDeleteGraph(sub.id);
        }
      }
    } catch (err) {
      console.error(
        `[TeamsSubscription] orphan reconcile failed for ${resource}: ${describeError(err)}`,
      );
    }
  }

  // Graph may echo the resource with a leading slash and/or different casing on
  // the channel id — normalize both sides before matching.
  private normalizeResource(resource: string): string {
    return resource.replace(/^\/+/, '').toLowerCase();
  }

  private nextExpiry(): string {
    return new Date(Date.now() + this.config.ttlMs).toISOString();
  }

  private isGone(err: unknown): boolean {
    const status = err instanceof AppError ? err.statusCode : undefined;
    return status !== undefined && GONE_STATUSES.has(status);
  }
}
