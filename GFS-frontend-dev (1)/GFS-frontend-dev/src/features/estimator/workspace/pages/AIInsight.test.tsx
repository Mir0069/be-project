import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/features/projects/query/outlookQuery", () => ({ useOutlookEmails: vi.fn() }));
vi.mock("@/features/projects/query/proposalsQuery", () => ({ useProposalStage: vi.fn() }));
vi.mock("@/features/projects/query/documentsQuery", () => ({
  useDocuments: () => ({ data: [] }),
  usePreviewDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/projects/context/ProjectRouteContext", () => ({
  useProjectRoute: () => ({ projectId: "6abd3be98d457d2c0eb0c1c8" }),
}));
vi.mock("./components/WorkspaceAnalysisStatus", () => ({ default: () => null }));

import { useOutlookEmails } from "@/features/projects/query/outlookQuery";
import { useProposalStage } from "@/features/projects/query/proposalsQuery";
import AIInsight from "./AIInsight";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const ZOHO_SUMMARY = "One interior pedestrian glass floor (Unit A only) with a Series 1000 perimeter frame.";

const renderInsight = (emails: unknown[] = []) => {
  asMock(useOutlookEmails).mockReturnValue({ data: emails, isLoading: false });
  asMock(useProposalStage).mockReturnValue({
    isLoading: false,
    data: {
      fields_to_show: {
        // What an old Zoho approval left as stage reasoning: a raw meeting transcript.
        reasoning: "Good morning. 00:00:08.000 --> 00:00:16.000. 00:00:16...[truncated].",
        project_name: { value: "a-34 trupti soceity", reasoning: ["Project name identified from correspondence."] },
        person_quoting: { value: "Greg Muniz" },
        crm_note_summary: { value: ZOHO_SUMMARY, reasoning: [ZOHO_SUMMARY] },
      },
    },
  });
  render(<AIInsight />);
};

const section = (heading: string) => screen.getByRole("heading", { name: heading }).parentElement!;

beforeEach(() => vi.clearAllMocks());

describe("AIInsight — Zoho notes", () => {
  it("shows the Zoho note summary under Reasoning, not Summary", () => {
    renderInsight();

    expect(within(section("Summary")).queryByText(/Crm Note Summary/)).not.toBeInTheDocument();
    expect(within(section("Summary")).queryByText(ZOHO_SUMMARY)).not.toBeInTheDocument();
    expect(within(section("Summary")).queryByText(/Person Quoting/)).not.toBeInTheDocument();
    // A plain point like the others: first in the list, no label.
    const points = within(section("Reasoning")).getAllByRole("listitem");
    expect(points[0]).toHaveTextContent(ZOHO_SUMMARY);
    expect(within(section("Reasoning")).queryByText(/Zoho Notes/i)).not.toBeInTheDocument();
  });

  it("drops transcript timestamps and cut-off fragments from Reasoning", () => {
    renderInsight();

    const reasoning = section("Reasoning");
    expect(within(reasoning).queryByText(/-->/)).not.toBeInTheDocument();
    expect(within(reasoning).queryByText(/\[truncated\]/)).not.toBeInTheDocument();
    expect(within(reasoning).getByText("Project name identified from correspondence.")).toBeInTheDocument();
  });

  it("adds the Zoho summary to an email project's reasoning", () => {
    renderInsight([{ proposed: { summary: "Project Name: Harbor Point", reasoning: "Scope: one skylight." } }]);

    expect(within(section("Summary")).getByText("Harbor Point")).toBeInTheDocument();
    expect(within(section("Reasoning")).getByText(ZOHO_SUMMARY)).toBeInTheDocument();
    expect(within(section("Reasoning")).getByText("One skylight.")).toBeInTheDocument();
  });
});
