import { Loader2 } from "lucide-react";

import type { TeamsMessage } from "@/shared/types/teams.types";

import { buildThreads } from "./thread";
import { MessageItem } from "./MessageItem";
import { AttachmentDocProvider } from "./attachmentDoc";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export const ConversationList = ({
  messages,
  isLoading,
  projectId,
  hasMeetings,
  importing,
}: {
  messages?: TeamsMessage[];
  isLoading?: boolean;
  projectId?: string;
  hasMeetings?: boolean;
  importing?: boolean;
}) => {
  const threads = buildThreads(messages ?? []);

  // Clear loading state: the very first fetch, or a fresh connect that is still
  // importing the channel while no messages have arrived yet.
  if (isLoading || (importing && threads.length === 0)) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <Loader2 size={16} className="animate-spin" />
        {importing
          ? "Loading conversation. This can take a moment to fully populate after connecting."
          : "Loading conversation…"}
      </div>
    );
  }

  // Guard on the built threads, not the raw list: a channel whose entire chat
  // happened inside a meeting has messages (meeting replies) but zero root
  // threads, which would otherwise render a blank section. Those replies show
  // under the meeting, so point the user there instead of implying data loss.
  if (threads.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        {hasMeetings
          ? "No channel-level messages. This channel's conversation is inside its meetings below."
          : "No Teams messages"}
      </p>
    );
  }

  return (
    <AttachmentDocProvider projectId={projectId}>
      <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {threads.map((node, i) => {
          const prev = threads[i - 1];
          // Group a root under the previous one when it's the same sender, close
          // in time, and the previous thread had no replies breaking the flow.
          const grouped =
            !!prev &&
            prev.replies.length === 0 &&
            prev.root.fromId === node.root.fromId &&
            new Date(node.root.createdDateTime).getTime() -
              new Date(prev.root.createdDateTime).getTime() <
              GROUP_WINDOW_MS;
          return <MessageItem key={node.root.id} node={node} grouped={grouped} />;
        })}
      </div>
      {importing && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" /> Still importing. More messages may
          appear shortly.
        </div>
      )}
    </AttachmentDocProvider>
  );
};

export default ConversationList;
