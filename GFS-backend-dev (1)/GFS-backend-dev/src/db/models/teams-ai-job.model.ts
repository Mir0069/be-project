import mongoose, { Document, Schema } from 'mongoose';

// One Teams → AI dispatch. Created when a channel sync emits a payload to the
// `teams-ai-integration` queue; `_id` is the correlation anchor (correlationId =
// "teamsAiJob:<_id>"), the exact analog of the Outlook flow's OutlookEmail._id.
// The AI echoes the correlationId on POST /teams/ai-result and we complete the
// job + fan its results out to the chat / meeting summaries.
export type TeamsAiJobStatus = 'SENT' | 'COMPLETED' | 'FAILED';

export interface ITeamsAiJobResultItem {
  target: 'chat' | 'meeting';
  meetingId?: string | null;
  summary: string;
  keyPoints: string[];
  requirements: string[];
  confidence?: number | null;
}

export interface ITeamsAiJob extends Document {
  correlationId: string;
  projectId: mongoose.Types.ObjectId;
  teamId: string;
  channelId: string;
  monitoredChannelDbId?: mongoose.Types.ObjectId | null;
  // What this payload carried (audit + idempotency traceability).
  messageIds: string[];
  meetingDbIds: string[];
  documentIds: string[];
  hasChat: boolean;
  meetingCount: number;
  status: TeamsAiJobStatus;
  readinessState?: string | null;
  results?: ITeamsAiJobResultItem[];
  sentAt: Date;
  completedAt?: Date | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ResultItemSchema = new Schema<ITeamsAiJobResultItem>(
  {
    target: { type: String, enum: ['chat', 'meeting'], required: true },
    meetingId: { type: String, default: null },
    summary: { type: String, default: '' },
    keyPoints: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    confidence: { type: Number, default: null },
  },
  { _id: false },
);

const TeamsAiJobSchema = new Schema<ITeamsAiJob>(
  {
    correlationId: { type: String, required: true, unique: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    teamId: { type: String, required: true },
    channelId: { type: String, required: true },
    monitoredChannelDbId: {
      type: Schema.Types.ObjectId,
      ref: 'TeamsMonitoredChannel',
      default: null,
    },
    messageIds: { type: [String], default: [] },
    meetingDbIds: { type: [String], default: [] },
    documentIds: { type: [String], default: [] },
    hasChat: { type: Boolean, default: false },
    meetingCount: { type: Number, default: 0 },
    status: { type: String, enum: ['SENT', 'COMPLETED', 'FAILED'], default: 'SENT' },
    readinessState: { type: String, default: null },
    results: { type: [ResultItemSchema], default: undefined },
    sentAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

TeamsAiJobSchema.index({ projectId: 1, createdAt: -1 });
TeamsAiJobSchema.index({ channelId: 1, createdAt: -1 });

export const TeamsAiJob = mongoose.model<ITeamsAiJob>('TeamsAiJob', TeamsAiJobSchema);
