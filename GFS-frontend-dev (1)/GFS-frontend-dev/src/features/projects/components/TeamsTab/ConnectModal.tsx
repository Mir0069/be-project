import { useState } from "react";
import { Loader2, X } from "lucide-react";

import {
  useTeamsTeams,
  useTeamsChannels,
  useAddMonitoredChannel,
} from "@/features/projects/query/teamsQuery";
import { SearchableSelect } from "./SearchableSelect";
import { parseAlreadyLinked } from "./provisioning";

export const ConnectModal = ({
  projectId,
  onClose,
  onConnected,
}: {
  projectId: string;
  onClose: () => void;
  onConnected?: () => void;
}) => {
  const [teamId, setTeamId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const { data: teams, isLoading: teamsLoading } = useTeamsTeams(true);
  const { data: channels, isLoading: channelsLoading } = useTeamsChannels(teamId || undefined);
  const addMutation = useAddMonitoredChannel();

  const team = teams?.find((t) => t.id === teamId);
  const channel = channels?.find((c) => c.id === channelId);

  const payload = (force?: boolean) => ({
    teamId: team!.id,
    teamName: team!.displayName,
    channelId: channel!.id,
    channelName: channel!.displayName,
    projectId,
    ...(force ? { force: true } : {}),
  });

  // Fires the "just connected" signal (starts the importing indicator) then
  // closes the modal.
  const finishConnected = () => {
    onConnected?.();
    onClose();
  };

  const submit = () => {
    if (!team || !channel) return;
    setConfirmMsg(null);
    addMutation.mutate(payload(), {
      onSuccess: finishConnected,
      onError: (err) => {
        const msg = parseAlreadyLinked(err);
        if (msg) setConfirmMsg(msg); // switch to "connect anyway?" instead of a hard error
      },
    });
  };

  // User confirmed sharing a channel already linked elsewhere.
  const confirmConnect = () => {
    if (!team || !channel) return;
    addMutation.mutate(payload(true), { onSuccess: finishConnected });
  };

  const connectingLabel = (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 size={14} className="animate-spin" /> Connecting…
    </span>
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Connect a Teams channel</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} className="text-gray-400 hover:text-gray-600" />
          </button>
        </div>

        <label className="block text-sm text-gray-600 mb-1">Team</label>
        <div className="mb-4">
          <SearchableSelect
            label="Team"
            value={teamId}
            options={(teams ?? []).map((t) => ({ id: t.id, label: t.displayName }))}
            placeholder="Select a team"
            loadingText="Loading teams…"
            isLoading={teamsLoading}
            disabled={addMutation.isPending}
            onChange={(id) => {
              setTeamId(id);
              setChannelId("");
              setConfirmMsg(null);
            }}
          />
        </div>

        <label className="block text-sm text-gray-600 mb-1">Channel</label>
        <SearchableSelect
          label="Channel"
          value={channelId}
          options={(channels ?? []).map((c) => ({ id: c.id, label: c.displayName }))}
          placeholder="Select a channel"
          loadingText="Loading channels…"
          isLoading={channelsLoading}
          disabled={!teamId || addMutation.isPending}
          disabledPlaceholder="Select a team first"
          onChange={(id) => {
            setChannelId(id);
            setConfirmMsg(null);
          }}
        />

        {addMutation.isPending ? (
          <div className="mt-3 flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
            <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-red-500" />
            <div>
              <p className="text-sm font-medium text-gray-800">
                Connecting to Teams…
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                We're importing this channel's history (messages, meetings, and
                transcripts) in the background. It'll appear here in a few
                seconds.
              </p>
            </div>
          </div>
        ) : confirmMsg ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-700">{confirmMsg}</p>
          </div>
        ) : addMutation.isError ? (
          <p className="text-xs text-red-500 mt-2">Could not connect. Please try again.</p>
        ) : null}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          {confirmMsg ? (
            <button
              type="button"
              onClick={confirmConnect}
              disabled={addMutation.isPending}
              className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
            >
              {addMutation.isPending ? connectingLabel : "Connect anyway"}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!channelId || addMutation.isPending}
              className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
            >
              {addMutation.isPending ? connectingLabel : "Connect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectModal;
