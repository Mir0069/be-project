export interface IDomainTeamsSubscription {
  id: string;
  subscriptionId: string;
  monitoredChannelDbId: string;
  teamId: string;
  channelId: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  clientState: string;
  expirationDateTime: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateTeamsSubscriptionFields {
  subscriptionId: string;
  monitoredChannelDbId: string;
  teamId: string;
  channelId: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  clientState: string;
  expirationDateTime: Date;
}

export interface ITeamsSubscriptionRepository {
  create(fields: ICreateTeamsSubscriptionFields): Promise<IDomainTeamsSubscription>;
  findBySubscriptionId(subscriptionId: string): Promise<IDomainTeamsSubscription | null>;
  findActiveByChannelDbId(monitoredChannelDbId: string): Promise<IDomainTeamsSubscription | null>;
  listActive(): Promise<IDomainTeamsSubscription[]>;
  listActiveExpiringBefore(date: Date): Promise<IDomainTeamsSubscription[]>;
  updateExpiration(subscriptionId: string, expirationDateTime: Date): Promise<void>;
  deactivateBySubscriptionId(subscriptionId: string): Promise<void>;
  deactivateByChannelDbId(monitoredChannelDbId: string): Promise<IDomainTeamsSubscription | null>;
}
