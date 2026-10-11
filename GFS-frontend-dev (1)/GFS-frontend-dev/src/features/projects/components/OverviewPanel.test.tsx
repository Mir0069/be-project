import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import OverviewPanel from "./OverviewPanel";
import type { ApiProject } from "@/services/project-workspace";
vi.mock("@/features/audit-logs/components/RecentProjectActivity", () => ({ RecentProjectActivity: () => null }));

vi.mock("@/features/partners/partnerDemoStore", () => ({
  usePartnerDemoStore: () => ({ partners: [], assignments: [] }),
  getPartnerForProject: () => null,
}));

// OverviewPanel pulls the current user (role gate) and project/estimator data from
// hooks. Stub them so the component renders in isolation without providers or a server.
const auth = vi.hoisted(() => ({ role: "SALES_MANAGER" }));
const dueDateMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { role: auth.role } }),
}));

vi.mock("@/features/projects/query/projectsQuery", () => ({
  useProject: () => ({ data: { assignedEstimators: [] } }),
  useUpdateProjectEstimators: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/projects/query/projectWorkspaceQuery", () => ({
  useExternalContacts: () => ({
    data: { contacts: [], total: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateProjectDueDate: () => dueDateMutation,
}));

vi.mock("@/features/sales-manager/create-project/query/show-estimator.query", () => ({
  useEstimators: () => ({ data: [] }),
}));

const baseProject: ApiProject = {
  id: "65b0c1d2e3f4a5b6c7d8e9f0",
  referenceNumber: "PRJ-2026-0020",
  blobStorageURL: "projects/abc/",
  projectName: "Storefront Glass",
  customerName: "Acme Buyer",
  status: "SETUP_PENDING",
  projectType: "NEW_ESTIMATE",
  creationSource: "MAIL_FIRST",
  identifierHash: null,
  zohoLeadId: "z-1",
  jobAddress: "Plot 5, Market District",
  quoteNumber: null,
  leadStatus: "Need to Quote",
  customerEmail: "buyer@acme.com",
  customerPhone: "555-0100",
  company: "Acme Corp",
  customerWebsite: "https://acme.com",
  description: "Replace storefront glass panels.",
  receivedDate: "2026-06-30T00:00:00Z",
  address: { street: "1 Market St", city: "SF", state: "CA", zipcode: "94103", country: "USA" },
  assignedEstimatorId: null,
  estimatorName: "Estimator Jane",
  estimatorEmail: null,
  estimatorPhone: null,
  lastZohoSyncedAt: null,
  dueDate: null,
  estimatedCost: null,
  totalSqFt: null,
  isActive: true,
  createdAt: "2026-06-30T00:00:00Z",
  updatedAt: "2026-06-30T00:00:00Z",
};

describe("OverviewPanel", () => {
  it("renders the real project fields", () => {
    render(<OverviewPanel project={baseProject} />);
    expect(screen.getByText("Code Number")).toBeInTheDocument();
    expect(screen.getByText("PRJ-2026-0020")).toBeInTheDocument();
    expect(screen.getByText("Storefront Glass")).toBeInTheDocument();
    expect(screen.getByText("Acme Buyer")).toBeInTheDocument();
    expect(screen.getByText("buyer@acme.com")).toBeInTheDocument();
    expect(screen.getByText("Lead Status")).toBeInTheDocument();
    expect(screen.getByText("Lead ID")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Replace storefront glass panels.")).toBeInTheDocument();
  });

  it("shows readable project type and status labels", () => {
    render(
      <OverviewPanel
        project={{ ...baseProject, status: "READY_FOR_ESTIMATOR" }}
      />,
    );

    expect(screen.getByText("New Estimate")).toBeInTheDocument();
    expect(screen.getByText("Ready for Estimation")).toBeInTheDocument();
    expect(screen.queryByText("NEW_ESTIMATE")).not.toBeInTheDocument();
    expect(screen.queryByText("READY_FOR_ESTIMATOR")).not.toBeInTheDocument();
  });

  it("renders one canonical project address without duplicate address fields", () => {
    render(<OverviewPanel project={baseProject} />);
    expect(screen.getByText("Project Address")).toBeInTheDocument();
    expect(screen.getByText("Plot 5, Market District")).toBeInTheDocument();
    expect(screen.queryByText("SF")).not.toBeInTheDocument();
    expect(screen.queryByText("CA")).not.toBeInTheDocument();
  });

  it("shows the due date when the backend returns one", () => {
    const { rerender } = render(<OverviewPanel project={baseProject} />);
    expect(screen.getByText("Due Date")).toBeInTheDocument();

    rerender(
      <OverviewPanel
        project={{ ...baseProject, dueDate: "2026-08-15T00:00:00Z" }}
      />,
    );
    expect(screen.getByText("Due Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Due Date")).toHaveValue("2026-08-15");
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("lets a manager set a due date", () => {
    render(<OverviewPanel project={baseProject} />);

    fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Set date" }));

    expect(dueDateMutation.mutate).toHaveBeenCalledWith({
      id: baseProject.id,
      dueDate: "2026-08-15",
    });
  });

  it("shows the 'From Mail' source badge for a MAIL_FIRST project", () => {
    render(<OverviewPanel project={baseProject} />);
    expect(screen.getByText("From Mail")).toBeInTheDocument();
  });

  it("shows the 'From Zoho' source badge for a ZOHO_FIRST project", () => {
    render(<OverviewPanel project={{ ...baseProject, creationSource: "ZOHO_FIRST" }} />);
    expect(screen.getByText("From Zoho")).toBeInTheDocument();
  });

  describe("estimator assignment section", () => {
    afterEach(() => {
      auth.role = "SALES_MANAGER";
    });

    it.each(["SALES_MANAGER", "SYSTEM_ADMIN", "HEAD_OF_DIVISION"])("is shown to %s", (role) => {
      auth.role = role;
      render(<OverviewPanel project={baseProject} />);
      expect(screen.getByText("Assigned Estimators")).toBeInTheDocument();
    });

    it("is hidden from an estimator", () => {
      auth.role = "ESTIMATOR";
      render(<OverviewPanel project={baseProject} />);
      expect(screen.queryByText("Assigned Estimators")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Due Date")).not.toBeInTheDocument();
    });
  });
});
