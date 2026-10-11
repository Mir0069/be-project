import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AssignApproverModal from "./AssignApproverModal";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  onAssigned: vi.fn(),
}));

vi.mock("@/features/projects/query/proposalsQuery", () => ({
  useStage7EligibleApprovers: () => ({
    data: [
      { id: "manager-1", name: "Sam Manager", email: "sam@gfs.com" },
      { id: "manager-2", name: "Alex Manager", email: "alex@gfs.com" },
    ],
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  }),
  useAssignStage7Approver: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
}));

describe("AssignApproverModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects an approver on the first click and shows who is selected", async () => {
    const user = userEvent.setup();

    render(
      <AssignApproverModal
        open
        projectId="project-1"
        onClose={vi.fn()}
        onAssigned={mocks.onAssigned}
      />,
    );

    const option = screen.getByRole("option", { name: /Sam Manager/i });
    await user.click(option);

    expect(option).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Selected:").parentElement).toHaveTextContent("Selected: Sam Manager");
    expect(screen.getByText("Selected:").parentElement).toHaveTextContent("sam@gfs.com");
    expect(screen.getByRole("button", { name: "Assign Approver" })).toBeEnabled();
  });

  it("keeps the assigned person visible after a successful assignment", async () => {
    mocks.mutate.mockImplementationOnce((_input, options) => options.onSuccess());
    const user = userEvent.setup();

    render(
      <AssignApproverModal
        open
        projectId="project-1"
        onClose={vi.fn()}
        onAssigned={mocks.onAssigned}
      />,
    );

    await user.click(screen.getByRole("option", { name: /Alex Manager/i }));
    await user.click(screen.getByRole("button", { name: "Assign Approver" }));

    expect(screen.getByText("Approver assigned")).toBeInTheDocument();
    expect(screen.getByText("Alex Manager").parentElement).toHaveTextContent(
      "Alex Manager has been notified",
    );
    expect(mocks.onAssigned).toHaveBeenCalledWith({
      id: "manager-2",
      name: "Alex Manager",
      email: "alex@gfs.com",
    });
  });
});
