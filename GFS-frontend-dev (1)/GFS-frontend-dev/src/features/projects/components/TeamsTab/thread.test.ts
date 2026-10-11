import { describe, it, expect } from "vitest";

import type { TeamsMessage } from "@/shared/types/teams.types";

import { buildThreads } from "./thread";

const msg = (over: Partial<TeamsMessage>): TeamsMessage => ({
  id: "id",
  messageId: "mid",
  teamId: "t",
  channelId: "c",
  parentMessageId: null,
  fromName: "X",
  fromId: "x",
  contentText: "hi",
  createdDateTime: "2026-07-01T10:00:00Z",
  attachments: [],
  projectId: "p",
  linkMethod: null,
  routedToPipeline: false,
  ...over,
});

describe("buildThreads", () => {
  it("groups roots with replies sorted oldest-first", () => {
    const threads = buildThreads([
      msg({ id: "r1", messageId: "root-1", parentMessageId: null }),
      msg({ id: "a", messageId: "reply-a", parentMessageId: "root-1", createdDateTime: "2026-07-01T10:05:00Z" }),
      msg({ id: "b", messageId: "reply-b", parentMessageId: "root-1", createdDateTime: "2026-07-01T10:02:00Z" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.messageId).toBe("root-1");
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("falls back to matching a reply on the root's id", () => {
    const threads = buildThreads([
      msg({ id: "root-id", messageId: "mid-root", parentMessageId: null }),
      msg({ id: "c", messageId: "reply-c", parentMessageId: "root-id" }),
    ]);
    expect(threads[0]?.replies).toHaveLength(1);
  });

  it("returns roots with no replies when none reference them", () => {
    const threads = buildThreads([msg({ id: "x", messageId: "m1", parentMessageId: null })]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies).toHaveLength(0);
  });
});
