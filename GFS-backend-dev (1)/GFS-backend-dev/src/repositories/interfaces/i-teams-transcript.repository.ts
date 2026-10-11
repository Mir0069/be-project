import type {
  TeamsTranscriptDiscoveredVia,
  TeamsTranscriptLinkMethod,
} from '@db/models/teams-transcript.model';

export interface IDomainTeamsTranscript {
  id: string;
  transcriptId: string;
  meetingId: string;
  userId: string;
  meetingSubject?: string | null;
  meetingJoinUrl?: string | null;
  contentVtt: string;
  contentText: string;
  byteSize: number;
  transcriptCreatedDateTime?: Date | null;
  projectId?: string | null;
  linkMethod?: TeamsTranscriptLinkMethod | null;
  routedToPipeline: boolean;
  monitoredChannelDbId?: string | null;
  teamId?: string | null;
  channelId?: string | null;
  discoveredVia?: TeamsTranscriptDiscoveredVia | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUpsertTeamsTranscriptFields {
  transcriptId: string;
  meetingId: string;
  userId: string;
  meetingSubject?: string | null;
  meetingJoinUrl?: string | null;
  contentVtt: string;
  contentText: string;
  byteSize: number;
  transcriptCreatedDateTime?: Date | null;
  projectId?: string | null;
  linkMethod?: TeamsTranscriptLinkMethod | null;
  routedToPipeline?: boolean;
  monitoredChannelDbId?: string | null;
  teamId?: string | null;
  channelId?: string | null;
  discoveredVia?: TeamsTranscriptDiscoveredVia | null;
  fetchedAt: Date;
}

export interface IListTeamsTranscriptsFilter {
  projectId?: string;
  meetingId?: string;
  monitoredChannelDbId?: string;
  channelId?: string;
  page?: number;
  limit?: number;
}

export interface ITeamsTranscriptPage {
  transcripts: IDomainTeamsTranscript[];
  total: number;
}

export interface ITeamsTranscriptRepository {
  upsertByTranscriptId(fields: IUpsertTeamsTranscriptFields): Promise<IDomainTeamsTranscript>;
  findByTranscriptId(transcriptId: string): Promise<IDomainTeamsTranscript | null>;
  list(filter: IListTeamsTranscriptsFilter): Promise<ITeamsTranscriptPage>;
  setProject(
    transcriptId: string,
    projectId: string,
    linkMethod: TeamsTranscriptLinkMethod,
  ): Promise<IDomainTeamsTranscript | null>;
  markRoutedToPipeline(transcriptId: string): Promise<void>;
}
