import type { HydratedDocument } from 'mongoose';

import { TeamsSubscription, type ITeamsSubscription } from '@db/models/teams-subscription.model';
import type {
  ITeamsSubscriptionRepository,
  IDomainTeamsSubscription,
  ICreateTeamsSubscriptionFields,
} from '../interfaces/i-teams-subscription.repository';

export class MongooseTeamsSubscriptionRepository implements ITeamsSubscriptionRepository {
  public async create(
    fields: ICreateTeamsSubscriptionFields,
  ): Promise<IDomainTeamsSubscription> {
    const doc = await TeamsSubscription.create({ ...fields, isActive: true });
    return this.toDomain(doc);
  }

  public async findBySubscriptionId(
    subscriptionId: string,
  ): Promise<IDomainTeamsSubscription | null> {
    const doc = await TeamsSubscription.findOne({ subscriptionId });
    return doc ? this.toDomain(doc) : null;
  }

  public async findActiveByChannelDbId(
    monitoredChannelDbId: string,
  ): Promise<IDomainTeamsSubscription | null> {
    const doc = await TeamsSubscription.findOne({ monitoredChannelDbId, isActive: true });
    return doc ? this.toDomain(doc) : null;
  }

  public async listActive(): Promise<IDomainTeamsSubscription[]> {
    const docs = await TeamsSubscription.find({ isActive: true });
    return docs.map((d) => this.toDomain(d));
  }

  public async listActiveExpiringBefore(date: Date): Promise<IDomainTeamsSubscription[]> {
    const docs = await TeamsSubscription.find({
      isActive: true,
      expirationDateTime: { $lte: date },
    });
    return docs.map((d) => this.toDomain(d));
  }

  public async updateExpiration(
    subscriptionId: string,
    expirationDateTime: Date,
  ): Promise<void> {
    await TeamsSubscription.updateOne({ subscriptionId }, { expirationDateTime });
  }

  public async deactivateBySubscriptionId(subscriptionId: string): Promise<void> {
    await TeamsSubscription.updateOne({ subscriptionId }, { isActive: false });
  }

  public async deactivateByChannelDbId(
    monitoredChannelDbId: string,
  ): Promise<IDomainTeamsSubscription | null> {
    const doc = await TeamsSubscription.findOneAndUpdate(
      { monitoredChannelDbId, isActive: true },
      { isActive: false },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  private toDomain(doc: HydratedDocument<ITeamsSubscription>): IDomainTeamsSubscription {
    return {
      id: doc._id.toString(),
      subscriptionId: doc.subscriptionId,
      monitoredChannelDbId: doc.monitoredChannelDbId.toString(),
      teamId: doc.teamId,
      channelId: doc.channelId,
      resource: doc.resource,
      changeType: doc.changeType,
      notificationUrl: doc.notificationUrl,
      clientState: doc.clientState,
      expirationDateTime: doc.expirationDateTime,
      isActive: doc.isActive,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
