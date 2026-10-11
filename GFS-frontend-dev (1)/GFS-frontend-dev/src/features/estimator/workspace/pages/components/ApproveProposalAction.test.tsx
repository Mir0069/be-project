import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/proposalsQuery", () => ({
  useApproveProposalLead: vi.fn(),
}));

import { useApproveProposalLead } from "@/features/projects/query/proposalsQuery";
import {
  ApproveProposalAction,
  APPROVE_TOOLTIP,
  APPROVE_MARKED_LINE,
  APPROVE_NO_DRAFT_HINT,
} from "./ApproveProposalAction";
import type { ProposalLeadApproval } from "@/services/proposals";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const mutate = vi.fn();

const approval = (o: Partial<ProposalLeadApproval> = {}): ProposalLeadApproval => ({
  state: "AVAILABLE",
  lead_status: "Need to Quote",
  changed: false,
  ...o,
});

const renderAction = (
  a: ProposalLeadApproval | undefined,
  hasDraft = true
) => render(<ApproveProposalAction projectId="p1" approval={a} hasDraft={hasDraft} />);

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useApproveProposalLead).mockReturnValue({ mutate, isPending: false });
});

describe("ApproveProposalAction", () => {
  it("offers approval when the lead has not been quoted yet", () => {
    renderAction(approval());

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
  });

  it("warns on hover that clicking changes the lead status", () => {
    renderAction(approval());

    const hint = screen.getByTitle(APPROVE_TOOLTIP);
    expect(hint).toBeInTheDocument();
    expect(APPROVE_TOOLTIP).toContain("Zoho lead status");
    expect(APPROVE_TOOLTIP).toContain("Quoted need to follow up");
  });

  it("calls the mutation once when clicked", () => {
    renderAction(approval());

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ projectId: "p1" });
  });

  // The core requirement: never offer it twice.
  it("hides the button and states the outcome once the lead is marked", () => {
    renderAction(
      approval({ state: "ALREADY_MARKED", lead_status: "Quoted need to follow up" })
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByText(APPROVE_MARKED_LINE)).toBeInTheDocument();
  });

  it("stays hidden after a revision, because the lead is still marked", () => {
    const { rerender } = renderAction(approval());
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();

    rerender(
      <ApproveProposalAction
        projectId="p1"
        approval={approval({ state: "ALREADY_MARKED", lead_status: "Quoted need to follow up" })}
        hasDraft
      />
    );

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("disables approval until a draft exists and says why", () => {
    renderAction(approval(), false);

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByText(APPROVE_NO_DRAFT_HINT)).toBeInTheDocument();
  });

  // title is suppressed on a disabled button, hence the wrapper.
  it("keeps the hover warning reachable while the button is disabled", () => {
    renderAction(approval(), false);

    expect(screen.getByTitle(APPROVE_TOOLTIP).tagName).not.toBe("BUTTON");
  });

  it("does not call the API when clicked while disabled", () => {
    renderAction(approval(), false);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it("blocks a second click while the request is in flight", () => {
    asMock(useApproveProposalLead).mockReturnValue({ mutate, isPending: true });
    renderAction(approval());

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
  });

  it("explains that a closed lead will not be changed", () => {
    renderAction(approval({ state: "CLOSED", lead_status: "Sold" }));

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Sold/)).toBeInTheDocument();
    expect(screen.getByText(/status not changed/i)).toBeInTheDocument();
  });

  it("renders nothing for a project with no Zoho lead", () => {
    const { container } = renderAction(approval({ state: "NO_LEAD", lead_status: null }));

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before the approval state has loaded", () => {
    const { container } = renderAction(undefined);

    expect(container).toBeEmptyDOMElement();
  });
});
