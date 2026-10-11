import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/proposalsQuery", () => ({
  useUnapproveProposalStage: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  showToast: vi.fn(),
}));

import { useUnapproveProposalStage } from "@/features/projects/query/proposalsQuery";
import { ReviseStageButton } from "./ReviseStageButton";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useUnapproveProposalStage).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

describe("ReviseStageButton", () => {
  it("renders the trigger with the default label", () => {
    render(<ReviseStageButton projectId="p1" stage={4} />);

    expect(screen.getByText("Revise Stage")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a custom label", () => {
    render(<ReviseStageButton projectId="p1" stage={4} label="Edit Final Pricing" />);

    expect(screen.getByText("Edit Final Pricing")).toBeInTheDocument();
  });

  it("opens the modal on click and closes on cancel", () => {
    render(<ReviseStageButton projectId="p1" stage={4} />);

    fireEvent.click(screen.getByText("Revise Stage"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Revise Stage 4" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the modal fresh with an empty reason after a prior close", () => {
    render(<ReviseStageButton projectId="p1" stage={4} />);

    fireEvent.click(screen.getByText("Revise Stage"));
    fireEvent.change(screen.getByPlaceholderText("Reason for revising (optional)"), {
      target: { value: "some reason" },
    });
    fireEvent.click(screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("Revise Stage"));

    const textarea = screen.getByPlaceholderText(
      "Reason for revising (optional)"
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });
});
