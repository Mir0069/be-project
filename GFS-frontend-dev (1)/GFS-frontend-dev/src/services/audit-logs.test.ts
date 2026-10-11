import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/shared/api/client";
import { downloadFeedbackHistory } from "./audit-logs";

vi.mock("@/shared/api/client", () => ({
  apiClient: { get: vi.fn() },
}));

describe("downloadFeedbackHistory", () => {
  it("requests the project export and uses the server filename", async () => {
    const blob = new Blob(["feedback"], { type: "text/csv" });
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="feedback-history-project-1.csv"' },
    });

    await expect(downloadFeedbackHistory("project-1")).resolves.toEqual({
      blob,
      fileName: "feedback-history-project-1.csv",
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/proposals/project-1/feedback/export",
      { responseType: "blob" },
    );
  });

  it("falls back to a safe filename when the header is unavailable", async () => {
    const blob = new Blob(["feedback"], { type: "text/csv" });
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: blob, headers: {} });

    await expect(downloadFeedbackHistory("project-2")).resolves.toMatchObject({
      fileName: "feedback-history-project-2.csv",
    });
  });
});
