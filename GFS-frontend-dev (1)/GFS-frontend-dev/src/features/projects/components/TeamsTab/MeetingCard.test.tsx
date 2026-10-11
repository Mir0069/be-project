import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/teamsQuery", () => ({
  useTeamsMeeting: vi.fn(),
}));

vi.mock("@/features/projects/query/documentsQuery", () => ({
  useDownloadUrl: vi.fn(() => ({ refetch: vi.fn(), isFetching: false })),
  // Document previews stream through the backend, so the card asks for bytes
  // rather than a storage URL.
  usePreviewDocument: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

import { useTeamsMeeting } from "@/features/projects/query/teamsQuery";
import { MeetingCard } from "./MeetingCard";
import type { TeamsMeetingSummary } from "@/shared/types/teams.types";

const meeting: TeamsMeetingSummary = {
  id: "m1",
  channelEventMessageId: "e1",
  callId: null,
  meetingId: "meet-1",
  subject: "Design review",
  startDateTime: "2026-07-01T10:00:00Z",
  teamId: "t",
  channelId: "c",
  projectId: "p",
  transcriptId: "t1",
  participantNames: ["Alice", "Bob"],
  participantCount: 2,
  messageCount: 1,
  documentCount: 1,
  hasTranscript: true,
};

describe("MeetingCard", () => {
  it("expands on click to show conversation, shared docs, and transcript", () => {
    vi.mocked(useTeamsMeeting).mockReturnValue({
      data: {
        meeting,
        conversation: [
          {
            messageId: "c1",
            parentMessageId: "e1",
            fromName: "Alice",
            fromId: "a",
            contentText: "Sharing the plan",
            createdDateTime: "2026-07-01T10:05:00Z",
            webUrl: null,
          },
        ],
        documents: [
          {
            documentId: "doc-1",
            originalName: "floor-plan.pdf",
            documentType: "drawing",
            status: "PROCESSED",
            blobUrl: "https://blob/x",
            byteSize: 10,
            source: "teams",
            sharedByName: "Alice",
            sharedAt: "2026-07-01T10:06:00Z",
            contentUrl: null,
          },
        ],
        transcript: {
          transcriptId: "t1",
          createdDateTime: null,
          text: "Good morning everyone",
          vtt: "WEBVTT",
          byteSize: 20,
          routedToPipeline: true,
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useTeamsMeeting>);

    render(<MeetingCard meeting={meeting} />);

    // Collapsed: detail is not rendered yet.
    expect(screen.queryByText("Sharing the plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Design review"));

    expect(screen.getByText("Sharing the plan")).toBeInTheDocument();
    expect(screen.getByText("floor-plan.pdf")).toBeInTheDocument();
    // Transcript is offered as a downloadable .vtt file, not inline text.
    expect(screen.getByText("Design_review-transcript.vtt")).toBeInTheDocument();
  });

  it("shows a summary badge when the meeting has an aiSummary", () => {
    vi.mocked(useTeamsMeeting).mockReturnValue({
      data: { meeting, conversation: [], documents: [], transcript: null },
      isLoading: false,
    } as unknown as ReturnType<typeof useTeamsMeeting>);

    const withSummary: TeamsMeetingSummary = {
      ...meeting,
      aiSummary: {
        summary: "Reviewed the glass stair scope.",
        keyPoints: ["Confirm load rating"],
        requirements: [],
        confidence: 0.7,
        updatedAt: "2026-07-08T10:00:00Z",
      },
    };

    render(<MeetingCard meeting={withSummary} />);
    // Badge shows in the collapsed header; the full summary now lives in the
    // consolidated "Meeting Summaries" section at the top of the tab, not here.
    expect(screen.getByText("summary")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Design review"));
    expect(screen.queryByText("Meeting Summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed the glass stair scope.")).not.toBeInTheDocument();
  });
});
