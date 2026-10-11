import type { ReactNode } from "react";

export const formatChatTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

// Teams system messages (e.g. "Scheduled a meeting") have no human sender —
// show them as "Teams" instead of a confusing "Unknown".
export const senderLabel = (fromName?: string | null, fromId?: string | null): string =>
  fromName || (fromId ? "Unknown" : "Teams");

const initials = (name?: string | null): string => {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
};

// Deterministic soft avatar colour so each sender reads consistently.
const AVATAR_COLORS = [
  "bg-rose-100 text-rose-600",
  "bg-sky-100 text-sky-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-violet-100 text-violet-600",
  "bg-teal-100 text-teal-600",
];
const colorFor = (key?: string | null): string => {
  const s = key || "?";
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) sum += s.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
};

export const Avatar = ({ name }: { name?: string | null }) => (
  <div
    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${colorFor(name)}`}
  >
    {initials(name)}
  </div>
);

/** One chat row (avatar + name + timed bubble). `grouped` hides the avatar +
 *  name header for consecutive messages from the same sender, Slack/Teams style.
 *  `children` renders under the bubble (e.g. attachment chips). */
export const ChatBubble = ({
  fromName,
  fromId,
  contentText,
  createdDateTime,
  grouped = false,
  children,
}: {
  fromName?: string | null;
  fromId?: string | null;
  contentText?: string | null;
  createdDateTime: string;
  grouped?: boolean;
  children?: ReactNode;
}) => {
  const name = senderLabel(fromName, fromId);
  return (
    <div className="flex gap-2.5">
      <div className="w-8 shrink-0">{!grouped && <Avatar name={name} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-800">{name}</span>
            <span className="text-[11px] text-gray-400">{formatChatTime(createdDateTime)}</span>
          </div>
        )}
        {contentText && (
          <div className="inline-block max-w-full whitespace-pre-line break-words rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-1.5 text-sm leading-relaxed text-gray-700">
            {contentText}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export default ChatBubble;
