import type { TeamsAiJobStatus, ITeamsAiJobResultItem } from '@db/models/teams-ai-job.model';

export interface IDomainTeamsAiJob {
  id: string;
  correlationId: string;
  projectId: string;
  teamId: string;
  channelId: string;
  monitoredChannelDbId: string | null;
  messageIds: string[];
  meetingDbIds: string[];
  documentIds: string[];
  hasChat: boolean;
  meetingCount: number;
  status: TeamsAiJobStatus;
  readinessState: string | null;
  results: ITeamsAiJobResultItem[];
  sentAt: Date;
  completedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateTeamsAiJobFields {
  projectId: string;
  teamId: string;
  channelId: string;
  monitoredChannelDbId?: string | null;
  messageIds: string[];
  meetingDbIds: string[];
  documentIds: string[];
  hasChat: boolean;
  meetingCount: number;
  sentAt: Date;
}

export interface ICompleteTeamsAiJobFields {
  readinessState?: string | null;
  results: ITeamsAiJobResultItem[];
}

export interface ITeamsAiJobRepository {
  // Creates the job with a generated _id and correlationId "teamsAiJob:<_id>".
  create(fields: ICreateTeamsAiJobFields): Promise<IDomainTeamsAiJob>;
  findById(id: string): Promise<IDomainTeamsAiJob | null>;
  findByCorrelationId(correlationId: string): Promise<IDomainTeamsAiJob | null>;
  complete(id: string, fields: ICompleteTeamsAiJobFields): Promise<IDomainTeamsAiJob | null>;
  markFailed(id: string, error: string): Promise<void>;
}
