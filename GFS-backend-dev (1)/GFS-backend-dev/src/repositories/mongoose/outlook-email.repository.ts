import mongoose, { type HydratedDocument } from 'mongoose';
import {
  OutlookEmail,
  type IOutlookEmail,
  type OutlookLinkMethod,
} from '@db/models/outlook-email.model';
import type {
  IOutlookEmailRepository,
  IDomainOutlookEmail,
  IUpsertOutlookEmailFields,
  IListOutlookEmailsFilter,
  IOutlookEmailPage,
  IOutlookEmailParticipants,
} from '../interfaces/i-outlook-email.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;

export class MongooseOutlookEmailRepository implements IOutlookEmailRepository {
  public async upsertByMessageId(
    fields: IUpsertOutlookEmailFields,
  ): Promise<IDomainOutlookEmail> {
    // Always-update fields (sync refreshes these on every poll tick)
    const { status, routedToPipeline, proposed, ...mutableFields } = fields;

    const doc = await OutlookEmail.findOneAndUpdate(
      { messageId: fields.messageId },
      {
        // Mutable fields: refresh on every sync (body, attachments, subject, etc.)
        $set: mutableFields,
        // Immutable-on-update: only written when the document is first INSERTED.
        // This prevents a re-sync from clobbering AI results (status/proposed)
        // or the pipeline dispatch flag.
        $setOnInsert: {
          status: status ?? 'PENDING',
          routedToPipeline: routedToPipeline ?? false,
          proposed: proposed ?? null,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return this.toDomain(doc);
  }

  public async findByMessageId(messageId: string): Promise<IDomainOutlookEmail | null> {
    const doc = await OutlookEmail.findOne({ messageId });
    return doc ? this.toDomain(doc) : null;
  }

  public async list(filter: IListOutlookEmailsFilter): Promise<IOutlookEmailPage> {
    const page = filter.page && filter.page > 0 ? filter.page : DEFAULT_PAGE;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;

    const query: Record<string, unknown> = {};
    if (filter.projectId) {
      query['projectId'] = mongoose.Types.ObjectId.isValid(filter.projectId)
        ? { $in: [filter.projectId, new mongoose.Types.ObjectId(filter.projectId)] }
        : filter.projectId;
    }
    if (filter.mailboxUserId) query['mailboxUserId'] = filter.mailboxUserId;
    if (filter.conversationId) query['conversationId'] = filter.conversationId;

    const [docs, total] = await Promise.all([
      OutlookEmail.find(query)
        .sort({ receivedDateTime: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      OutlookEmail.countDocuments(query),
    ]);

    return { emails: docs.map((d) => this.toDomain(d)), total };
  }

  public async listParticipantsByProjectId(
    projectId: string,
  ): Promise<IOutlookEmailParticipants[]> {
    const projQuery = mongoose.Types.ObjectId.isValid(projectId)
      ? { $in: [projectId, new mongoose.Types.ObjectId(projectId)] }
      : projectId;

    // Contact aggregation does not need message bodies or attachments.
    const docs = await OutlookEmail.find({ projectId: projQuery })
      .select('fromName fromAddress toRecipients ccRecipients receivedDateTime')
      .sort({ receivedDateTime: 1 })
      .exec();

    return docs.map((doc) => ({
      fromName: doc.fromName ?? null,
      fromAddress: doc.fromAddress ?? null,
      toRecipients: doc.toRecipients ?? [],
      ccRecipients: doc.ccRecipients ?? [],
      receivedDateTime: doc.receivedDateTime,
    }));
  }

  public async setProject(
    messageId: string,
    projectId: string,
    linkMethod: OutlookLinkMethod,
  ): Promise<IDomainOutlookEmail | null> {
    const targetProjId = mongoose.Types.ObjectId.isValid(projectId)
      ? new mongoose.Types.ObjectId(projectId)
      : projectId;

    const doc = await OutlookEmail.findOneAndUpdate(
      { messageId },
      { projectId: targetProjId, linkMethod },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  public async markAttachmentsDownloaded(
    messageId: string,
    attachmentIds: string[],
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    await OutlookEmail.updateOne(
      { messageId },
      { $set: { 'attachments.$[el].downloaded': true } },
      { arrayFilters: [{ 'el.id': { $in: attachmentIds } }] },
    );
  }

  public async markRoutedToPipeline(messageId: string): Promise<void> {
    await OutlookEmail.updateOne({ messageId }, { routedToPipeline: true });
  }

  public async findWithUnstagedAttachments(
    mailboxUserId: string,
    maxAttempts: number,
    limit: number,
  ): Promise<IDomainOutlookEmail[]> {
    const docs = await OutlookEmail.find({
      mailboxUserId,
      attachments: {
        $elemMatch: {
          isInline: false,
          downloaded: false,
          $or: [{ stageAttempts: { $lt: maxAttempts } }, { stageAttempts: { $exists: false } }],
        },
      },
    }).limit(limit);
    return docs.map((d) => this.toDomain(d));
  }

  public async setAttachmentStaged(
    messageId: string,
    attachmentId: string,
    storageKey: string,
    blobUrl: string,
  ): Promise<void> {
    await OutlookEmail.updateOne(
      { messageId },
      {
        $set: {
          'attachments.$[el].downloaded': true,
          'attachments.$[el].storageKey': storageKey,
          'attachments.$[el].blobUrl': blobUrl,
        },
      },
      { arrayFilters: [{ 'el.id': attachmentId }] },
    );
  }

  public async recordAttachmentStageFailure(
    messageId: string,
    attachmentId: string,
    attempts?: number,
  ): Promise<void> {
    const update = typeof attempts === 'number'
      ? { $set: { 'attachments.$[el].stageAttempts': attempts } }
      : { $inc: { 'attachments.$[el].stageAttempts': 1 } };
    await OutlookEmail.updateOne(
      { messageId },
      update,
      { arrayFilters: [{ 'el.id': attachmentId }] },
    );
  }

  private toDomain(doc: HydratedDocument<IOutlookEmail>): IDomainOutlookEmail {
    return {
      id: doc._id.toString(),
      messageId: doc.messageId,
      internetMessageId: doc.internetMessageId ?? null,
      mailboxUserId: doc.mailboxUserId,
      conversationId: doc.conversationId ?? null,
      subject: doc.subject ?? null,
      fromName: doc.fromName ?? null,
      fromAddress: doc.fromAddress ?? null,
      toRecipients: doc.toRecipients ?? [],
      ccRecipients: doc.ccRecipients ?? [],
      bccRecipients: doc.bccRecipients ?? [],
      bodyText: doc.bodyText,
      bodyHtml: doc.bodyHtml ?? null,
      webLink: doc.webLink ?? null,
      receivedDateTime: doc.receivedDateTime,
      attachments: (doc.attachments ?? []).map((a) => ({
        id: a.id,
        name: a.name ?? null,
        contentType: a.contentType ?? null,
        size: a.size ?? null,
        isInline: a.isInline,
        isReference: a.isReference ?? false,
        sourceUrl: a.sourceUrl ?? null,
        downloaded: a.downloaded,
        storageKey: a.storageKey ?? null,
        blobUrl: a.blobUrl ?? null,
        stageAttempts: a.stageAttempts ?? 0,
      })),
      projectId: doc.projectId ? doc.projectId.toString() : null,
      linkMethod: doc.linkMethod ?? null,
      routedToPipeline: doc.routedToPipeline ?? false,
      status: doc.status ?? 'PENDING',
      proposed: doc.proposed
        ? {
            isProject: doc.proposed.isProject,
            customerName: doc.proposed.customerName ?? null,
            projectName: doc.proposed.projectName ?? null,
            projectType: doc.proposed.projectType ?? null,
            summary: doc.proposed.summary ?? null,
            confidence: doc.proposed.confidence ?? 0,
            reasoning: doc.proposed.reasoning ?? null,
          }
        : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
