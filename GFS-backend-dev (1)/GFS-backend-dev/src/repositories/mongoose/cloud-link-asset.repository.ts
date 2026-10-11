import type { HydratedDocument } from 'mongoose';
import { CloudLinkAsset, type ICloudLinkAsset } from '@db/models/cloud-link-asset.model';
import type {
  ICloudLinkAssetRepository,
  IDomainCloudLinkAsset,
  ICreateCloudLinkAssetFields,
} from '../interfaces/i-cloud-link-asset.repository';
import type { CloudLinkStatus } from '@db/models/cloud-link-asset.model';

export class MongooseCloudLinkAssetRepository implements ICloudLinkAssetRepository {
  public async create(fields: ICreateCloudLinkAssetFields): Promise<IDomainCloudLinkAsset> {
    const doc = await CloudLinkAsset.create({
      ...fields,
      auditLog: fields.auditLog || [
        {
          action: fields.status || 'DETECTED',
          timestamp: new Date(),
          detail: 'Cloud link asset record created.',
        },
      ],
    });
    return this.toDomain(doc);
  }

  public async findById(id: string): Promise<IDomainCloudLinkAsset | null> {
    const doc = await CloudLinkAsset.findById(id);
    return doc ? this.toDomain(doc) : null;
  }

  public async findByNormalizedUrl(
    normalizedUrl: string,
    emailId?: string | null,
    teamsMessageId?: string | null,
  ): Promise<IDomainCloudLinkAsset | null> {
    const query: Record<string, unknown> = { normalizedUrl };
    if (emailId) query['emailId'] = emailId;
    if (teamsMessageId) query['teamsMessageId'] = teamsMessageId;

    const doc = await CloudLinkAsset.findOne(query);
    return doc ? this.toDomain(doc) : null;
  }

  public async updateStatus(
    id: string,
    status: CloudLinkStatus,
    auditLogEntry: { action: string; detail?: string | null },
    extraFields?: Partial<IDomainCloudLinkAsset>,
  ): Promise<IDomainCloudLinkAsset | null> {
    const updateQuery: Record<string, any> = {
      $set: {
        status,
        lastCheckedAt: new Date(),
        ...(extraFields?.storageKey && { storageKey: extraFields.storageKey }),
        ...(extraFields?.blobUrl && { blobUrl: extraFields.blobUrl }),
        ...(extraFields?.documentId && { documentId: extraFields.documentId }),
        ...(extraFields?.errorMessage !== undefined && { errorMessage: extraFields.errorMessage }),
        ...(extraFields?.retryCount !== undefined && { retryCount: extraFields.retryCount }),
      },
      $push: {
        auditLog: {
          action: auditLogEntry.action,
          timestamp: new Date(),
          detail: auditLogEntry.detail ?? null,
        },
      },
    };

    const doc = await CloudLinkAsset.findByIdAndUpdate(id, updateQuery, { new: true });
    return doc ? this.toDomain(doc) : null;
  }

  public async list(filter: {
    projectId?: string;
    emailId?: string;
    teamsMessageId?: string;
    status?: CloudLinkStatus;
  }): Promise<IDomainCloudLinkAsset[]> {
    const query: Record<string, unknown> = {};
    if (filter.projectId) query['projectId'] = filter.projectId;
    if (filter.emailId) query['emailId'] = filter.emailId;
    if (filter.teamsMessageId) query['teamsMessageId'] = filter.teamsMessageId;
    if (filter.status) query['status'] = filter.status;

    const docs = await CloudLinkAsset.find(query).sort({ createdAt: -1 });
    return docs.map((d) => this.toDomain(d));
  }

  private toDomain(doc: HydratedDocument<ICloudLinkAsset>): IDomainCloudLinkAsset {
    return {
      id: doc._id.toString(),
      emailId: doc.emailId ? doc.emailId.toString() : null,
      teamsMessageId: doc.teamsMessageId ? doc.teamsMessageId.toString() : null,
      projectId: doc.projectId ? doc.projectId.toString() : null,
      originalUrl: doc.originalUrl,
      normalizedUrl: doc.normalizedUrl,
      provider: doc.provider,
      linkText: doc.linkText ?? null,
      sender: doc.sender,
      subject: doc.subject,
      receivedAt: doc.receivedAt,
      status: doc.status,
      storageKey: doc.storageKey ?? null,
      blobUrl: doc.blobUrl ?? null,
      documentId: doc.documentId ? doc.documentId.toString() : null,
      firstSeenAt: doc.firstSeenAt,
      lastCheckedAt: doc.lastCheckedAt ?? null,
      retryCount: doc.retryCount ?? 0,
      errorMessage: doc.errorMessage ?? null,
      auditLog: (doc.auditLog || []).map((a) => ({
        action: a.action,
        timestamp: a.timestamp,
        detail: a.detail ?? null,
      })),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
