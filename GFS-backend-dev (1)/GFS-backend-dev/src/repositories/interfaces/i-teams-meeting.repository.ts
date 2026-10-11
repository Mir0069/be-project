import type { TeamsAiSummary } from '@features/teams/teams-ai.types';

export interface IDomainTeamsMeeting {
  id: string;
  channelEventMessageId: string;
  callId?: string | null;
  meetingId?: string | null;
  subject?: string | null;
  startDateTime?: Date | null;
  teamId?: string | null;
  channelId?: string | null;
  monitoredChannelDbId?: string | null;
  projectId?: string | null;
  transcriptId?: string | null;
  participantNames: string[];
  participantCount: number;
  messageCount: number;
  documentCount: number;
  hasTranscript: boolean;
  lastRecordedAt: Date;
  sentToAI: boolean;
  aiSummary: TeamsAiSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUpsertTeamsMeetingFields {
  channelEventMessageId: string;
  callId?: string | null;
  meetingId?: string | null;
  subject?: string | null;
  startDateTime?: Date | null;
  teamId?: string | null;
  channelId?: string | null;
  monitoredChannelDbId?: string | null;
  projectId?: string | null;
  transcriptId?: string | null;
  participantNames: string[];
  participantCount: number;
  messageCount: number;
  documentCount: number;
  hasTranscript: boolean;
  lastRecordedAt: Date;
}

export interface IListTeamsMeetingsFilter {
  projectId?: string;
  channelId?: string;
  // Match meetings from any of these channels (a shared channel's meetings are
  // shown to every project it's linked to).
  channelIds?: string[];
  monitoredChannelDbId?: string;
  page?: number;
  limit?: number;
}

export interface ITeamsMeetingPage {
  meetings: IDomainTeamsMeeting[];
  total: number;
}

export interface ITeamsMeetingRepository {
  upsertByChannelEventMessageId(
    fields: IUpsertTeamsMeetingFields,
  ): Promise<IDomainTeamsMeeting>;
  findById(id: string): Promise<IDomainTeamsMeeting | null>;
  list(filter: IListTeamsMeetingsFilter): Promise<ITeamsMeetingPage>;
  // Meetings on a channel not yet dispatched to the AI queue.
  listUnsentByChannelId(channelId: string): Promise<IDomainTeamsMeeting[]>;
  markSentToAI(id: string): Promise<void>;
  setAiSummary(id: string, summary: TeamsAiSummary): Promise<IDomainTeamsMeeting | null>;
}
