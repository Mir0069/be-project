import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MultiVendorModal, { getSuggestedProjects } from "./MultiVendorModal";
import type { DraftProject } from "@/features/sales-manager/query/draftsQuery";

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
}));

vi.mock("@/features/sales-manager/query/draftsQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/sales-manager/query/draftsQuery")>();
  return {
    ...original,
    useLinkableProjects: () => ({
      data: [
        {
          projectId: "internal-project-id-1",
          referenceNumber: "GFS-2026-1042",
          projectName: "Wilcox Residence",
          customerName: "Wilcox Family",
          customerEmail: "owner@wilcoxbuild.com",
          jobAddress: "159 Poppasquash Road, Bristol",
        },
        {
          projectId: "internal-project-id-2",
          referenceNumber: "GFS-2026-1048",
          projectName: "Robinson Street",
          customerName: "Robinson Group",
          jobAddress: "182 Robinson Street",
        },
      ],
      isLoading: false,
      isError: false,
      refetch: mocks.refetch,
    }),
  };
});

const draft: DraftProject = {
  id: "draft-1",
  messageId: "message-1",
  receivedDateTime: "2026-08-05T10:00:00Z",
  fromName: "Wilcox Glass Vendor",
  fromAddress: "quotes@wilcoxbuild.com",
  address: "159 Poppasquash Road, Bristol",
  proposed: {
    projectName: "Wilcox Residence",
    customerName: "Wilcox Family",
  },
};

describe("MultiVendorModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows explainable suggestions from project data", () => {
    render(
      <MultiVendorModal
        open
        draft={draft}
        isLinking={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Suggested matches")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Matching project name | Matching address | Matching customer | Matching email domain",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("internal-project-id-1")).not.toBeInTheDocument();
  });

  it("searches projects and submits the selected backend project", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <MultiVendorModal
        open
        draft={draft}
        isLinking={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.type(screen.getByLabelText("Search existing projects"), "1048");
    await user.click(screen.getByRole("option", { name: /Robinson Street/i }));
    await user.click(screen.getByRole("button", { name: "Link to Project" }));

    expect(onConfirm).toHaveBeenCalledWith("internal-project-id-2", "Robinson Street");
  });

  it("does not suggest a project when only a partial street number matches", () => {
    const suggestions = getSuggestedProjects(
      {
        ...draft,
        fromAddress: "vendor@example.com",
        address: "4 Jane Street",
        proposed: { projectName: "New Project", customerName: "New Customer" },
      },
      [
        {
          projectId: "internal-project-id-3",
          projectName: "Different Project",
          customerName: "Different Customer",
          jobAddress: "14 Jane Street",
        },
      ],
    );

    expect(suggestions).toHaveLength(0);
  });
});
