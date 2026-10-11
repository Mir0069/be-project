import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/services/proposals", () => ({ approvePendingChange: vi.fn(), rejectPendingChange: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/components/ui/ExpandableText", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("@/features/sales-manager/projects/components/EmailBody", () => ({ default: () => null }));
vi.mock("@/shared/lib/filePreview", () => ({ openDocumentPreview: vi.fn() }));
vi.mock("@/features/projects/context/ProjectRouteContext", () => ({
  useProjectRoute: () => ({ project: { id: "p1", analysisStatus: "COMPLETED", zohoLeadId: "z1" } }),
}));
vi.mock("@/features/projects/query/documentsQuery", () => ({ useDocuments: () => ({ data: [] }) }));
vi.mock("@/features/projects/query/outlookQuery", () => ({ useOutlookEmails: () => ({ data: [] }) }));
vi.mock("@/features/zoho/query/zohoQuery", () => ({ useZohoNotes: () => ({ data: [] }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/features/projects/query/proposalsQuery", () => ({
  synchronizeProjectWorkflow: vi.fn(),
  usePendingApprovals: vi.fn(),
}));

import { usePendingApprovals } from "@/features/projects/query/proposalsQuery";
import { PendingApprovalsPanel } from "./PendingApprovalsPanel";

const approval = (source: string, reasoning: string) => ({
  _id: `${source}-1`,
  projectId: "p1",
  source,
  sourceId: "s1",
  status: "PENDING",
  detectedChanges: [],
  reasoning,
  confidence: 0.8,
  documentIds: [],
  documentNames: [],
  correlationId: "c1",
  subject: "Zoho notes or description updated",
  sender: "jamunesh sheta",
  createdAt: "2026-09-30T17:40:08.000Z",
  updatedAt: "2026-09-30T17:40:08.000Z",
});

const renderExpanded = (source: string, reasoning: string) => {
  (usePendingApprovals as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { approvals: [approval(source, reasoning)], count: 1 },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
  render(<PendingApprovalsPanel projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: "Expand approval details" }));
};

beforeEach(() => vi.clearAllMocks());

describe("PendingApprovalsPanel — approval text heading", () => {
  it("labels a Zoho note approval as the note it is, not as reasoning", () => {
    renderExpanded("ZOHO", 'Zoho was updated. Latest note by jamunesh sheta: "jemmu"');

    expect(screen.getByText("Zoho note")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
    expect(screen.getByText('Zoho was updated. Latest note by jamunesh sheta: "jemmu"')).toBeInTheDocument();
  });

  it("labels a Zoho description approval as the description", () => {
    renderExpanded("ZOHO", 'Zoho was updated. Description: "No IGU, Series 2000"');

    expect(screen.getByText("Zoho description")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
  });

  it("keeps Reasoning for AI-reviewed sources", () => {
    renderExpanded("EMAIL", "Customer asked for IGU glass.");

    expect(screen.getByText("Reasoning")).toBeInTheDocument();
  });
});
