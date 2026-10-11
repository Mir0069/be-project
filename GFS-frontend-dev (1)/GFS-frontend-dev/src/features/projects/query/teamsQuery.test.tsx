import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/services/teams", () => ({
  listTeamsMessages: vi.fn(),
  listTeamsMeetings: vi.fn(),
  getTeamsMeeting: vi.fn(),
  listMonitoredChannels: vi.fn(),
  getTeamsProvisioning: vi.fn(),
  connectTeamsProvisioning: vi.fn(),
  createTeamsWorkspace: vi.fn(),
}));

import {
  listTeamsMessages,
  listTeamsMeetings,
  getTeamsMeeting,
  listMonitoredChannels,
  getTeamsProvisioning,
  connectTeamsProvisioning,
  createTeamsWorkspace,
} from "@/services/teams";
import {
  useTeamsMessages,
  useTeamsMeetings,
  useTeamsMeeting,
  useMonitoredChannels,
  useTeamsProvisioning,
  useConnectTeamsProvisioning,
  useCreateTeamsWorkspace,
  provisioningPollInterval,
  TEAMS_PROVISIONING_KEY,
} from "./teamsQuery";

const createWrapper = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
};

describe("useTeamsMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when projectId is undefined", () => {
    const { result } = renderHook(() => useTeamsMessages(undefined), { wrapper: createWrapper().wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(listTeamsMessages).not.toHaveBeenCalled();
  });

  it("fetches when a projectId is provided", async () => {
    vi.mocked(listTeamsMessages).mockResolvedValue([]);
    const { result } = renderHook(() => useTeamsMessages("p1"), { wrapper: createWrapper().wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listTeamsMessages).toHaveBeenCalledWith("p1");
  });
});

describe("useTeamsMeetings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when projectId is undefined", () => {
    const { result } = renderHook(() => useTeamsMeetings(undefined), { wrapper: createWrapper().wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(listTeamsMeetings).not.toHaveBeenCalled();
  });

  it("fetches when a projectId is provided", async () => {
    vi.mocked(listTeamsMeetings).mockResolvedValue([]);
    const { result } = renderHook(() => useTeamsMeetings("p1"), { wrapper: createWrapper().wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listTeamsMeetings).toHaveBeenCalledWith("p1");
  });
});

describe("useTeamsMeeting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when meetingId is undefined (lazy gating)", () => {
    const { result } = renderHook(() => useTeamsMeeting(undefined), { wrapper: createWrapper().wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(getTeamsMeeting).not.toHaveBeenCalled();
  });

  it("fetches the meeting detail when a meetingId is provided", async () => {
    vi.mocked(getTeamsMeeting).mockResolvedValue({
      meeting: { id: "m1" } as never,
      conversation: [],
      documents: [],
      transcript: null,
    });
    const { result } = renderHook(() => useTeamsMeeting("m1"), { wrapper: createWrapper().wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getTeamsMeeting).toHaveBeenCalledWith("m1");
  });
});

describe("provisioningPollInterval", () => {
  it("polls only while discovery or creation is in flight", () => {
    expect(provisioningPollInterval("DISCOVERING")).toBe(5000);
    expect(provisioningPollInterval("CREATING")).toBe(5000);
  });

  it("stops on every terminal state", () => {
    expect(provisioningPollInterval("AWAITING_DECISION")).toBe(false);
    expect(provisioningPollInterval("CONNECTED")).toBe(false);
    expect(provisioningPollInterval("FAILED")).toBe(false);
    expect(provisioningPollInterval("NONE")).toBe(false);
    expect(provisioningPollInterval(undefined)).toBe(false);
  });
});

describe("useTeamsProvisioning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch without a projectId", () => {
    const { result } = renderHook(() => useTeamsProvisioning(undefined), {
      wrapper: createWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(getTeamsProvisioning).not.toHaveBeenCalled();
  });

  it("fetches the provisioning state for the project", async () => {
    vi.mocked(getTeamsProvisioning).mockResolvedValue({ state: "AWAITING_DECISION", candidates: [] });
    const { result } = renderHook(() => useTeamsProvisioning("p1"), {
      wrapper: createWrapper().wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getTeamsProvisioning).toHaveBeenCalledWith("p1");
  });
});

describe("useMonitoredChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("never polls — useTeamsProvisioning is the only timer in the tab", async () => {
    vi.mocked(listMonitoredChannels).mockResolvedValue([]);
    const { result } = renderHook(() => useMonitoredChannels(true), {
      wrapper: createWrapper().wrapper,
    });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(listMonitoredChannels).toHaveBeenCalledTimes(1);
  });
});

describe("provisioning mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("flips the cached state to CONNECTED after a successful connect", async () => {
    vi.mocked(connectTeamsProvisioning).mockResolvedValue({ id: "mc1" } as never);
    const { wrapper, client } = createWrapper();
    const { result } = renderHook(() => useConnectTeamsProvisioning(), { wrapper });

    result.current.mutate({
      projectId: "p1",
      teamId: "t1",
      teamName: "T",
      channelId: "c1",
      channelName: "C",
    });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(TEAMS_PROVISIONING_KEY("p1"))).toMatchObject({
      state: "CONNECTED",
      teamName: "T",
      channelName: "C",
    });
  });

  it("seeds CREATING after asking for a workspace, which re-arms the poll", async () => {
    vi.mocked(createTeamsWorkspace).mockResolvedValue({ state: "CREATING", candidates: [] });
    const { wrapper, client } = createWrapper();
    const { result } = renderHook(() => useCreateTeamsWorkspace(), { wrapper });

    result.current.mutate({ projectId: "p1" });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(TEAMS_PROVISIONING_KEY("p1"))).toMatchObject({ state: "CREATING" });
  });
});
