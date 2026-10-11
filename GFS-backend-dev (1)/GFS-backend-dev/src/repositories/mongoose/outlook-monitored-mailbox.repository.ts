import type { HydratedDocument } from 'mongoose';
import {
  OutlookMonitoredMailbox,
  type IOutlookMonitoredMailbox,
} from '@db/models/outlook-monitored-mailbox.model';
import type {
  IOutlookMonitoredMailboxRepository,
  IDomainMonitoredMailbox,
  ICreateMonitoredMailboxFields,
} from '../interfaces/i-outlook-monitored-mailbox.repository';

const DEFAULT_FOLDER_ID = 'inbox';

export class MongooseOutlookMonitoredMailboxRepository
  implements IOutlookMonitoredMailboxRepository
{
  public async listActive(): Promise<IDomainMonitoredMailbox[]> {
    const docs = await OutlookMonitoredMailbox.find({ isActive: true }).sort({ createdAt: -1 });
    return docs.map((d) => this.toDomain(d));
  }

  public async findById(id: string): Promise<IDomainMonitoredMailbox | null> {
    const doc = await OutlookMonitoredMailbox.findById(id);
    return doc ? this.toDomain(doc) : null;
  }

  public async findByMailbox(
    userId: string,
    folderId: string,
  ): Promise<IDomainMonitoredMailbox | null> {
    const doc = await OutlookMonitoredMailbox.findOne({ userId, folderId });
    return doc ? this.toDomain(doc) : null;
  }

  public async upsert(fields: ICreateMonitoredMailboxFields): Promise<IDomainMonitoredMailbox> {
    const folderId = fields.folderId ?? DEFAULT_FOLDER_ID;
    const doc = await OutlookMonitoredMailbox.findOneAndUpdate(
      { userId: fields.userId, folderId },
      {
        displayName: fields.displayName,
        projectId: fields.projectId ?? null,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return this.toDomain(doc);
  }

  public async updateDeltaLink(id: string, deltaLink: string | null): Promise<void> {
    await OutlookMonitoredMailbox.updateOne({ _id: id }, { deltaLink });
  }

  public async deactivate(id: string): Promise<IDomainMonitoredMailbox | null> {
    const doc = await OutlookMonitoredMailbox.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    return doc ? this.toDomain(doc) : null;
  }

  private toDomain(doc: HydratedDocument<IOutlookMonitoredMailbox>): IDomainMonitoredMailbox {
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      displayName: doc.displayName,
      folderId: doc.folderId,
      projectId: doc.projectId ? doc.projectId.toString() : null,
      deltaLink: doc.deltaLink ?? null,
      isActive: doc.isActive,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
