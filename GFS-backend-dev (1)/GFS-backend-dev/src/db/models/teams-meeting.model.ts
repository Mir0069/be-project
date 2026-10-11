import mongoose, { Document, Schema } from 'mongoose';

export interface ITeamsAiSummarySubdoc {
  summary: string;
  keyPoints: string[];
  requirements: string[];
  confidence?: number | null;
  updatedAt: Date;
}

// Reusable embedded AI-summary shape (also used on TeamsMonitoredChannel).
export const TeamsAiSummarySchema = new Schema<ITeamsAiSummarySubdoc>(
  {
    summary: { type: String, default: '' },
    keyPoints: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    confidence: { type: Number, default: null },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

// A channel meeting occurrence, keyed by the callStarted event message id.
// One row per occurrence (recurring channel meetings reuse a single meetingId
// but emit a distinct event per call). Written at transcript-discovery time;
// participants are derived (VTT speakers + message senders), not fetched.
export interface ITeamsMeeting extends Document {
  channelEventMessageId: string;
  callId?: string | null;
  meetingId?: string | null;
  subject?: string | null;
  startDateTime?: Date | null;
  teamId?: string | null;
  channelId?: string | null;
  monitoredChannelDbId?: mongoose.Types.ObjectId | null;
  projectId?: mongoose.Types.ObjectId | null;
  transcriptId?: string | null;
  participantNames: string[];
  participantCount: number;
  messageCount: number;
  documentCount: number;
  hasTranscript: boolean;
  lastRecordedAt: Date;
  // AI hand-off: set true once this meeting has been dispatched to the AI queue
  // (idempotency guard so a meeting is sent once). aiSummary is written back by
  // the AI result callback.
  sentToAI: boolean;
  // How many times this meeting has been dispatched to the AI queue. Bounds the
  // retry when the AI keeps returning an empty summary (e.g. the transcript blob
  // SAS expired before it could be read) so a meeting can't loop forever.
  aiAttempts?: number;
  aiSummary?: ITeamsAiSummarySubdoc | null;
  createdAt: Date;
  updatedAt: Date;
}

const TeamsMeetingSchema = new Schema<ITeamsMeeting>(
  {
    channelEventMessageId: { type: String, required: true, unique: true },
    callId: { type: String, default: null },
    meetingId: { type: String, default: null },
    subject: { type: String, default: null },
    startDateTime: { type: Date, default: null },
    teamId: { type: String, default: null },
    channelId: { type: String, default: null },
    monitoredChannelDbId: {
      type: Schema.Types.ObjectId,
      ref: 'TeamsMonitoredChannel',
      default: null,
    },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    transcriptId: { type: String, default: null },
    participantNames: { type: [String], default: [] },
    participantCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    documentCount: { type: Number, default: 0 },
    hasTranscript: { type: Boolean, default: false },
    lastRecordedAt: { type: Date, required: true },
    sentToAI: { type: Boolean, default: false },
    aiAttempts: { type: Number, default: 0 },
    aiSummary: { type: TeamsAiSummarySchema, default: null },
  },
  { timestamps: true },
);

TeamsMeetingSchema.index({ projectId: 1 });
TeamsMeetingSchema.index({ monitoredChannelDbId: 1, startDateTime: -1 });
TeamsMeetingSchema.index({ meetingId: 1 });

export const TeamsMeeting = mongoose.model<ITeamsMeeting>('TeamsMeeting', TeamsMeetingSchema);
