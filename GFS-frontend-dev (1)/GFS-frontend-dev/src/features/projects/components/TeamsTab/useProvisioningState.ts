// features/projects/components/TeamsTab/useProvisioningState.ts

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  MONITORED_CHANNELS_KEY,
  useMonitoredChannels,
  useTeamsProvisioning,
} from "@/features/projects/query/teamsQuery";

import { deriveProvisioningView, isChannelForProject, type ProvisioningView } from "./provisioning";

/** Wires the two queries and reduces them to one view for the workspace card. */
export const useProvisioningState = (
  projectId: string,
): { view: ProvisioningView; monitoredId: string | null } => {
  const queryClient = useQueryClient();
  const { data: provisioning, isLoading } = useTeamsProvisioning(projectId);
  const { data: monitored } = useMonitoredChannels(true);

  const connectedChannel = (monitored ?? []).find((c) => isChannelForProject(c, projectId));
  const view = deriveProvisioningView({ provisioning, connectedChannel, isLoading });

  // The provisioning poll sees CONNECTED before the shared channel list does;
  // pull the list forward once so the tab's sections unlock. Keyed by project
  // so switching projects re-arms it instead of latching.
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    const mark = `${projectId}:${provisioning?.state}`;
    if (provisioning?.state !== "CONNECTED" || connectedChannel || syncedRef.current === mark) return;
    syncedRef.current = mark;
    queryClient.invalidateQueries({ queryKey: MONITORED_CHANNELS_KEY });
  }, [projectId, provisioning?.state, connectedChannel, queryClient]);

  return { view, monitoredId: connectedChannel?.id ?? null };
};

export default useProvisioningState;
