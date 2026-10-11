import mongoose, { Document, Schema } from 'mongoose';

import { TeamsAiSummarySchema, type ITeamsAiSummarySubdoc } from './teams-meeting.model';

// A Teams channel an admin has chosen to ingest from. `projectIds` are the
// explicit (manual) channel→project mappings — a channel can be shared by
// several projects, which all see the same conversation/meetings. `projectId`
// is the legacy single-link field, kept only so pre-existing rows still read.
// deltaLink is the Microsoft Graph delta cursor for incremental polling.
export interface ITeamsMonitoredChannel extends Document {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  projectIds: mongoose.Types.ObjectId[];
  projectId?: mongoose.Types.ObjectId | null;
  deltaLink?: string | null;
  isActive: boolean;
  // Accumulated AI summary of this channel's chat (written by the AI callback;
  // one channel = one project, so this is the project's Chat Summary).
  aiChatSummary?: ITeamsAiSummarySubdoc | null;
  createdAt: Date;
  updatedAt: Date;
}

const TeamsMonitoredChannelSchema = new Schema<ITeamsMonitoredChannel>(
  {
    teamId: { type: String, required: true },
    teamName: { type: String, required: true },
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    projectIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    // Legacy single-link field (superseded by projectIds); read-only fallback.
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    deltaLink: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    aiChatSummary: { type: TeamsAiSummarySchema, default: null },
  },
  { timestamps: true },
);

TeamsMonitoredChannelSchema.index({ teamId: 1, channelId: 1 }, { unique: true });
TeamsMonitoredChannelSchema.index({ isActive: 1 });

export const TeamsMonitoredChannel = mongoose.model<ITeamsMonitoredChannel>(
  'TeamsMonitoredChannel',
  TeamsMonitoredChannelSchema,
);
