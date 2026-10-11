import type { TeamsMessage } from "@/shared/types/teams.types";

import type { TeamsThreadNode } from "./thread";
import { AttachmentChip } from "./AttachmentChip";
import { ChatBubble } from "./ChatBubble";

const ChatRow = ({ message, grouped }: { message: TeamsMessage; grouped: boolean }) => (
  <ChatBubble
    fromName={message.fromName}
    fromId={message.fromId}
    contentText={message.contentText}
    createdDateTime={message.createdDateTime}
    grouped={grouped}
  >
    {message.attachments.length > 0 && (
      <div className="mt-1.5 flex flex-wrap gap-2">
        {message.attachments.map((a) => (
          <AttachmentChip key={a.id} attachment={a} messageId={message.messageId} />
        ))}
      </div>
    )}
  </ChatBubble>
);

export const MessageItem = ({
  node,
  grouped = false,
}: {
  node: TeamsThreadNode;
  grouped?: boolean;
}) => (
  <div className="space-y-1">
    <ChatRow message={node.root} grouped={grouped} />
    {node.replies.length > 0 && (
      <div className="ml-10 space-y-1 border-l-2 border-gray-100 pl-3">
        {node.replies.map((reply, i) => (
          <ChatRow
            key={reply.id}
            message={reply}
            grouped={i > 0 && node.replies[i - 1].fromId === reply.fromId}
          />
        ))}
      </div>
    )}
  </div>
);

export default MessageItem;
