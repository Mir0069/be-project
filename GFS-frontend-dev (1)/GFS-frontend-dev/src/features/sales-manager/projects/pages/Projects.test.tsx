import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import SalesManagerProjects from "./Projects";

const { useProjectWorkspaceMock } = vi.hoisted(() => ({
  useProjectWorkspaceMock: vi.fn(),
}));

vi.mock("@/features/projects/query/projectWorkspaceQuery", () => ({
  useProjectWorkspace: useProjectWorkspaceMock,
}));

vi.mock("@/features/partners/partnerDemoStore", () => ({
  usePartnerDemoStore: () => ({ partners: [], assignments: [] }),
  getPartnerForProject: () => null,
}));

const project = {
  id: "65b0c1d2e3f4a5b6c7d8e9f0",
  referenceNumber: "PRJ-2026-0020",
  blobStorageURL: null,
  projectName: "Storefront Glass",
  customerName: "Acme Buyer",
  status: "SETUP_PENDING",
  analysisStatus: "NOT_STARTED",
  projectType: "NEW_ESTIMATE",
  creationSource: "MAIL_FIRST",
  identifierHash: null,
  zohoLeadId: null,
  jobAddress: null,
  quoteNumber: null,
  leadStatus: null,
  customerEmail: null,
  customerPhone: null,
  company: null,
  customerWebsite: null,
  description: null,
  receivedDate: null,
  address: null,
  assignedEstimators: [],
  estimatorName: null,
  estimatorEmail: null,
  estimatorPhone: null,
  lastZohoSyncedAt: null,
  dueDate: "2026-08-15T00:00:00Z",
  estimatedCost: 25000,
  totalSqFt: null,
  isActive: true,
  createdAt: "2026-06-30T00:00:00Z",
  updatedAt: "2026-06-30T00:00:00Z",
};

describe("SalesManagerProjects", () => {
  beforeEach(() => {
    useProjectWorkspaceMock.mockReturnValue({
      data: {
        data: [project],
        total: 1,
        page: 1,
        limit: 15,
        totalPages: 1,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("shows the due date in the manager project list", () => {
    render(
      <MemoryRouter>
        <SalesManagerProjects />
      </MemoryRouter>,
    );

    expect(screen.getByRole("columnheader", { name: "Due Date" })).toBeInTheDocument();
    expect(screen.getByText("Aug 15, 2026")).toBeInTheDocument();
  });

  it("shows the active revision reason in the project list", () => {
    useProjectWorkspaceMock.mockReturnValue({
      data: {
        data: [{
          ...project,
          status: "NEEDS_REVISION",
          revisionRequest: { stage: 4, reason: "Update panel dimensions", requestedBy: "user-1", requestedAt: "2026-09-22T08:00:00Z" },
        }],
        total: 1,
        page: 1,
        limit: 15,
        totalPages: 1,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <SalesManagerProjects />
      </MemoryRouter>,
    );

    expect(screen.getByText("Stage 4 · Update panel dimensions")).toBeInTheDocument();
  });

  it("opens the animated filter menus and applies a selected status", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SalesManagerProjects />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Filter projects by status" }));
    const menu = screen.getByRole("listbox", { name: "Filter projects by status" });
    expect(menu).toHaveClass("animate-project-filter-menu-in");
    expect(menu).not.toHaveClass("max-h-64", "overflow-y-auto");

    await user.click(screen.getByRole("option", { name: "Completed" }));
    expect(screen.getByRole("button", { name: "Filter projects by status" })).toHaveTextContent("Completed");
    expect(screen.queryByRole("listbox", { name: "Filter projects by status" })).not.toBeInTheDocument();
  });
});
