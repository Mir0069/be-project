import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/features/projects/query/proposalsQuery", () => ({
  useUnapproveProposalStage: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  showToast: vi.fn(),
}));

import { useUnapproveProposalStage } from "@/features/projects/query/proposalsQuery";
import { showToast } from "@/components/ui/toast";
import { ReviseStageModal } from "./ReviseStageModal";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const unapproveAsync = vi.fn();
const onClose = vi.fn();
const onRevised = vi.fn();
const onRevisionStateChange = vi.fn();

const setHook = (overrides: Record<string, unknown> = {}) =>
  asMock(useUnapproveProposalStage).mockReturnValue({
    mutateAsync: unapproveAsync,
    isPending: false,
    ...overrides,
  });

const renderModal = (props: Partial<React.ComponentProps<typeof ReviseStageModal>> = {}) =>
  render(
    <ReviseStageModal
      open
      onClose={onClose}
      onRevised={onRevised}
      onRevisionStateChange={onRevisionStateChange}
      projectId="p1"
      stage={4}
      {...props}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  setHook();
  asMock(unapproveAsync).mockResolvedValue({});
});

describe("ReviseStageModal", () => {
  it("submits with no reason when the textarea is empty", async () => {
    renderModal();

    fireEvent.click(screen.getByText("Revise Stage"));

    await waitFor(() => {
      expect(unapproveAsync).toHaveBeenCalledWith({
        projectId: "p1",
        stage: 4,
        reason: undefined,
      });
      expect(showToast).toHaveBeenCalledWith("success", "Stage is now editable.");
      expect(onRevised).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(onRevisionStateChange).toHaveBeenNthCalledWith(1, true);
      expect(onRevisionStateChange).toHaveBeenNthCalledWith(2, false);
    });
  });

  it("submits with a trimmed reason when one is entered", async () => {
    renderModal();

    fireEvent.change(screen.getByPlaceholderText("Reason for revising (optional)"), {
      target: { value: "  client changed the glass  " },
    });
    fireEvent.click(screen.getByText("Revise Stage"));

    await waitFor(() =>
      expect(unapproveAsync).toHaveBeenCalledWith({
        projectId: "p1",
        stage: 4,
        reason: "client changed the glass",
      })
    );
  });

  it("treats whitespace-only text as no reason", async () => {
    renderModal();

    fireEvent.change(screen.getByPlaceholderText("Reason for revising (optional)"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Revise Stage"));

    await waitFor(() =>
      expect(unapproveAsync).toHaveBeenCalledWith({
        projectId: "p1",
        stage: 4,
        reason: undefined,
      })
    );
  });

  it("shows an error toast and does not close on failure", async () => {
    asMock(unapproveAsync).mockRejectedValue(new Error("boom"));
    renderModal();

    fireEvent.click(screen.getByText("Revise Stage"));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("error", "boom")
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onRevised).not.toHaveBeenCalled();
    expect(onRevisionStateChange).toHaveBeenNthCalledWith(1, true);
    expect(onRevisionStateChange).toHaveBeenNthCalledWith(2, false);
  });

  it("closes from the Cancel button", () => {
    renderModal();

    fireEvent.click(screen.getByText("Cancel"));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    renderModal();

    fireEvent.click(screen.getByRole("dialog"));

    expect(onClose).toHaveBeenCalled();
  });

  it("renders the stage name in the title when provided", () => {
    renderModal({ stageName: "Glass Type" });

    expect(screen.getByRole("heading", { name: "Revise Stage — Glass Type" })).toBeInTheDocument();
  });

  it("falls back to the stage number in the title", () => {
    renderModal();

    expect(screen.getByRole("heading", { name: "Revise Stage 4" })).toBeInTheDocument();
  });

  it("disables actions while the request is pending", () => {
    setHook({ isPending: true });
    renderModal();

    expect(screen.getByText("Revise Stage")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });
});
