import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/shared/api/client";
import { fetchProjectWorkspace } from "./project-workspace";

vi.mock("@/shared/api/client", () => ({
  apiClient: { get: vi.fn() },
}));

describe("fetchProjectWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes project list search, sorting, and pagination to the backend", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: { data: [], total: 0, page: 2, limit: 15, totalPages: 0 },
      },
    });
    const params = {
      page: 2,
      limit: 15,
      search: "Jane Street",
      sortBy: "projectName" as const,
      sortOrder: "asc" as const,
    };

    await fetchProjectWorkspace(params);

    expect(apiClient.get).toHaveBeenCalledWith("/project-workspace", { params });
  });
});
