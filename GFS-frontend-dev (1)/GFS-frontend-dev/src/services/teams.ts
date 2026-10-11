// services/teams.ts
// Wraps the Teams messages + meetings endpoints.

import { apiClient } from "@/shared/api/client";
import type {
  TeamsMessage,
  TeamsMessagesResponse,
  TeamsMeetingSummary,
  TeamsMeetingsResponse,
  TeamsMeetingDetail,
  TeamsProjectAiSummary,
} from "@/shared/types/teams.types";

export interface TeamsMessagesParams {
  channelId?: string;
  page?: number;
  limit?: number;
}

/** GET /teams/messages?projectId=&channelId=&page=&limit= */
export const listTeamsMessages = async (
  projectId: string,
  params?: TeamsMessagesParams
): Promise<TeamsMessage[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: TeamsMessagesResponse }>(
    `/teams/messages`,
    { params: { projectId, ...params } }
  );
  return data.data?.messages ?? [];
};

/** GET /teams/meetings?projectId= */
export const listTeamsMeetings = async (
  projectId: string
): Promise<TeamsMeetingSummary[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: TeamsMeetingsResponse }>(
    `/teams/meetings`,
    { params: { projectId } }
  );
  return data.data?.meetings ?? [];
};

/** GET /teams/meetings/:id — conversation + shared documents + transcript */
export const getTeamsMeeting = async (
  meetingId: string
): Promise<TeamsMeetingDetail> => {
  const { data } = await apiClient.get<{ success: boolean; data: TeamsMeetingDetail }>(
    `/teams/meetings/${meetingId}`
  );
  return data.data;
};

/** GET /teams/projects/:projectId/ai-summary — chat summary + per-meeting summaries */
export const getProjectAiSummary = async (
  projectId: string
): Promise<TeamsProjectAiSummary> => {
  const { data } = await apiClient.get<{ success: boolean; data: TeamsProjectAiSummary }>(
    `/teams/projects/${projectId}/ai-summary`
  );
  return data.data ?? { chat: null, meetings: [] };
};

// ─── Admin: channel <-> project mapping ──────────────────────────────────────

export interface TeamsTeam {
  id: string;
  displayName: string;
}

export interface TeamsChannel {
  id: string;
  displayName: string;
  membershipType?: string;
}

export interface MonitoredChannel {
  id: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  // A channel can be shared by several projects.
  projectIds: string[];
  isActive: boolean;
}

export interface AddMonitoredChannelPayload {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  projectId: string;
  // Opt in to sharing a channel already linked to another project.
  force?: boolean;
}

/** Shape of a 409 "already linked to another project" response. */
export interface AlreadyLinkedError {
  alreadyLinked: true;
  message: string;
  linkedProjects: Array<{ id: string; referenceNumber?: string; projectName?: string }>;
}

/** GET /teams/teams */
export const listTeamsTeams = async (): Promise<TeamsTeam[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: { teams: TeamsTeam[] } }>(
    `/teams/teams`
  );
  return data.data?.teams ?? [];
};

/** GET /teams/teams/:teamId/channels */
export const listTeamsChannels = async (teamId: string): Promise<TeamsChannel[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: { channels: TeamsChannel[] } }>(
    `/teams/teams/${teamId}/channels`
  );
  return data.data?.channels ?? [];
};

/** GET /teams/monitored-channels */
export const listMonitoredChannels = async (): Promise<MonitoredChannel[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: { channels: MonitoredChannel[] } }>(
    `/teams/monitored-channels`
  );
  return data.data?.channels ?? [];
};

/** POST /teams/monitored-channels — pins the channel to the project (CHANNEL_MAP). */
export const addMonitoredChannel = async (
  payload: AddMonitoredChannelPayload
): Promise<MonitoredChannel> => {
  const { data } = await apiClient.post<{ success: boolean; data: { channel: MonitoredChannel } }>(
    `/teams/monitored-channels`,
    payload
  );
  return data.data.channel;
};

/** DELETE /teams/monitored-channels/:id — unlink only `projectId` from a shared channel. */
export const removeMonitoredChannel = async (id: string, projectId?: string): Promise<void> => {
  await apiClient.delete(`/teams/monitored-channels/${id}`, {
    params: projectId ? { projectId } : undefined,
  });
};

// ─── Auto-provisioning: discover → decide → connect / create ─────────────────

export type TeamsProvisioningState =
  | "DISCOVERING"
  | "AWAITING_DECISION"
  | "CREATING"
  | "CONNECTED"
  | "FAILED"
  | "NONE";

export interface TeamsProvisioningCandidate {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  score: number;
  reason?: string;
  // Non-empty means connecting needs `force` (already on another project).
  linkedProjectIds?: string[];
}

export interface TeamsProvisioning {
  state: TeamsProvisioningState;
  candidates: TeamsProvisioningCandidate[];
  teamName?: string | null;
  channelName?: string | null;
  error?: string | null;
}

// Connecting a discovered candidate is the same operation as a manual connect,
// minus projectId (it lives in the path).
export type ProvisioningConnectPayload = Omit<AddMonitoredChannelPayload, "projectId">;

/** GET /teams/provisioning/projects/:projectId */
export const getTeamsProvisioning = async (projectId: string): Promise<TeamsProvisioning> => {
  const { data } = await apiClient.get<{ success: boolean; data: TeamsProvisioning }>(
    `/teams/provisioning/projects/${projectId}`
  );
  return data.data ?? { state: "NONE", candidates: [] };
};

/** POST /teams/provisioning/projects/:projectId/connect — links a discovered channel. */
export const connectTeamsProvisioning = async (
  projectId: string,
  payload: ProvisioningConnectPayload
): Promise<MonitoredChannel> => {
  const { data } = await apiClient.post<{
    success: boolean;
    data: { channel: MonitoredChannel; state: TeamsProvisioning };
  }>(`/teams/provisioning/projects/${projectId}/connect`, payload);
  return data.data.channel;
};

/** POST /teams/provisioning/projects/:projectId/create — creates the workspace. */
export const createTeamsWorkspace = async (projectId: string): Promise<TeamsProvisioning> => {
  const { data } = await apiClient.post<{ success: boolean; data: TeamsProvisioning }>(
    `/teams/provisioning/projects/${projectId}/create`
  );
  return data.data ?? { state: "CREATING", candidates: [] };
};
