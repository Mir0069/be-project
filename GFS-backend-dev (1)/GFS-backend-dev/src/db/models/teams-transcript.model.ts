import mongoose, { Document, Schema } from 'mongoose';

export type TeamsTranscriptLinkMethod = 'AUTO' | 'MANUAL';
export type TeamsTranscriptDiscoveredVia = 'MANUAL' | 'CHANNEL_EVENT';

export interface ITeamsTranscript extends Document {
  transcriptId: string;
  meetingId: string;
  // The user (organizer/attendee) under whose context Graph returned the
  // transcript. Required because the Graph endpoint is /users/{userId}/...
  userId: string;
  meetingSubject?: string | null;
  meetingJoinUrl?: string | null;
  // Raw transcript as returned by Graph (default VTT format).
  contentVtt: string;
  // VTT stripped of timing cues — useful for keyword association.
  contentText: string;
  byteSize: number;
  transcriptCreatedDateTime?: Date | null;
  projectId?: mongoose.Types.ObjectId | null;
  linkMethod?: TeamsTranscriptLinkMethod | null;
  routedToPipeline: boolean;
  // Channel context — populated when the transcript was discovered from a
  // meeting event in a monitored channel. Lets us query "all transcripts for
  // project/channel X" deterministically.
  monitoredChannelDbId?: mongoose.Types.ObjectId | null;
  teamId?: string | null;
  channelId?: string | null;
  discoveredVia?: TeamsTranscriptDiscoveredVia | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TeamsTranscriptSchema = new Schema<ITeamsTranscript>(
  {
    transcriptId: { type: String, required: true, unique: true },
    meetingId: { type: String, required: true },
    userId: { type: String, required: true },
    meetingSubject: { type: String, default: null },
    meetingJoinUrl: { type: String, default: null },
    contentVtt: { type: String, default: '' },
    contentText: { type: String, default: '' },
    byteSize: { type: Number, default: 0 },
    transcriptCreatedDateTime: { type: Date, default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    linkMethod: { type: String, enum: ['AUTO', 'MANUAL'], default: null },
    routedToPipeline: { type: Boolean, default: false },
    monitoredChannelDbId: {
      type: Schema.Types.ObjectId,
      ref: 'TeamsMonitoredChannel',
      default: null,
    },
    teamId: { type: String, default: null },
    channelId: { type: String, default: null },
    discoveredVia: { type: String, enum: ['MANUAL', 'CHANNEL_EVENT'], default: null },
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

TeamsTranscriptSchema.index({ meetingId: 1 });
TeamsTranscriptSchema.index({ projectId: 1 });
TeamsTranscriptSchema.index({ monitoredChannelDbId: 1, transcriptCreatedDateTime: -1 });

export const TeamsTranscript = mongoose.model<ITeamsTranscript>(
  'TeamsTranscript',
  TeamsTranscriptSchema,
);
