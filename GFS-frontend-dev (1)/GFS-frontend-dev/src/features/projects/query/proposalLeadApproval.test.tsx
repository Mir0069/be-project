import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/services/proposals", () => ({
  approveProposalLead: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  showToast: vi.fn(),
}));

import { approveProposalLead } from "@/services/proposals";
import { showToast } from "@/components/ui/toast";
import { useApproveProposalLead } from "./proposalsQuery";

const TARGET = "Quoted need to follow up";

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const seedProposalCache = () =>
  client.setQueryData(["proposals", "p1", "proposal"], {
    stage_6_proposal: { target_sheet: "Proposal", cells: {}, status: "PENDING" },
    latest_document: { _id: "doc-1" },
    lead_approval: { state: "AVAILABLE", lead_status: "Need to Quote", changed: false },
  });

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe("useApproveProposalLead", () => {
  it("writes the new state into the proposal cache so the button hides without a refetch", async () => {
    seedProposalCache();
    vi.mocked(approveProposalLead).mockResolvedValue({
      state: "ALREADY_MARKED",
      lead_status: TARGET,
      changed: true,
    });

    const { result } = renderHook(() => useApproveProposalLead(), { wrapper });
    result.current.mutate({ projectId: "p1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = client.getQueryData(["proposals", "p1", "proposal"]) as {
      lead_approval: { state: string };
      latest_document: { _id: string };
    };
    expect(cached.lead_approval.state).toBe("ALREADY_MARKED");
    // The rest of the cached payload must survive the merge.
    expect(cached.latest_document).toEqual({ _id: "doc-1" });
  });

  // Approving marks the proposal sent, so the timeline and overview refresh; the project list does not.
  it("refreshes the timeline and overview but not the project list", async () => {
    seedProposalCache();
    vi.mocked(approveProposalLead).mockResolvedValue({
      state: "ALREADY_MARKED",
      lead_status: TARGET,
      changed: true,
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useApproveProposalLead(), { wrapper });
    result.current.mutate({ projectId: "p1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys.some((k) => k?.includes("project-workspace"))).toBe(true);
    expect(keys.some((k) => k?.includes("timeline"))).toBe(true);
    expect(keys.some((k) => k === JSON.stringify(["projects"]))).toBe(false);
  });

  it("distinguishes a fresh approval from one that was already set", async () => {
    vi.mocked(approveProposalLead).mockResolvedValue({
      state: "ALREADY_MARKED",
      lead_status: TARGET,
      changed: false,
    });

    const { result } = renderHook(() => useApproveProposalLead(), { wrapper });
    result.current.mutate({ projectId: "p1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(showToast).toHaveBeenCalledWith("success", expect.stringContaining("already"));
  });

  it("reports a fresh approval without saying it was already set", async () => {
    vi.mocked(approveProposalLead).mockResolvedValue({
      state: "ALREADY_MARKED",
      lead_status: TARGET,
      changed: true,
    });

    const { result } = renderHook(() => useApproveProposalLead(), { wrapper });
    result.current.mutate({ projectId: "p1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(showToast).toHaveBeenCalledWith("success", `Zoho lead marked "${TARGET}"`);
  });

  // The axios interceptor rejects a plain object, so `error instanceof Error`
  // would silently drop every backend message.
  it("surfaces the backend message from the axios-rejected plain object", async () => {
    vi.mocked(approveProposalLead).mockRejectedValue({
      status: 502,
      message: "Could not update the Zoho lead. Nothing was changed, please try again.",
    });

    const { result } = renderHook(() => useApproveProposalLead(), { wrapper });
    result.current.mutate({ projectId: "p1" });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(showToast).toHaveBeenCalledWith(
      "error",
      "Could not update the Zoho lead. Nothing was changed, please try again."
    );
  });

  it("falls back to a generic message when the error carries none", async () => {
    vi.mocked(approveProposalLead).mockRejectedValue({ status: 500 });

    const { result } = renderHook(() => useApproveProposalLead(), { wrapper });
    result.current.mutate({ projectId: "p1" });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("Could not update"));
  });
});
