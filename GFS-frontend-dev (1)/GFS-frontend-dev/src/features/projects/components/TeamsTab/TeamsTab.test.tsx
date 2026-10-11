import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock every teamsQuery hook TeamsTab / ChannelConnection / MeetingCard use.
vi.mock("@/features/projects/query/teamsQuery", () => ({
  useTeamsMeeting: vi.fn(() => ({ data: undefined, isLoading: false })),
  useMonitoredChannels: vi.fn(() => ({ data: [], isLoading: false })),
  useProjectAiSummary: vi.fn(() => ({ data: undefined, isLoading: false })),
  useRemoveMonitoredChannel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useTeamsTeams: vi.fn(() => ({ data: [], isLoading: false })),
  useTeamsChannels: vi.fn(() => ({ data: [], isLoading: false })),
  useAddMonitoredChannel: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
  useTeamsProvisioning: vi.fn(() => ({ data: undefined, isLoading: false })),
  useConnectTeamsProvisioning: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateTeamsWorkspace: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
  MONITORED_CHANNELS_KEY: ["teams", "monitored-channels"],
  TEAMS_PROVISIONING_KEY: (id: string) => ["teams", "provisioning", id],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Attachment chips resolve their ingested document via these.
vi.mock("@/features/projects/query/documentsQuery", () => ({
  useDocuments: vi.fn(() => ({ data: [], isLoading: false })),
  useDownloadUrl: vi.fn(() => ({ refetch: vi.fn(), isFetching: false })),
  // Attachment chips stream bytes through the backend instead of opening a
  // storage URL, so the chip needs this mutation.
  usePreviewDocument: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

import {
  useMonitoredChannels,
  useProjectAiSummary,
  useTeamsProvisioning,
} from "@/features/projects/query/teamsQuery";
import TeamsTab from "./index";
import type { TeamsMessage, TeamsMeetingSummary } from "@/shared/types/teams.types";

const asMonitored = useMonitoredChannels as unknown as ReturnType<typeof vi.fn>;
const asAiSummary = useProjectAiSummary as unknown as ReturnType<typeof vi.fn>;
const asProvisioning = useTeamsProvisioning as unknown as ReturnType<typeof vi.fn>;

const provisioningState = (state: string, candidates: unknown[] = []) => ({
  data: { state, candidates },
  isLoading: false,
});

const CONNECTED = {
  data: [
    {
      id: "mc1",
      teamId: "t",
      teamName: "gfs testing team",
      channelId: "c",
      channelName: "103 robinson st",
      projectIds: ["p1"],
      isActive: true,
    },
  ],
  isLoading: false,
};

const message = (over: Partial<TeamsMessage>): TeamsMessage => ({
  id: "id",
  messageId: "mid",
  teamId: "t",
  channelId: "c",
  parentMessageId: null,
  fromName: "Jane",
  fromId: "j",
  contentText: "hi",
  createdDateTime: "2026-07-01T10:00:00Z",
  attachments: [],
  projectId: "p1",
  linkMethod: null,
  routedToPipeline: false,
  ...over,
});

const meeting = (over: Partial<TeamsMeetingSummary>): TeamsMeetingSummary => ({
  id: "m1",
  channelEventMessageId: "e1",
  callId: null,
  meetingId: "meet-1",
  subject: "Kickoff call",
  startDateTime: "2026-07-01T10:00:00Z",
  teamId: "t",
  channelId: "c",
  projectId: "p1",
  transcriptId: null,
  participantNames: [],
  participantCount: 0,
  messageCount: 0,
  documentCount: 0,
  hasTranscript: false,
  ...over,
});

describe("TeamsTab — when a channel is connected", () => {
  beforeEach(() => {
    asMonitored.mockReturnValue(CONNECTED);
    asAiSummary.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("shows the chat summary when present, and hides the card until the AI produces one", () => {
    const { rerender } = render(<TeamsTab projectId="p1" messages={[]} meetings={[]} />);
    // The Chat Summary card is not rendered at all until there is AI content.
    expect(screen.queryByText("Chat Summary")).not.toBeInTheDocument();

    asAiSummary.mockReturnValue({
      data: {
        chat: {
          summary: "Client wants walkable glass stairs.",
          keyPoints: ["Load rating needed"],
          requirements: ["Share diagrams"],
          confidence: 0.8,
          updatedAt: "2026-07-08T10:00:00Z",
        },
        meetings: [],
      },
      isLoading: false,
    });
    rerender(<TeamsTab projectId="p1" messages={[]} meetings={[]} />);
    expect(screen.getByText("Client wants walkable glass stairs.")).toBeInTheDocument();
    expect(screen.getByText("Load rating needed")).toBeInTheDocument();
    expect(screen.getByText("Share diagrams")).toBeInTheDocument();
  });

  it("consolidates every meeting's summary into one Meeting Summaries section", () => {
    asAiSummary.mockReturnValue({
      data: {
        chat: null,
        meetings: [
          {
            meetingId: "m1",
            subject: "Glass stair review",
            startDateTime: "2026-07-01T10:00:00Z",
            hasTranscript: true,
            aiSummary: {
              summary: "Agreed on tempered glass.",
              keyPoints: ["Confirm load rating"],
              requirements: [],
              confidence: 0.7,
              updatedAt: "2026-07-08T10:00:00Z",
            },
          },
          // A meeting with no summary yet is skipped, not rendered blank.
          {
            meetingId: "m2",
            subject: "Not analyzed",
            startDateTime: null,
            hasTranscript: false,
            aiSummary: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<TeamsTab projectId="p1" messages={[]} meetings={[]} />);
    expect(screen.getByText("Meeting Summaries")).toBeInTheDocument();
    expect(screen.getByText("Glass stair review")).toBeInTheDocument();
    expect(screen.getByText("Agreed on tempered glass.")).toBeInTheDocument();
    expect(screen.getByText("Confirm load rating")).toBeInTheDocument();
    expect(screen.queryByText("Not analyzed")).not.toBeInTheDocument();
  });

  it("hides the Meeting Summaries card when no meeting has a summary", () => {
    render(<TeamsTab projectId="p1" messages={[]} meetings={[]} />);
    expect(screen.queryByText("Meeting Summaries")).not.toBeInTheDocument();
  });

  it("renders a message with author, text, and an attachment chip", () => {
    render(
      <TeamsTab
        projectId="p1"
        messages={[
          message({
            fromName: "Jane",
            contentText: "Hello team",
            attachments: [
              { id: "a1", name: "spec.pdf", contentType: "reference", contentUrl: "u", downloaded: true },
            ],
          }),
        ]}
        meetings={[]}
      />
    );
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("Hello team")).toBeInTheDocument();
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
  });

  it("renders a threaded reply under its root", () => {
    render(
      <TeamsTab
        projectId="p1"
        messages={[
          message({ id: "root", messageId: "m-root", contentText: "Parent message" }),
          message({ id: "rep", messageId: "m-rep", parentMessageId: "m-root", fromName: "Bob", contentText: "Child reply" }),
        ]}
        meetings={[]}
      />
    );
    expect(screen.getByText("Parent message")).toBeInTheDocument();
    expect(screen.getByText("Child reply")).toBeInTheDocument();
  });

  it("shows conversation empty and loading states", () => {
    const { rerender } = render(<TeamsTab projectId="p1" messages={[]} meetings={[]} />);
    expect(screen.getByText("No Teams messages")).toBeInTheDocument();
    rerender(<TeamsTab projectId="p1" messagesLoading meetings={[]} />);
    expect(screen.getByText(/Loading conversation/)).toBeInTheDocument();
  });

  it("points to the meeting when the conversation is only inside a meeting", () => {
    render(
      <TeamsTab projectId="p1" messages={[]} meetings={[meeting({ subject: "Kickoff call" })]} />
    );
    expect(screen.getByText(/conversation is inside its meetings/)).toBeInTheDocument();
  });

  it("renders a meeting with subject and participant count", () => {
    render(<TeamsTab projectId="p1" messages={[]} meetings={[meeting({ subject: "Kickoff call", participantCount: 4 })]} />);
    expect(screen.getByText("Kickoff call")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

describe("TeamsTab — before the workspace is linked", () => {
  beforeEach(() => asMonitored.mockReturnValue({ data: [], isLoading: false }));

  const renderTab = () =>
    render(
      <TeamsTab
        projectId="p1"
        messages={[message({ contentText: "should be hidden" })]}
        meetings={[meeting({})]}
      />,
    );

  it("hides the sections and shows the setup loader while creating", () => {
    asProvisioning.mockReturnValue(provisioningState("CREATING"));
    renderTab();

    expect(screen.queryByText("Conversation")).not.toBeInTheDocument();
    expect(screen.queryByText("Meetings")).not.toBeInTheDocument();
    expect(screen.queryByText("should be hidden")).not.toBeInTheDocument();
    expect(screen.getByText(/Setting up the Teams workspace/)).toBeInTheDocument();
  });

  it("keeps the sections hidden and shows the decision card instead of the loader", () => {
    asProvisioning.mockReturnValue(provisioningState("AWAITING_DECISION"));
    renderTab();

    expect(screen.queryByText("Conversation")).not.toBeInTheDocument();
    expect(screen.queryByText("Meetings")).not.toBeInTheDocument();
    expect(screen.getByText(/could not find a team and channel/)).toBeInTheDocument();
    expect(screen.queryByText(/Setting up the Teams workspace/)).toBeNull();
  });

  it("never shows a mail-first project the decision card", () => {
    asProvisioning.mockReturnValue(provisioningState("CREATING"));
    renderTab();

    expect(screen.queryByText(/could not find a team and channel/)).toBeNull();
  });
});
