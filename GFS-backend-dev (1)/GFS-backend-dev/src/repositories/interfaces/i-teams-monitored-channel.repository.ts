import type { TeamsAiSummary } from '@features/teams/teams-ai.types';

export interface IDomainMonitoredChannel {
  id: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  // All projects this channel is linked to (a channel may be shared).
  projectIds: string[];
  deltaLink?: string | null;
  isActive: boolean;
  aiChatSummary: TeamsAiSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateMonitoredChannelFields {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  projectIds?: string[];
}

export interface ITeamsMonitoredChannelRepository {
  listActive(): Promise<IDomainMonitoredChannel[]>;
  findById(id: string): Promise<IDomainMonitoredChannel | null>;
  findByChannel(teamId: string, channelId: string): Promise<IDomainMonitoredChannel | null>;
  // Active channels linked to a given project (projectIds contains it).
  listByProjectId(projectId: string): Promise<IDomainMonitoredChannel[]>;
  // Bulk form of listByProjectId, so a sweep over many projects is one query.
  listByProjectIds(projectIds: string[]): Promise<IDomainMonitoredChannel[]>;
  // Insert a new monitored channel, or reactivate/refresh one that was
  // previously removed (the (teamId, channelId) pair is unique). Replaces the
  // channel's project links with the supplied set.
  upsert(fields: ICreateMonitoredChannelFields): Promise<IDomainMonitoredChannel>;
  // Remove one project from a channel's links; returns the updated row so the
  // caller can delete it entirely once no projects remain.
  removeProjectLink(id: string, projectId: string): Promise<IDomainMonitoredChannel | null>;
  updateDeltaLink(id: string, deltaLink: string | null): Promise<void>;
  // Store the AI's accumulated chat summary for this channel.
  setChatSummary(id: string, summary: TeamsAiSummary): Promise<IDomainMonitoredChannel | null>;
  // Hard-remove the row so a disconnect leaves no ghost record behind.
  deleteById(id: string): Promise<IDomainMonitoredChannel | null>;
  // Soft-disconnect: clear links + isActive=false but KEEP the row (and its
  // accumulated aiChatSummary) so a later reconnect reuses it instead of losing
  // the summary. isActive=false means it won't 409 a reconnect.
  deactivate(id: string): Promise<void>;
}
