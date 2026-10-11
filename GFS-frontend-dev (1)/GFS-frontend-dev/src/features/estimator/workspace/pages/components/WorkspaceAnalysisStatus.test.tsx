import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/projects/context/ProjectRouteContext", () => ({
  useProjectRoute: vi.fn(),
}));

import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import WorkspaceAnalysisStatus from "./WorkspaceAnalysisStatus";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceAnalysisStatus", () => {
  it("shows a live indicator while AI processing is active", () => {
    asMock(useProjectRoute).mockReturnValue({
      project: { analysisStatus: "PROCESSING" },
    });

    render(<WorkspaceAnalysisStatus />);

    expect(screen.getByRole("status", { name: "AI extraction in progress" })).toBeInTheDocument();
    expect(screen.getByText("AI extraction in progress")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveAttribute("title", "AI extraction in progress");
  });

  it("shows a retry message after processing fails", () => {
    asMock(useProjectRoute).mockReturnValue({
      project: { analysisStatus: "FAILED" },
    });

    render(<WorkspaceAnalysisStatus />);

    expect(screen.getByRole("alert", { name: "AI extraction failed" })).toBeInTheDocument();
    expect(screen.getByText("AI extraction failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute(
      "title",
      "AI extraction failed. Re-run analysis from Project Overview."
    );
  });

  it("shows a persistent completion state after processing completes", () => {
    asMock(useProjectRoute).mockReturnValue({
      project: { analysisStatus: "COMPLETED" },
    });

    render(<WorkspaceAnalysisStatus />);

    expect(screen.getByRole("status", { name: "AI Extraction Complete" })).toBeInTheDocument();
    expect(screen.getByText("AI Extraction Complete")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("title", "AI Extraction Complete");
  });

  it("shows completion state for completed project even if analysisStatus was PROCESSING", () => {
    asMock(useProjectRoute).mockReturnValue({
      project: { status: "ADMIN_PACKAGING", analysisStatus: "PROCESSING" },
    });

    render(<WorkspaceAnalysisStatus />);

    expect(screen.getByRole("status", { name: "AI Extraction Complete" })).toBeInTheDocument();
    expect(screen.getByText("AI Extraction Complete")).toBeInTheDocument();
  });

  it("stays hidden when no analysis status is available", () => {
    asMock(useProjectRoute).mockReturnValue({
      project: undefined,
    });

    render(<WorkspaceAnalysisStatus />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
