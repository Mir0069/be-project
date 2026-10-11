import mongoose, { Document, Schema } from 'mongoose';

// A person GFS adds to a project's Microsoft Teams team, one row per project + user + team.
// teamId is null while the project has no team yet, which only happens for a recorded assigner.
export type TeamsProjectMemberStatus = 'WAITING_FOR_TEAM' | 'PENDING' | 'ADDED' | 'FAILED' | 'SKIPPED';
export type TeamsProjectMemberReason = 'ESTIMATOR' | 'ASSIGNER' | 'HEAD_OF_DIVISION';

export interface ITeamsProjectMember extends Document {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  teamId: string | null;
  reason: TeamsProjectMemberReason;
  status: TeamsProjectMemberStatus;
  attempts: number;
  lastError?: string | null;
  aadUserId?: string | null;
  invited: boolean;
  notifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TeamsProjectMemberSchema = new Schema<ITeamsProjectMember>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teamId: { type: String, default: null },
    reason: { type: String, enum: ['ESTIMATOR', 'ASSIGNER', 'HEAD_OF_DIVISION'], required: true },
    status: {
      type: String,
      enum: ['WAITING_FOR_TEAM', 'PENDING', 'ADDED', 'FAILED', 'SKIPPED'],
      default: 'PENDING',
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    aadUserId: { type: String, default: null },
    invited: { type: Boolean, default: false },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A person is added to a given team once per project, so re-syncs never duplicate work.
TeamsProjectMemberSchema.index({ projectId: 1, userId: 1, teamId: 1 }, { unique: true });
TeamsProjectMemberSchema.index({ status: 1, createdAt: 1 });
TeamsProjectMemberSchema.index({ reason: 1, projectId: 1 });

export const TeamsProjectMember = mongoose.model<ITeamsProjectMember>(
  'TeamsProjectMember',
  TeamsProjectMemberSchema,
);
