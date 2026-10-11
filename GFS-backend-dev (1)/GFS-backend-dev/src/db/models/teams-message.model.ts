import mongoose, { Document, Schema } from 'mongoose';

export type TeamsLinkMethod = 'AUTO' | 'MANUAL' | 'CHANNEL_MAP';

export interface ITeamsMessageAttachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  contentUrl?: string | null;
  // Set true once the file has been routed to the Document Ingestion Pipeline
  // (Phase 2). For now it stays false and only the metadata is stored.
  downloaded: boolean;
}

export interface ITeamsMessage extends Document {
  messageId: string;
  teamId: string;
  channelId: string;
  parentMessageId?: string | null;
  fromName?: string | null;
  fromId?: string | null;
  contentText: string;
  contentHtml?: string | null;
  webUrl?: string | null;
  createdDateTime: Date;
  attachments: ITeamsMessageAttachment[];
  projectId?: mongoose.Types.ObjectId | null;
  linkMethod?: TeamsLinkMethod | null;
  routedToPipeline: boolean;
  // Set true once this message has been dispatched to the AI queue (as part of a
  // channel batch or a meeting bundle). Idempotency guard for the AI hand-off.
  sentToAI: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<ITeamsMessageAttachment>(
  {
    id: { type: String, required: true },
    name: { type: String, default: null },
    contentType: { type: String, default: null },
    contentUrl: { type: String, default: null },
    downloaded: { type: Boolean, default: false },
  },
  { _id: false },
);

const TeamsMessageSchema = new Schema<ITeamsMessage>(
  {
    messageId: { type: String, required: true, unique: true },
    teamId: { type: String, required: true },
    channelId: { type: String, required: true },
    parentMessageId: { type: String, default: null },
    fromName: { type: String, default: null },
    fromId: { type: String, default: null },
    contentText: { type: String, default: '' },
    contentHtml: { type: String, default: null },
    webUrl: { type: String, default: null },
    createdDateTime: { type: Date, required: true },
    attachments: { type: [AttachmentSchema], default: [] },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    linkMethod: { type: String, enum: ['AUTO', 'MANUAL', 'CHANNEL_MAP'], default: null },
    routedToPipeline: { type: Boolean, default: false },
    sentToAI: { type: Boolean, default: false },
  },
  { timestamps: true },
);

TeamsMessageSchema.index({ teamId: 1, channelId: 1 });
TeamsMessageSchema.index({ projectId: 1 });

export const TeamsMessage = mongoose.model<ITeamsMessage>('TeamsMessage', TeamsMessageSchema);
