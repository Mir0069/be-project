import { useState } from "react";
import { Link2, Loader2, Plus, Search } from "lucide-react";

import {
  useConnectTeamsProvisioning,
  useCreateTeamsWorkspace,
} from "@/features/projects/query/teamsQuery";
import type { TeamsProvisioningCandidate } from "@/services/teams";

import { parseAlreadyLinked } from "./provisioning";

// The human gate between discovery and anything being created or connected.
// Candidates found -> confirm one; nothing found -> create or connect manually.
export const ProvisioningDecision = ({
  projectId,
  candidates,
  onManualConnect,
}: {
  projectId: string;
  candidates: TeamsProvisioningCandidate[];
  onManualConnect: () => void;
}) => {
  const [showFallback, setShowFallback] = useState(candidates.length === 0);
  // Keyed by channel: three rows can each 409 independently, and arming one
  // must not turn the others into "Connect anyway".
  const [confirm, setConfirm] = useState<{ channelId: string; message: string } | null>(null);

  const connectMutation = useConnectTeamsProvisioning();
  const createMutation = useCreateTeamsWorkspace();

  const connect = (candidate: TeamsProvisioningCandidate, force?: boolean) => {
    connectMutation.mutate(
      {
        projectId,
        teamId: candidate.teamId,
        teamName: candidate.teamName,
        channelId: candidate.channelId,
        channelName: candidate.channelName,
        ...(force ? { force: true } : {}),
      },
      {
        onError: (err) => {
          const message = parseAlreadyLinked(err);
          if (message) setConfirm({ channelId: candidate.channelId, message });
        },
      },
    );
  };

  const busy = connectMutation.isPending || createMutation.isPending;

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <Search size={18} className="mt-0.5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800">
            {candidates.length > 0
              ? "We found this team and channel for this project. Connect it?"
              : "We could not find a team and channel for this project."}
          </p>

          {!showFallback && (
            <ul className="mt-3 space-y-2">
              {candidates.map((candidate, index) => (
                <li
                  key={`${candidate.teamId}:${candidate.channelId}`}
                  className="rounded-md border border-gray-200 bg-white px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-800">
                        {candidate.teamName}
                        {index === 0 && (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Best match
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-600">{candidate.channelName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => connect(candidate, confirm?.channelId === candidate.channelId)}
                      disabled={busy}
                      className="shrink-0 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      {connectMutation.isPending ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> Connecting…
                        </span>
                      ) : confirm?.channelId === candidate.channelId ? (
                        "Connect anyway"
                      ) : (
                        "Connect"
                      )}
                    </button>
                  </div>
                  {confirm?.channelId === candidate.channelId && (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      {confirm.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {showFallback ? (
              <>
                <button
                  type="button"
                  onClick={() => createMutation.mutate({ projectId })}
                  disabled={busy}
                  title="Creates a new private team and one channel for this project in Microsoft Teams"
                  className="inline-flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                >
                  <Plus size={14} /> Create automatically
                </button>
                <button
                  type="button"
                  onClick={onManualConnect}
                  disabled={busy}
                  title="Pick an existing team and channel from Microsoft Teams yourself. Nothing new is created."
                  className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Link2 size={14} /> Connect manually
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowFallback(true)}
                className="text-xs text-gray-600 underline hover:text-gray-800"
              >
                None of these
              </button>
            )}
          </div>

          {createMutation.isError && (
            <p className="mt-2 text-xs text-red-500">Could not start setup. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProvisioningDecision;
