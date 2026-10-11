import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/services/zoho", () => ({
  fetchZohoLeads: vi.fn(),
  fetchZohoLeadById: vi.fn(),
  fetchZohoLeadNotes: vi.fn(),
}));

import { fetchZohoLeadNotes } from "@/services/zoho";
import { useZohoNotes } from "./zohoQuery";

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe("useZohoNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch without a zohoLeadId", () => {
    const { result } = renderHook(() => useZohoNotes(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchZohoLeadNotes).not.toHaveBeenCalled();
  });

  it("fetches notes for a given zohoLeadId", async () => {
    vi.mocked(fetchZohoLeadNotes).mockResolvedValue([
      { id: "n1", title: "T", content: "C", author: "A", createdTime: null },
    ]);

    const { result } = renderHook(() => useZohoNotes("z1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchZohoLeadNotes).toHaveBeenCalledWith("z1");
    expect(result.current.data).toHaveLength(1);
  });
});
