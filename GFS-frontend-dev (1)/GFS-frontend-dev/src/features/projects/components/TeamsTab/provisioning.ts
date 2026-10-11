// features/projects/components/TeamsTab/provisioning.ts
// Pure state derivation for the Teams workspace card. No React, no queries.

import type {
  MonitoredChannel,
  TeamsProvisioning,
  TeamsProvisioningCandidate,
} from "@/services/teams";

// Reads the backend 409 "already linked to another project" message, if present.
// The axios interceptor reshapes errors to { status, message, data }, where
// `data` is the raw backend body ({ error: { message, details } }).
export const parseAlreadyLinked = (err: unknown): string | null => {
  const e = err as {
    message?: string;
    data?: { error?: { message?: string; details?: { alreadyLinked?: boolean } } };
  };
  const backendError = e?.data?.error;
  if (backendError?.details?.alreadyLinked) {
    return (
      backendError.message ??
      e.message ??
      "This channel is already connected to another project."
    );
  }
  return null;
};

export type ProvisioningView =
  | { kind: "loading" }
  | { kind: "connected"; teamName: string; channelName: string; monitoredId: string | null }
  | { kind: "discovering" }
  | { kind: "deciding"; candidates: TeamsProvisioningCandidate[] }
  | { kind: "creating" }
  | { kind: "failed"; message: string | null }
  | { kind: "idle" };

export interface DeriveArgs {
  provisioning?: TeamsProvisioning;
  connectedChannel?: MonitoredChannel;
  isLoading: boolean;
}

/** True when this channel is live and carries this project. */
export const isChannelForProject = (channel: MonitoredChannel, projectId: string): boolean =>
  channel.isActive && channel.projectIds.includes(projectId);

export const deriveProvisioningView = ({
  provisioning,
  connectedChannel,
  isLoading,
}: DeriveArgs): ProvisioningView => {
  // The monitored-channels list wins over the backend state: the tab gates its
  // Conversation/Meetings sections on the same list, so the banner can never
  // contradict what is rendered below it.
  if (connectedChannel) {
    return {
      kind: "connected",
      teamName: connectedChannel.teamName,
      channelName: connectedChannel.channelName,
      monitoredId: connectedChannel.id,
    };
  }

  if (provisioning?.state === "CONNECTED") {
    // The poll saw the link before the shared list refetched. No Disconnect
    // until the list catches up and gives us a monitored id.
    return {
      kind: "connected",
      teamName: provisioning.teamName ?? "",
      channelName: provisioning.channelName ?? "",
      monitoredId: null,
    };
  }

  if (!provisioning) return isLoading ? { kind: "loading" } : { kind: "idle" };

  switch (provisioning.state) {
    case "DISCOVERING":
      return { kind: "discovering" };
    case "CREATING":
      return { kind: "creating" };
    case "FAILED":
      return { kind: "failed", message: provisioning.error ?? null };
    case "AWAITING_DECISION":
      return {
        kind: "deciding",
        candidates: [...(provisioning.candidates ?? [])].sort((a, b) => b.score - a.score),
      };
    default:
      return { kind: "idle" };
  }
};
