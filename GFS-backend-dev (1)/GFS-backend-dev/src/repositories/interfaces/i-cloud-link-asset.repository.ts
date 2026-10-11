import type { CloudLinkStatus, CloudLinkProvider } from '@db/models/cloud-link-asset.model';

export interface IDomainCloudLinkAsset {
  id: string;
  emailId?: string | null;
  teamsMessageId?: string | null;
  projectId?: string | null;
  originalUrl: string;
  normalizedUrl: string;
  provider: CloudLinkProvider;
  linkText?: string | null;
  sender: string;
  subject: string;
  receivedAt: Date;
  status: CloudLinkStatus;
  storageKey?: string | null;
  blobUrl?: string | null;
  documentId?: string | null;
  firstSeenAt: Date;
  lastCheckedAt?: Date | null;
  retryCount: number;
  errorMessage?: string | null;
  auditLog: Array<{ action: string; timestamp: Date; detail?: string | null }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateCloudLinkAssetFields {
  emailId?: string | null;
  teamsMessageId?: string | null;
  projectId?: string | null;
  originalUrl: string;
  normalizedUrl: string;
  provider: CloudLinkProvider;
  linkText?: string | null;
  sender: string;
  subject: string;
  receivedAt: Date;
  status?: CloudLinkStatus;
  firstSeenAt?: Date;
  auditLog?: Array<{ action: string; timestamp: Date; detail?: string | null }>;
}

export interface ICloudLinkAssetRepository {
  create(fields: ICreateCloudLinkAssetFields): Promise<IDomainCloudLinkAsset>;
  findById(id: string): Promise<IDomainCloudLinkAsset | null>;
  findByNormalizedUrl(
    normalizedUrl: string,
    emailId?: string | null,
    teamsMessageId?: string | null,
  ): Promise<IDomainCloudLinkAsset | null>;
  updateStatus(
    id: string,
    status: CloudLinkStatus,
    auditLogEntry: { action: string; detail?: string | null },
    extraFields?: Partial<IDomainCloudLinkAsset>,
  ): Promise<IDomainCloudLinkAsset | null>;
  list(filter: {
    projectId?: string;
    emailId?: string;
    teamsMessageId?: string;
    status?: CloudLinkStatus;
  }): Promise<IDomainCloudLinkAsset[]>;
}
