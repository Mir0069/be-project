import { describe, it, expect } from "vitest";

import type { MonitoredChannel, TeamsProvisioning } from "@/services/teams";
import { deriveProvisioningView, isChannelForProject, parseAlreadyLinked } from "./provisioning";

const channel = (overrides: Partial<MonitoredChannel> = {}): MonitoredChannel =>
  ({
    id: "mc1",
    teamId: "t1",
    teamName: "gfs testing team",
    channelId: "c1",
    channelName: "103 robinson st",
    projectIds: ["p1"],
    isActive: true,
    ...overrides,
  }) as MonitoredChannel;

const provisioning = (overrides: Partial<TeamsProvisioning> = {}): TeamsProvisioning => ({
  state: "NONE",
  candidates: [],
  ...overrides,
});

const candidate = (channelId: string, score: number) => ({
  teamId: "t1",
  teamName: "GFS - 182 Robinson Street",
  channelId,
  channelName: `${channelId} discussion`,
  score,
});

describe("isChannelForProject", () => {
  it("matches an active channel carrying the project", () => {
    expect(isChannelForProject(channel(), "p1")).toBe(true);
  });

  it("rejects a channel mapped to another project", () => {
    expect(isChannelForProject(channel({ projectIds: ["other"] }), "p1")).toBe(false);
  });

  it("rejects an inactive channel", () => {
    expect(isChannelForProject(channel({ isActive: false }), "p1")).toBe(false);
  });
});

describe("deriveProvisioningView", () => {
  it("prefers the monitored channel over the backend state", () => {
    const view = deriveProvisioningView({
      provisioning: provisioning({ state: "AWAITING_DECISION", candidates: [candidate("c9", 1)] }),
      connectedChannel: channel(),
      isLoading: false,
    });

    expect(view).toEqual({
      kind: "connected",
      teamName: "gfs testing team",
      channelName: "103 robinson st",
      monitoredId: "mc1",
    });
  });

  it("shows the banner from CONNECTED before the channel list catches up", () => {
    const view = deriveProvisioningView({
      provisioning: provisioning({ state: "CONNECTED", teamName: "T", channelName: "C" }),
      isLoading: false,
    });

    expect(view).toEqual({ kind: "connected", teamName: "T", channelName: "C", monitoredId: null });
  });

  it("maps the in-flight and terminal states", () => {
    const kindFor = (state: TeamsProvisioning["state"]) =>
      deriveProvisioningView({ provisioning: provisioning({ state }), isLoading: false }).kind;

    expect(kindFor("DISCOVERING")).toBe("discovering");
    expect(kindFor("CREATING")).toBe("creating");
    expect(kindFor("FAILED")).toBe("failed");
    expect(kindFor("NONE")).toBe("idle");
  });

  it("carries the error message through to the failed view", () => {
    const view = deriveProvisioningView({
      provisioning: provisioning({ state: "FAILED", error: "graph down" }),
      isLoading: false,
    });

    expect(view).toEqual({ kind: "failed", message: "graph down" });
  });

  it("sorts candidates by score, highest first", () => {
    const view = deriveProvisioningView({
      provisioning: provisioning({
        state: "AWAITING_DECISION",
        candidates: [candidate("low", 0.4), candidate("high", 0.9), candidate("mid", 0.6)],
      }),
      isLoading: false,
    });

    expect(view.kind).toBe("deciding");
    expect(view.kind === "deciding" && view.candidates.map((c) => c.channelId)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("still decides when discovery found nothing", () => {
    const view = deriveProvisioningView({
      provisioning: provisioning({ state: "AWAITING_DECISION" }),
      isLoading: false,
    });

    expect(view).toEqual({ kind: "deciding", candidates: [] });
  });

  it("renders nothing (not the setup loader) on the first paint", () => {
    expect(deriveProvisioningView({ isLoading: true }).kind).toBe("loading");
  });

  it("falls back to idle when there is no provisioning record", () => {
    expect(deriveProvisioningView({ isLoading: false }).kind).toBe("idle");
  });
});

describe("parseAlreadyLinked", () => {
  it("returns the backend message for a 409 already-linked body", () => {
    const message = parseAlreadyLinked({
      data: { error: { message: "Already on 7 Maple Ave.", details: { alreadyLinked: true } } },
    });
    expect(message).toBe("Already on 7 Maple Ave.");
  });

  it("returns null for anything else", () => {
    expect(parseAlreadyLinked({ data: { error: { message: "boom" } } })).toBeNull();
    expect(parseAlreadyLinked({ data: { error: { details: { alreadyLinked: false } } } })).toBeNull();
    expect(parseAlreadyLinked({ message: "network" })).toBeNull();
    expect(parseAlreadyLinked(undefined)).toBeNull();
  });
});
