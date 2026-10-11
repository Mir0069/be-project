import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/services/project-workspace", () => ({
  fetchProjectWorkspace: vi.fn(),
  fetchProjectDetail: vi.fn(),
}));

import { fetchProjectDetail } from "@/services/project-workspace";
import {
  getProjectDetailRefetchInterval,
  PROJECT_ANALYSIS_POLL_INTERVAL_MS,
  useProjectDetail,
} from "./projectWorkspaceQuery";

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe("useProjectDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when id is undefined", () => {
    const { result } = renderHook(() => useProjectDetail(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchProjectDetail).not.toHaveBeenCalled();
  });

  it("fetches and returns the project when an id is provided", async () => {
    vi.mocked(fetchProjectDetail).mockResolvedValue({
      id: "p1",
      projectName: "Storefront Glass",
    } as Awaited<ReturnType<typeof fetchProjectDetail>>);

    const { result } = renderHook(() => useProjectDetail("p1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchProjectDetail).toHaveBeenCalledWith("p1");
    expect(result.current.data?.projectName).toBe("Storefront Glass");
  });
});

describe("getProjectDetailRefetchInterval", () => {
  it("polls while project analysis is in progress", () => {
    expect(getProjectDetailRefetchInterval("PROCESSING")).toBe(
      PROJECT_ANALYSIS_POLL_INTERVAL_MS
    );
  });

  it("does not poll after analysis has finished", () => {
    expect(getProjectDetailRefetchInterval("READY_FOR_ESTIMATOR")).toBe(false);
    expect(getProjectDetailRefetchInterval("WAITING_FOR_INPUTS")).toBe(false);
  });
});
