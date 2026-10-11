import mongoose, { Document, Schema } from 'mongoose';

export type OutlookLinkMethod = 'AUTO' | 'MANUAL' | 'MAILBOX_MAP';

// Lifecycle of an ingested email in the AI / draft flow.
// PENDING   — ingested, sent to AI, awaiting its decision
// LINKED    — AI matched it to an existing project (auto)
// DRAFT     — AI proposed a new project; awaiting human review
// CONFIRMED — a human approved the draft → real project created
// DISCARDED — a human discarded it
export type OutlookEmailStatus = 'PENDING' | 'LINKED' | 'DRAFT' | 'CONFIRMED' | 'DISCARDED';

export type AIProjectType = 'NEW_ESTIMATE' | 'RE_QUOTE' | 'VARIATION';

export interface IAIBidder {
  email?: string;
  company?: string;
  isPrimary?: boolean;
}

export interface IAIAddress {
  address: string;
  type: 'INSTALLATION' | 'BILLING' | 'UNKNOWN';
}

// The AI's proposal for an email, used to pre-fill the draft review form.
export interface IAIProposedProject {
  isProject: boolean;
  customerName?: string | null;
  projectName?: string | null;
  projectType?: AIProjectType | null;
  summary?: string | null;
  confidence: number;
  reasoning?: string | null;
  // Job address / site location the classifier extracts from the email body/subject.
  address?: string | null;
  jobAddress?: string | null;
  // Competitive bidding fields
  groupId?: string | null;
  isCompetitiveBid?: boolean;
  allBidders?: IAIBidder[] | null;
  primaryBidderEmail?: string | null;
  companyName?: string | null;
  allAddresses?: IAIAddress[] | null;
}

export interface IOutlookEmailAttachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  // Inline attachments (signature images etc.) are stored for completeness
  // but never routed to the Document Ingestion Pipeline.
  isInline: boolean;
  isReference: boolean;
  sourceUrl?: string | null;
  // Set true once the file has been downloaded from Graph and stored in blob.
  downloaded: boolean;
  // Blob storage key once the attachment has been staged to Azure Blob at
  // ingestion time. blobUrl is the (non-SAS) blob URL.
  storageKey?: string | null;
  blobUrl?: string | null;
  // Number of failed staging attempts (for capped retry/backfill of files that
  // failed to download/upload, so a transient failure isn't a permanent miss).
  stageAttempts?: number;
}

export interface IOutlookEmail extends Document {
  // Microsoft Graph message id (unique per mailbox copy of the message).
  messageId: string;
  // RFC 2822 Message-ID header — stable across mailboxes, useful for
  // cross-referencing the same mail seen in several monitored mailboxes.
  internetMessageId?: string | null;
  mailboxUserId: string;
  conversationId?: string | null;
  subject?: string | null;
  fromName?: string | null;
  fromAddress?: string | null;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  bodyText: string;
  bodyHtml?: string | null;
  webLink?: string | null;
  receivedDateTime: Date;
  attachments: IOutlookEmailAttachment[];
  projectId?: mongoose.Types.ObjectId | null;
  // Persist the lead created during Draft approval. If downstream project
  // creation is temporarily unavailable, a retry resumes this same lead
  // instead of creating a duplicate in Zoho.
  zohoLeadId?: string | null;
  linkMethod?: OutlookLinkMethod | null;
  routedToPipeline: boolean;
  extractionTriggeredAt?: Date | null;
  // AI / draft flow.
  status: OutlookEmailStatus;
  proposed?: IAIProposedProject | null;
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<IOutlookEmailAttachment>(
  {
    id: { type: String, required: true },
    name: { type: String, default: null },
    contentType: { type: String, default: null },
    size: { type: Number, default: null },
    isInline: { type: Boolean, default: false },
    isReference: { type: Boolean, default: false },
    sourceUrl: { type: String, default: null },
    downloaded: { type: Boolean, default: false },
    storageKey: { type: String, default: null },
    blobUrl: { type: String, default: null },
    stageAttempts: { type: Number, default: 0 },
  },
  { _id: false },
);

const AIProposedProjectSchema = new Schema<IAIProposedProject>(
  {
    isProject: { type: Boolean, required: true },
    customerName: { type: String, default: null },
    projectName: { type: String, default: null },
    projectType: { type: String, enum: ['NEW_ESTIMATE', 'RE_QUOTE', 'VARIATION'], default: null },
    summary: { type: String, default: null },
    confidence: { type: Number, default: 0 },
    reasoning: { type: String, default: null },
    address: { type: String, default: null },
    jobAddress: { type: String, default: null },
    groupId: { type: String, default: null },
    isCompetitiveBid: { type: Boolean, default: false },
    allBidders: { type: Schema.Types.Mixed, default: null },
    primaryBidderEmail: { type: String, default: null },
    companyName: { type: String, default: null },
    allAddresses: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const OutlookEmailSchema = new Schema<IOutlookEmail>(
  {
    messageId: { type: String, required: true, unique: true },
    internetMessageId: { type: String, default: null },
    mailboxUserId: { type: String, required: true },
    conversationId: { type: String, default: null },
    subject: { type: String, default: null },
    fromName: { type: String, default: null },
    fromAddress: { type: String, default: null },
    toRecipients: { type: [String], default: [] },
    ccRecipients: { type: [String], default: [] },
    bccRecipients: { type: [String], default: [] },
    bodyText: { type: String, default: '' },
    bodyHtml: { type: String, default: null },
    webLink: { type: String, default: null },
    receivedDateTime: { type: Date, required: true },
    attachments: { type: [AttachmentSchema], default: [] },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    zohoLeadId: { type: String, default: null },
    linkMethod: { type: String, enum: ['AUTO', 'MANUAL', 'MAILBOX_MAP'], default: null },
    routedToPipeline: { type: Boolean, default: false },
    extractionTriggeredAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'LINKED', 'DRAFT', 'CONFIRMED', 'DISCARDED'],
      default: 'PENDING',
    },
    proposed: { type: AIProposedProjectSchema, default: null },
  },
  { timestamps: true },
);

OutlookEmailSchema.index({ mailboxUserId: 1 });
OutlookEmailSchema.index({ conversationId: 1 });
OutlookEmailSchema.index({ projectId: 1 });
OutlookEmailSchema.index({ projectId: 1, receivedDateTime: -1 });
OutlookEmailSchema.index({ projectId: 1, status: 1 });
OutlookEmailSchema.index({ status: 1 });
OutlookEmailSchema.index({ receivedDateTime: -1 });

export const OutlookEmail = mongoose.model<IOutlookEmail>('OutlookEmail', OutlookEmailSchema);
