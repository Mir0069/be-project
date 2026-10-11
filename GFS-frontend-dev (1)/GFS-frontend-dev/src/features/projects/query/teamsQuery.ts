// features/projects/query/teamsQuery.ts

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  listTeamsMessages,
  listTeamsMeetings,
  getTeamsMeeting,
  getProjectAiSummary,
  listTeamsTeams,
  listTeamsChannels,
  listMonitoredChannels,
  addMonitoredChannel,
  removeMonitoredChannel,
  getTeamsProvisioning,
  connectTeamsProvisioning,
  createTeamsWorkspace,
  type AddMonitoredChannelPayload,
  type ProvisioningConnectPayload,
  type TeamsProvisioning,
  type TeamsProvisioningState,
} from "@/services/teams";

export const TEAMS_MESSAGES_KEY = (projectId: string) =>
  ["teams", "messages", projectId] as const;
export const TEAMS_MEETINGS_KEY = (projectId: string) =>
  ["teams", "meetings", projectId] as const;
export const TEAMS_MEETING_KEY = (meetingId: string) =>
  ["teams", "meeting", meetingId] as const;
export const TEAMS_AI_SUMMARY_KEY = (projectId: string) =>
  ["teams", "ai-summary", projectId] as const;

/** Channel conversation for a project. */
export const useTeamsMessages = (projectId: string | undefined) =>
  useQuery({
    queryKey: TEAMS_MESSAGES_KEY(projectId ?? ""),
    queryFn: () => listTeamsMessages(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnMount: "always",
  });

/** Meeting summaries for a project. */
export const useTeamsMeetings = (projectId: string | undefined) =>
  useQuery({
    queryKey: TEAMS_MEETINGS_KEY(projectId ?? ""),
    queryFn: () => listTeamsMeetings(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnMount: "always",
  });

/** Lazy per-meeting detail; enabled only once a meeting is expanded. */
export const useTeamsMeeting = (meetingId: string | undefined) =>
  useQuery({
    queryKey: TEAMS_MEETING_KEY(meetingId ?? ""),
    queryFn: () => getTeamsMeeting(meetingId!),
    enabled: !!meetingId,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

/** AI summaries for a project: the channel chat summary + per-meeting summaries. */
export const useProjectAiSummary = (projectId: string | undefined) =>
  useQuery({
    queryKey: TEAMS_AI_SUMMARY_KEY(projectId ?? ""),
    queryFn: () => getProjectAiSummary(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnMount: "always",
  });

// ─── Admin: channel <-> project mapping ──────────────────────────────────────

export const TEAMS_TEAMS_KEY = ["teams", "teams-list"] as const;
export const TEAMS_CHANNELS_KEY = (teamId: string) => ["teams", "channels", teamId] as const;
export const MONITORED_CHANNELS_KEY = ["teams", "monitored-channels"] as const;

/** Teams the app can see (loaded when the connect modal opens). */
export const useTeamsTeams = (enabled: boolean) =>
  useQuery({
    queryKey: TEAMS_TEAMS_KEY,
    queryFn: listTeamsTeams,
    enabled,
    staleTime: 60_000,
  });

/** Channels in the selected team. */
export const useTeamsChannels = (teamId: string | undefined) =>
  useQuery({
    queryKey: TEAMS_CHANNELS_KEY(teamId ?? ""),
    queryFn: () => listTeamsChannels(teamId!),
    enabled: !!teamId,
    staleTime: 60_000,
  });

// All monitored channels (filtered by projectId in the UI). Deliberately does
// NOT poll: useTeamsProvisioning is the single poller, so the tab never runs
// two 5s timers at once.
export const useMonitoredChannels = (enabled = true) =>
  useQuery({
    queryKey: MONITORED_CHANNELS_KEY,
    queryFn: listMonitoredChannels,
    enabled,
    staleTime: 30_000,
  });

// Connect returns before the backend finishes importing history, so re-check
// across the first ~20s instead of making the user reload.
const scheduleTeamsRefresh = (queryClient: QueryClient, projectId?: string) => {
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: MONITORED_CHANNELS_KEY });
    queryClient.invalidateQueries({ queryKey: ["teams", "messages"] });
    queryClient.invalidateQueries({ queryKey: ["teams", "meetings"] });
    queryClient.invalidateQueries({ queryKey: ["teams", "ai-summary"] });
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: TEAMS_PROVISIONING_KEY(projectId) });
    }
  };
  refresh();
  [2500, 5000, 8000, 12000, 16000, 20000].forEach((ms) => setTimeout(refresh, ms));
};

export const useAddMonitoredChannel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddMonitoredChannelPayload) => addMonitoredChannel(payload),
    onSuccess: (_channel, vars) => scheduleTeamsRefresh(queryClient, vars.projectId),
  });
};

export const useRemoveMonitoredChannel = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId?: string }) =>
      removeMonitoredChannel(id, projectId),
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: MONITORED_CHANNELS_KEY });
      if (vars.projectId) {
        queryClient.invalidateQueries({ queryKey: TEAMS_PROVISIONING_KEY(vars.projectId) });
      }
    },
  });
};

// ─── Provisioning: discover → decide → connect / create ──────────────────────

export const TEAMS_PROVISIONING_KEY = (projectId: string) =>
  ["teams", "provisioning", projectId] as const;

// Only these two states are in flight; everything else is terminal for this
// page load, so the timer must stop.
const TRANSIENT_STATES: readonly string[] = ["DISCOVERING", "CREATING"];

/** Exported as the test seam for "polling stops once the state is terminal". */
export const provisioningPollInterval = (state?: TeamsProvisioningState) =>
  state && TRANSIENT_STATES.includes(state) ? 5000 : (false as const);

export const useTeamsProvisioning = (projectId: string | undefined) =>
  useQuery({
    queryKey: TEAMS_PROVISIONING_KEY(projectId ?? ""),
    queryFn: () => getTeamsProvisioning(projectId!),
    enabled: !!projectId,
    staleTime: 0,
    refetchInterval: (query: { state: { data?: TeamsProvisioning } }) =>
      provisioningPollInterval(query.state.data?.state),
  });

export const useConnectTeamsProvisioning = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...payload }: ProvisioningConnectPayload & { projectId: string }) =>
      connectTeamsProvisioning(projectId, payload),
    onSuccess: (_channel, vars) => {
      // Repaint immediately: AWAITING_DECISION has no poll to do it for us.
      queryClient.setQueryData(
        TEAMS_PROVISIONING_KEY(vars.projectId),
        (old?: TeamsProvisioning): TeamsProvisioning => ({
          ...(old ?? { candidates: [] }),
          state: "CONNECTED",
          candidates: [],
          teamName: vars.teamName,
          channelName: vars.channelName,
        }),
      );
      scheduleTeamsRefresh(queryClient, vars.projectId);
    },
  });
};

export const useCreateTeamsWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) => createTeamsWorkspace(projectId),
    onSuccess: (_state, vars) => {
      // Seeding CREATING also re-arms the 5s poll, which AWAITING_DECISION stopped.
      queryClient.setQueryData(
        TEAMS_PROVISIONING_KEY(vars.projectId),
        (old?: TeamsProvisioning): TeamsProvisioning => ({
          ...(old ?? { candidates: [] }),
          state: "CREATING",
          candidates: [],
        }),
      );
    },
  });
};
