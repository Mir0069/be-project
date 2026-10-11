import { AlertTriangle, Link2, Loader2, Search } from "lucide-react";

// Presentational only. Every state of the Teams workspace card that is not a
// decision lives here, so ChannelConnection stays pure orchestration.

const Card = ({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) => (
  <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
    {icon}
    <div>
      <p className="text-sm font-medium text-gray-800">{title}</p>
      <p className="mt-0.5 text-xs text-gray-600">{body}</p>
    </div>
  </div>
);

export const ConnectedBanner = ({
  teamName,
  channelName,
  onDisconnect,
  isDisconnecting = false,
}: {
  teamName: string;
  channelName: string;
  onDisconnect?: () => void;
  isDisconnecting?: boolean;
}) => (
  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-2">
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <Link2 size={14} className="text-emerald-500" />
      Teams workspace:{" "}
      <span className="font-semibold">
        {teamName} / {channelName}
      </span>
    </div>
    {onDisconnect && (
      <button
        type="button"
        onClick={onDisconnect}
        disabled={isDisconnecting}
        className="text-xs text-gray-500 hover:text-red-500 disabled:opacity-50"
      >
        {isDisconnecting ? "Disconnecting…" : "Disconnect"}
      </button>
    )}
  </div>
);

export const DiscoveringNotice = () => (
  <Card
    icon={<Search size={18} className="mt-0.5 shrink-0 text-red-500" />}
    title="Looking for an existing Teams channel for this project…"
    body="We're checking your Teams workspace for a team and channel matching this project's address."
  />
);

export const CreatingNotice = () => (
  <Card
    icon={<Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-red-500" />}
    title="Setting up the Teams workspace…"
    body="A private team and channel are being created for this project. This usually takes about a minute."
  />
);

export const FailedNotice = ({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry?: () => void;
}) => (
  <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
    <div className="flex items-start gap-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
      <div>
        <p className="text-sm font-medium text-gray-800">
          We couldn't set up the Teams workspace.
        </p>
        {message && <p className="mt-0.5 text-xs text-gray-600">{message}</p>}
      </div>
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 text-xs font-medium text-red-500 hover:text-red-600"
      >
        Try again
      </button>
    )}
  </div>
);
