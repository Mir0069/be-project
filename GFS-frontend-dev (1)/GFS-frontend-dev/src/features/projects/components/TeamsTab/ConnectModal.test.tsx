import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/teamsQuery", () => ({
  useTeamsTeams: vi.fn(),
  useTeamsChannels: vi.fn(),
  useAddMonitoredChannel: vi.fn(),
}));

import {
  useTeamsTeams,
  useTeamsChannels,
  useAddMonitoredChannel,
} from "@/features/projects/query/teamsQuery";
import { ConnectModal } from "./ConnectModal";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const addMutate = vi.fn();
const onClose = vi.fn();
const onConnected = vi.fn();

const TEAMS = [{ id: "t1", displayName: "GFS Testing Team" }];
const CHANNELS = [{ id: "c1", displayName: "103 Robinson St" }];

const setAdd = (overrides: Record<string, unknown> = {}) =>
  asMock(useAddMonitoredChannel).mockReturnValue({
    mutate: addMutate,
    isPending: false,
    isError: false,
    ...overrides,
  });

const renderModal = () =>
  render(<ConnectModal projectId="p1" onClose={onClose} onConnected={onConnected} />);

// Opens the select and clicks the option in the popup. The trigger also shows
// the label once something is selected, so take the last match.
const pick = (label: string, optionText: string) => {
  fireEvent.click(screen.getByLabelText(label));
  const matches = screen.getAllByText(optionText);
  fireEvent.click(matches[matches.length - 1]!);
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useTeamsTeams).mockReturnValue({ data: TEAMS, isLoading: false });
  asMock(useTeamsChannels).mockReturnValue({ data: CHANNELS, isLoading: false });
  setAdd();
});

describe("ConnectModal", () => {
  it("disables the channel select until a team is chosen", () => {
    renderModal();

    expect(screen.getByLabelText("Channel")).toBeDisabled();
    expect(screen.getByText("Select a team first")).toBeInTheDocument();
  });

  it("enables the channel select once a team is chosen", () => {
    renderModal();

    pick("Team", "GFS Testing Team");

    expect(screen.getByLabelText("Channel")).not.toBeDisabled();
  });

  it("clears the chosen channel when the team changes", () => {
    renderModal();
    pick("Team", "GFS Testing Team");
    pick("Channel", "103 Robinson St");
    expect(screen.getByLabelText("Channel")).toHaveTextContent("103 Robinson St");

    pick("Team", "GFS Testing Team");

    expect(screen.getByLabelText("Channel")).toHaveTextContent("Select a channel");
  });

  it("connects with the picked team and channel, without force", () => {
    renderModal();
    pick("Team", "GFS Testing Team");
    pick("Channel", "103 Robinson St");

    fireEvent.click(screen.getByText("Connect"));

    expect(addMutate).toHaveBeenCalledWith(
      {
        teamId: "t1",
        teamName: "GFS Testing Team",
        channelId: "c1",
        channelName: "103 Robinson St",
        projectId: "p1",
      },
      expect.anything(),
    );
  });

  it("offers Connect anyway on an already-linked 409, then retries with force", () => {
    addMutate.mockImplementation((_payload, opts) => {
      opts.onError?.({
        data: { error: { message: "Already on 7 Maple Ave.", details: { alreadyLinked: true } } },
      });
    });
    renderModal();
    pick("Team", "GFS Testing Team");
    pick("Channel", "103 Robinson St");

    fireEvent.click(screen.getByText("Connect"));
    expect(screen.getByText("Already on 7 Maple Ave.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Connect anyway"));

    expect(addMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
      expect.anything(),
    );
  });

  it("closes and signals the parent once connected", () => {
    addMutate.mockImplementation((_payload, opts) => opts.onSuccess?.());
    renderModal();
    pick("Team", "GFS Testing Team");
    pick("Channel", "103 Robinson St");

    fireEvent.click(screen.getByText("Connect"));

    expect(onConnected).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a generic error for a non-409 failure", () => {
    setAdd({ isError: true });
    renderModal();

    expect(screen.getByText("Could not connect. Please try again.")).toBeInTheDocument();
  });

  it("shows the connecting state while the request is in flight", () => {
    setAdd({ isPending: true });
    renderModal();

    expect(screen.getByText("Connecting to Teams…")).toBeInTheDocument();
    expect(screen.getAllByText("Connecting…").length).toBeGreaterThan(0);
  });

  it("closes from the X button", () => {
    renderModal();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
