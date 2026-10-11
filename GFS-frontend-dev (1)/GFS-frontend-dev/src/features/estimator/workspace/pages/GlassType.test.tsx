import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/proposalsQuery", () => ({
  useProposalStage: vi.fn(),
  useApproveProposalStage: vi.fn(),
  usePatchProposalField: vi.fn(),
}));

// Reasoning renders CitationLink, which reads the project's documents through react-query.
vi.mock("@/features/projects/query/documentsQuery", () => ({
  useDocuments: () => ({ data: [] }),
  usePreviewDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/toast", () => ({ showToast: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ state: null }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isSalesManager: false }) }));
vi.mock("@/features/projects/context/ProjectRouteContext", () => ({
  useProjectRoute: () => ({ projectId: "p1", publicProjectKey: "GFS-2026-1012" }),
}));
vi.mock("@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus", () => ({ default: () => null }));

import { showToast } from "@/components/ui/toast";
import {
  useApproveProposalStage,
  usePatchProposalField,
  useProposalStage,
} from "@/features/projects/query/proposalsQuery";
import GlassType from "./GlassType";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const approveStage = vi.fn();
const refetch = vi.fn();

const renderWithGlass = (glass: string | null) => {
  asMock(useProposalStage).mockReturnValue({
    data: {
      status: "PENDING_APPROVAL",
      fields_to_show: {
        glass_type: {
          value: glass,
          reasoning: ["Walkability not confirmed in documents."],
          _meta: { allowed_values: ["GLASS_NO_IGU", "GLASS_WITH_IGU", "GLASS_2_0"] },
        },
      },
    },
    isLoading: false,
    isError: false,
    refetch,
  });
  render(<GlassType />);
};

const approveButton = () => screen.getByRole("button", { name: /Approve Data/ });
const updateButton = () => screen.getByRole("button", { name: "Update" });

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useApproveProposalStage).mockReturnValue({
    mutate: approveStage,
    isPending: false,
    isError: false,
    isSuccess: false,
  });
  asMock(usePatchProposalField).mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("GlassType — the AI's MANUAL glass", () => {
  it("asks for a glass type instead of showing the first option as chosen", () => {
    renderWithGlass("MANUAL");

    const select = screen.getByRole("combobox", { name: "Glass type" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]!.textContent).toBe("Select glass type");
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText(/The AI could not determine the glass type/)).toBeInTheDocument();
  });

  it("does not approve until a glass type is chosen", () => {
    renderWithGlass("MANUAL");

    fireEvent.click(approveButton());

    expect(approveStage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", "Select a glass type before approving.");
  });

  it("lets the estimator pick the first option and save it", () => {
    renderWithGlass("MANUAL");
    expect(updateButton()).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Glass type" }), { target: { value: "GLASS_NO_IGU" } });

    expect(updateButton()).toBeEnabled();
    expect(screen.getByText("Y")).toBeInTheDocument();
  });

  it("approves a glass type that is already chosen", () => {
    renderWithGlass("GLASS_WITH_IGU");

    expect((screen.getByRole("combobox", { name: "Glass type" }) as HTMLSelectElement).value).toBe("GLASS_WITH_IGU");
    fireEvent.click(approveButton());

    expect(approveStage).toHaveBeenCalledWith({ projectId: "p1", stage: 2 }, expect.any(Object));
  });
});
