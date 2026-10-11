import mongoose, { Document, Schema } from 'mongoose';

// A mailbox (user) an admin has chosen to ingest incoming mail from, e.g. the
// shared sales inbox. An optional projectId is the explicit (manual)
// mailbox→project mapping used by the association logic; deltaLink is the
// Microsoft Graph delta cursor for incremental polling of the monitored folder.
export interface IOutlookMonitoredMailbox extends Document {
  // Azure AD object id or userPrincipalName of the mailbox owner.
  userId: string;
  displayName: string;
  // Mail folder to monitor. Defaults to the well-known 'inbox' folder.
  folderId: string;
  projectId?: mongoose.Types.ObjectId | null;
  deltaLink?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const OutlookMonitoredMailboxSchema = new Schema<IOutlookMonitoredMailbox>(
  {
    userId: { type: String, required: true },
    displayName: { type: String, required: true },
    folderId: { type: String, required: true, default: 'inbox' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    deltaLink: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

OutlookMonitoredMailboxSchema.index({ userId: 1, folderId: 1 }, { unique: true });
OutlookMonitoredMailboxSchema.index({ isActive: 1 });

export const OutlookMonitoredMailbox = mongoose.model<IOutlookMonitoredMailbox>(
  'OutlookMonitoredMailbox',
  OutlookMonitoredMailboxSchema,
);
