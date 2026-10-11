import { useState } from "react";
import { Plus } from "lucide-react";

import {
  useCreateTeamsWorkspace,
  useRemoveMonitoredChannel,
} from "@/features/projects/query/teamsQuery";

import { ConnectModal } from "./ConnectModal";
import { ProvisioningDecision } from "./ProvisioningDecision";
import {
  ConnectedBanner,
  CreatingNotice,
  DiscoveringNotice,
  FailedNotice,
} from "./ProvisioningNotices";
import { useProvisioningState } from "./useProvisioningState";

// Reflects the project's Teams workspace and owns the one decision a user can
// make. Zoho projects park here awaiting a human; mail-first ones only pass
// through the "creating" state.
export const ChannelConnection = ({
  projectId,
  onConnected,
}: {
  projectId: string;
  onConnected?: () => void;
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const { view, monitoredId } = useProvisioningState(projectId);
  const removeMutation = useRemoveMonitoredChannel();
  const createMutation = useCreateTeamsWorkspace();

  const modal = modalOpen && (
    <ConnectModal
      projectId={projectId}
      onClose={() => setModalOpen(false)}
      onConnected={onConnected}
    />
  );

  switch (view.kind) {
    case "loading":
      return null;

    case "connected":
      return (
        <ConnectedBanner
          teamName={view.teamName}
          channelName={view.channelName}
          isDisconnecting={removeMutation.isPending}
          onDisconnect={
            monitoredId ? () => removeMutation.mutate({ id: monitoredId, projectId }) : undefined
          }
        />
      );

    case "discovering":
      return <DiscoveringNotice />;

    case "creating":
      return <CreatingNotice />;

    case "failed":
      return (
        <FailedNotice
          message={view.message}
          onRetry={() => createMutation.mutate({ projectId })}
        />
      );

    case "deciding":
      return (
        <>
          <ProvisioningDecision
            projectId={projectId}
            candidates={view.candidates}
            onManualConnect={() => setModalOpen(true)}
          />
          {modal}
        </>
      );

    default:
      return (
        <>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            <Plus size={14} /> Connect a Teams channel
          </button>
          {modal}
        </>
      );
  }
};

export default ChannelConnection;
