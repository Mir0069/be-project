import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AssignEstimatorModal from "./AssignEstimatorModal";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  refetch: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/features/sales-manager/create-project/query/show-estimator.query", () => ({
  useEstimators: () => ({
    data: [
      { id: "est-1", name: "Dan Muniz", email: "dan@gfs.com", status: "Active" },
      { id: "est-2", name: "Sarah Smith", email: "sarah@gfs.com", status: "Active" },
      { id: "est-3", name: "Former User", email: "former@gfs.com", status: "Inactive" },
    ],
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/features/projects/query/projectsQuery", () => ({
  useUpdateProjectEstimators: () => ({
    mutate: mocks.mutate,
    mutateAsync: mocks.mutateAsync,
    reset: mocks.reset,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  showToast: mocks.showToast,
}));

describe("AssignEstimatorModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the created project confirmation and backend estimators", () => {
    render(
      <AssignEstimatorModal
        open
        projectId="project-1"
        projectName="Wilcox Residence"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Project created successfully:/)).toBeInTheDocument();
    expect(screen.getByText("Wilcox Residence")).toBeInTheDocument();
    expect(screen.getByText("Dan Muniz")).toBeInTheDocument();
    expect(screen.getByText("dan@gfs.com")).toBeInTheDocument();
    expect(screen.queryByText("Former User")).not.toBeInTheDocument();
  });

  it("submits the selected estimator for the created project", async () => {
    const user = userEvent.setup();
    render(
      <AssignEstimatorModal
        open
        projectId="project-1"
        projectName="Wilcox Residence"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("option", { name: /Dan Muniz/i }));
    await user.click(screen.getByRole("button", { name: "Assign Estimator" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { id: "project-1", estimatorIds: ["est-1"] },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("shows assignment confirmation after the API succeeds", async () => {
    mocks.mutate.mockImplementationOnce((_input, options) => options.onSuccess());
    const user = userEvent.setup();
    render(
      <AssignEstimatorModal
        open
        projectId="project-1"
        projectName="Wilcox Residence"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("option", { name: /Dan Muniz/i }));
    await user.click(screen.getByRole("button", { name: "Assign Estimator" }));

    const confirmation = screen.getByText("Estimator assigned");
    expect(confirmation).toBeInTheDocument();
    expect(confirmation.parentElement).toHaveTextContent(
      "Dan Muniz is now assigned to Wilcox Residence.",
    );
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("assigns the estimator to every project in a competitive bid group", async () => {
    mocks.mutateAsync.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <AssignEstimatorModal
        open
        projectId="project-1"
        projectIds={["project-1", "project-2"]}
        projectName="Wilcox Residence"
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("option", { name: /Dan Muniz/i }));
    await user.click(screen.getByRole("button", { name: "Assign Estimator" }));

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(1, {
      id: "project-1",
      estimatorIds: ["est-1"],
    });
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(2, {
      id: "project-2",
      estimatorIds: ["est-1"],
    });
    expect(await screen.findByText("Estimator assigned")).toBeInTheDocument();
  });
});
