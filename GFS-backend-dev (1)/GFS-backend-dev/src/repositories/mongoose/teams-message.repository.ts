import type { HydratedDocument } from 'mongoose';
import {
  TeamsMessage,
  type ITeamsMessage,
  type TeamsLinkMethod,
} from '@db/models/teams-message.model';
import type {
  ITeamsMessageRepository,
  IDomainTeamsMessage,
  IUpsertTeamsMessageFields,
  IListTeamsMessagesFilter,
  ITeamsMessagePage,
} from '../interfaces/i-teams-message.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;

export class MongooseTeamsMessageRepository implements ITeamsMessageRepository {
  public async upsertByMessageId(
    fields: IUpsertTeamsMessageFields,
  ): Promise<IDomainTeamsMessage> {
    const doc = await TeamsMessage.findOneAndUpdate(
      { messageId: fields.messageId },
      { ...fields },
      { upsert: true, new: true },
    );
    return this.toDomain(doc);
  }

  public async findByMessageId(messageId: string): Promise<IDomainTeamsMessage | null> {
    const doc = await TeamsMessage.findOne({ messageId });
    return doc ? this.toDomain(doc) : null;
  }

  public async listByParentMessageId(parentMessageId: string): Promise<IDomainTeamsMessage[]> {
    const docs = await TeamsMessage.find({ parentMessageId }).sort({ createdDateTime: 1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async listUnsentByChannelId(channelId: string): Promise<IDomainTeamsMessage[]> {
    const docs = await TeamsMessage.find({ channelId, sentToAI: { $ne: true } }).sort({
      createdDateTime: 1,
    });
    return docs.map((d) => this.toDomain(d));
  }

  public async markSentToAI(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await TeamsMessage.updateMany({ messageId: { $in: messageIds } }, { sentToAI: true });
  }

  public async list(filter: IListTeamsMessagesFilter): Promise<ITeamsMessagePage> {
    const page = filter.page && filter.page > 0 ? filter.page : DEFAULT_PAGE;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;

    const query: Record<string, unknown> = {};
    if (filter.channelIds && filter.channelIds.length > 0) {
      query['channelId'] = { $in: filter.channelIds };
    } else if (filter.channelId) {
      query['channelId'] = filter.channelId;
    } else if (filter.projectId) {
      query['projectId'] = filter.projectId;
    }

    const [docs, total] = await Promise.all([
      TeamsMessage.find(query)
        .sort({ createdDateTime: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      TeamsMessage.countDocuments(query),
    ]);

    return { messages: docs.map((d) => this.toDomain(d)), total };
  }

  public async setProject(
    messageId: string,
    projectId: string,
    linkMethod: TeamsLinkMethod,
  ): Promise<IDomainTeamsMessage | null> {
    const doc = await TeamsMessage.findOneAndUpdate(
      { messageId },
      { projectId, linkMethod },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  public async markAttachmentsDownloaded(
    messageId: string,
    attachmentIds: string[],
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    await TeamsMessage.updateOne(
      { messageId },
      { $set: { 'attachments.$[el].downloaded': true } },
      { arrayFilters: [{ 'el.id': { $in: attachmentIds } }] },
    );
  }

  public async markRoutedToPipeline(messageId: string): Promise<void> {
    await TeamsMessage.updateOne({ messageId }, { routedToPipeline: true });
  }

  private toDomain(doc: HydratedDocument<ITeamsMessage>): IDomainTeamsMessage {
    return {
      id: doc._id.toString(),
      messageId: doc.messageId,
      teamId: doc.teamId,
      channelId: doc.channelId,
      parentMessageId: doc.parentMessageId ?? null,
      fromName: doc.fromName ?? null,
      fromId: doc.fromId ?? null,
      contentText: doc.contentText,
      contentHtml: doc.contentHtml ?? null,
      webUrl: doc.webUrl ?? null,
      createdDateTime: doc.createdDateTime,
      attachments: (doc.attachments ?? []).map((a) => ({
        id: a.id,
        name: a.name ?? null,
        contentType: a.contentType ?? null,
        contentUrl: a.contentUrl ?? null,
        downloaded: a.downloaded,
      })),
      projectId: doc.projectId ? doc.projectId.toString() : null,
      linkMethod: doc.linkMethod ?? null,
      routedToPipeline: doc.routedToPipeline ?? false,
      sentToAI: doc.sentToAI ?? false,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
