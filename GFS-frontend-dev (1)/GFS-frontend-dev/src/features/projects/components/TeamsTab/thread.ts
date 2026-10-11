import type { TeamsMessage } from "@/shared/types/teams.types";

export interface TeamsThreadNode {
  root: TeamsMessage;
  replies: TeamsMessage[];
}

// Groups a flat message list into roots + replies, all in conversation order
// (oldest-first, like a chat log). The API returns messages newest-first, so we
// re-sort both roots and replies ascending. parentMessageId references a root's
// messageId (with an id fallback).
const asc = (a: TeamsMessage, b: TeamsMessage) =>
  new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime();

export const buildThreads = (messages: TeamsMessage[]): TeamsThreadNode[] => {
  const roots = messages.filter((m) => !m.parentMessageId).sort(asc);
  const byParent = new Map<string, TeamsMessage[]>();

  for (const m of messages) {
    if (!m.parentMessageId) continue;
    const list = byParent.get(m.parentMessageId) ?? [];
    list.push(m);
    byParent.set(m.parentMessageId, list);
  }

  return roots.map((root) => ({
    root,
    replies: (byParent.get(root.messageId) ?? byParent.get(root.id) ?? []).sort(asc),
  }));
};
