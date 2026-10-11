import mongoose, { Document, Schema } from 'mongoose';

export type CloudLinkProvider =
  | 'SHAREPOINT'
  | 'ONEDRIVE'
  | 'GOOGLE_DRIVE'
  | 'DROPBOX'
  | 'GENERIC'
  | 'UNKNOWN';

export type CloudLinkStatus =
  | 'DETECTED'
  | 'RESOLVING'
  | 'DOWNLOADED'
  | 'ACCESS_REQUIRED'
  | 'EXPIRED'
  | 'FAILED_SECURITY_CHECK'
  | 'MANUAL_UPLOAD_REQUIRED';

export interface ICloudLinkAuditLog {
  action: string;
  timestamp: Date;
  detail?: string | null;
}

export interface ICloudLinkAsset extends Document {
  emailId?: mongoose.Types.ObjectId | null;
  teamsMessageId?: mongoose.Types.ObjectId | null;
  projectId?: mongoose.Types.ObjectId | null;
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
  documentId?: mongoose.Types.ObjectId | null;
  firstSeenAt: Date;
  lastCheckedAt?: Date | null;
  retryCount: number;
  errorMessage?: string | null;
  auditLog: ICloudLinkAuditLog[];
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<ICloudLinkAuditLog>(
  {
    action: { type: String, required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    detail: { type: String, default: null },
  },
  { _id: false },
);

const CloudLinkAssetSchema = new Schema<ICloudLinkAsset>(
  {
    emailId: { type: Schema.Types.ObjectId, ref: 'OutlookEmail', default: null },
    teamsMessageId: { type: Schema.Types.ObjectId, ref: 'TeamsMessage', default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    originalUrl: { type: String, required: true },
    normalizedUrl: { type: String, required: true },
    provider: {
      type: String,
      enum: ['SHAREPOINT', 'ONEDRIVE', 'GOOGLE_DRIVE', 'DROPBOX', 'GENERIC', 'UNKNOWN'],
      required: true,
    },
    linkText: { type: String, default: null },
    sender: { type: String, required: true },
    subject: { type: String, required: true },
    receivedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: [
        'DETECTED',
        'RESOLVING',
        'DOWNLOADED',
        'ACCESS_REQUIRED',
        'EXPIRED',
        'FAILED_SECURITY_CHECK',
        'MANUAL_UPLOAD_REQUIRED',
      ],
      default: 'DETECTED',
      required: true,
    },
    storageKey: { type: String, default: null },
    blobUrl: { type: String, default: null },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    firstSeenAt: { type: Date, required: true, default: Date.now },
    lastCheckedAt: { type: Date, default: null },
    retryCount: { type: Number, required: true, default: 0 },
    errorMessage: { type: String, default: null },
    auditLog: { type: [AuditLogSchema], default: [] },
  },
  { timestamps: true },
);

CloudLinkAssetSchema.index({ normalizedUrl: 1 });
CloudLinkAssetSchema.index({ emailId: 1 });
CloudLinkAssetSchema.index({ teamsMessageId: 1 });
CloudLinkAssetSchema.index({ projectId: 1 });
CloudLinkAssetSchema.index({ status: 1 });

export const CloudLinkAsset = mongoose.model<ICloudLinkAsset>('CloudLinkAsset', CloudLinkAssetSchema);
