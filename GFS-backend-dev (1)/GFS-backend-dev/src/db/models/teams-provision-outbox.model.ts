import mongoose, { Document, Schema } from 'mongoose';

// A durable job to auto-provision a Microsoft Teams team + channel for a
// project. Enqueued (one row per project) when a project is created via the
// Zoho/mail-first path, then drained by the Teams poller. The teamId /
// operationId / channelId checkpoints make a retry RESUMABLE: a crash after the
// team was created won't create a duplicate team on the next drain.
// Zoho-created projects park in AWAITING_DECISION with discovered candidates
// until a human connects one or asks us to create; mail-first goes straight to
// CREATING. Only PENDING and CREATING are drained, which is what guarantees
// nothing is created or connected without a person.
export type TeamsProvisionStatus = 'PENDING' | 'AWAITING_DECISION' | 'CREATING' | 'DONE' | 'FAILED';
export type TeamsProvisionMode = 'DISCOVER' | 'CREATE';
export type TeamsProvisionDecision = 'CREATE' | 'CONNECT';

export interface ITeamsProvisionCandidate {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  score: number;
  reason: string;
}

export interface ITeamsProvisionOutbox extends Document {
  projectId: mongoose.Types.ObjectId;
  projectName: string;
  teamName: string;
  channelName: string;
  status: TeamsProvisionStatus;
  attempts: number;
  lastError?: string | null;
  // Progress checkpoints (null until that step completes).
  teamId?: string | null;
  operationId?: string | null;
  channelId?: string | null;
  // Discovery + decision (null/empty on legacy rows and on the create path).
  mode?: TeamsProvisionMode | null;
  candidates: ITeamsProvisionCandidate[];
  discoveredAt?: Date | null;
  discoveryError?: string | null;
  decision?: TeamsProvisionDecision | null;
  decidedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CandidateSchema = new Schema<ITeamsProvisionCandidate>(
  {
    teamId: { type: String, required: true },
    teamName: { type: String, required: true },
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    score: { type: Number, required: true },
    reason: { type: String, required: true },
  },
  { _id: false },
);

const TeamsProvisionOutboxSchema = new Schema<ITeamsProvisionOutbox>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    projectName: { type: String, required: true },
    teamName: { type: String, required: true },
    channelName: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'AWAITING_DECISION', 'CREATING', 'DONE', 'FAILED'],
      default: 'PENDING',
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    teamId: { type: String, default: null },
    operationId: { type: String, default: null },
    channelId: { type: String, default: null },
    mode: { type: String, enum: ['DISCOVER', 'CREATE'], default: null },
    candidates: { type: [CandidateSchema], default: [] },
    discoveredAt: { type: Date, default: null },
    discoveryError: { type: String, default: null },
    decision: { type: String, enum: ['CREATE', 'CONNECT'], default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Drain order.
TeamsProvisionOutboxSchema.index({ status: 1, createdAt: 1 });
// At most one provisioning job per project (idempotent enqueue).
TeamsProvisionOutboxSchema.index({ projectId: 1 }, { unique: true });

export const TeamsProvisionOutbox = mongoose.model<ITeamsProvisionOutbox>(
  'TeamsProvisionOutbox',
  TeamsProvisionOutboxSchema,
);
