import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/teamsQuery", () => ({
  useMonitoredChannels: vi.fn(),
  useTeamsProvisioning: vi.fn(),
  useRemoveMonitoredChannel: vi.fn(),
  useCreateTeamsWorkspace: vi.fn(),
  useConnectTeamsProvisioning: vi.fn(),
  useTeamsTeams: vi.fn(),
  useTeamsChannels: vi.fn(),
  useAddMonitoredChannel: vi.fn(),
  MONITORED_CHANNELS_KEY: ["teams", "monitored-channels"],
  TEAMS_PROVISIONING_KEY: (id: string) => ["teams", "provisioning", id],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import {
  useMonitoredChannels,
  useTeamsProvisioning,
  useRemoveMonitoredChannel,
  useCreateTeamsWorkspace,
  useConnectTeamsProvisioning,
  useTeamsTeams,
  useTeamsChannels,
  useAddMonitoredChannel,
} from "@/features/projects/query/teamsQuery";
import { ChannelConnection } from "./ChannelConnection";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const removeMutate = vi.fn();
const createMutate = vi.fn();
const connectMutate = vi.fn();

const setState = (state: string, extra: Record<string, unknown> = {}) =>
  asMock(useTeamsProvisioning).mockReturnValue({
    data: { state, candidates: [], ...extra },
    isLoading: false,
  });

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useMonitoredChannels).mockReturnValue({ data: [] });
  asMock(useTeamsProvisioning).mockReturnValue({ data: undefined, isLoading: false });
  asMock(useRemoveMonitoredChannel).mockReturnValue({ mutate: removeMutate, isPending: false });
  asMock(useCreateTeamsWorkspace).mockReturnValue({
    mutate: createMutate,
    isPending: false,
    isError: false,
  });
  asMock(useConnectTeamsProvisioning).mockReturnValue({ mutate: connectMutate, isPending: false });
  asMock(useTeamsTeams).mockReturnValue({ data: [], isLoading: false });
  asMock(useTeamsChannels).mockReturnValue({ data: [], isLoading: false });
  asMock(useAddMonitoredChannel).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  });
});

describe("ChannelConnection", () => {
  it("shows the workspace banner with Disconnect when the channel is linked", () => {
    asMock(useMonitoredChannels).mockReturnValue({
      data: [
        {
          id: "mc1",
          teamId: "t1",
          teamName: "gfs testing team",
          channelId: "c1",
          channelName: "103 robinson st",
          projectIds: ["p1"],
          isActive: true,
        },
      ],
    });

    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText("gfs testing team / 103 robinson st")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Disconnect"));
    expect(removeMutate).toHaveBeenCalledWith({ id: "mc1", projectId: "p1" });
  });

  it("shows the banner without Disconnect when only the backend reports CONNECTED", () => {
    setState("CONNECTED", { teamName: "T", channelName: "C" });

    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText("T / C")).toBeInTheDocument();
    expect(screen.queryByText("Disconnect")).not.toBeInTheDocument();
  });

  it("shows the discovery notice while we look for an existing channel", () => {
    setState("DISCOVERING");
    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText(/Looking for an existing Teams channel/)).toBeInTheDocument();
  });

  it("keeps the mail-first setup loader for CREATING", () => {
    setState("CREATING");
    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText(/Setting up the Teams workspace/)).toBeInTheDocument();
    expect(screen.queryByText(/could not find a team and channel/)).not.toBeInTheDocument();
  });

  it("shows the failure notice with a retry that asks for creation", () => {
    setState("FAILED", { error: "graph down" });
    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText("graph down")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    expect(createMutate).toHaveBeenCalledWith({ projectId: "p1" });
  });

  it("renders the decision card when a decision is pending", () => {
    setState("AWAITING_DECISION");
    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText(/could not find a team and channel/)).toBeInTheDocument();
  });

  it("offers manual connect (never the setup loader) when there is nothing to do", () => {
    setState("NONE");
    render(<ChannelConnection projectId="p1" />);

    expect(screen.getByText("Connect a Teams channel")).toBeInTheDocument();
    expect(screen.queryByText(/Setting up the Teams workspace/)).toBeNull();
  });

  it("renders nothing on the very first paint", () => {
    asMock(useTeamsProvisioning).mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<ChannelConnection projectId="p1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("opens the manual picker from the idle state", () => {
    setState("NONE");
    render(<ChannelConnection projectId="p1" />);

    fireEvent.click(screen.getByText("Connect a Teams channel"));
    expect(screen.getByText("Connect a Teams channel", { selector: "h3" })).toBeInTheDocument();
  });
});
