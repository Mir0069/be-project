import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RevisionInfo } from "./RevisionInfo";
import type { ProposalRevision } from "@/shared/types/proposalStage.types";

const revision: ProposalRevision = {
  reason: "client changed the glass",
  revisedBy: "alice@example.com",
  revisedAt: "2026-07-01T10:00:00.000Z",
  revisionNumber: 2,
};

describe("RevisionInfo", () => {
  it("renders nothing when there are no revisions", () => {
    const { container } = render(<RevisionInfo revisionCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when revisionCount is undefined", () => {
    const { container } = render(<RevisionInfo />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the revision number and reason", () => {
    render(<RevisionInfo revisionCount={2} latestRevision={revision} />);

    expect(screen.getByText(/Revision #2/)).toBeInTheDocument();
    expect(screen.getByText("“client changed the glass”")).toBeInTheDocument();
    expect(screen.getByText(/Revised by alice@example\.com/)).toBeInTheDocument();
  });

  it("omits the reason when the latest revision has none", () => {
    render(
      <RevisionInfo
        revisionCount={1}
        latestRevision={{ ...revision, reason: "" }}
      />
    );

    expect(screen.getByText(/Revision #1/)).toBeInTheDocument();
    expect(screen.queryByText(/“/)).not.toBeInTheDocument();
    expect(screen.getByText(/Revised by alice@example\.com/)).toBeInTheDocument();
  });

  it("omits the revised-by line when no latest revision is given", () => {
    render(<RevisionInfo revisionCount={1} />);

    expect(screen.getByText(/Revision #1/)).toBeInTheDocument();
    expect(screen.queryByText(/Revised by/)).not.toBeInTheDocument();
  });
});
