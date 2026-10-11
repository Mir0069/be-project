import { describe, expect, it } from "vitest";

import { PROJECT_STATUS_TO_KANBAN_STAGE } from "./kanban.constants";

describe("Kanban status mapping", () => {
  it("maps every backend workflow status to the intended Kanban column", () => {
    expect(PROJECT_STATUS_TO_KANBAN_STAGE).toEqual({
      SETUP_PENDING: "Requirements",
      WAITING_FOR_INPUTS: "Approve Requirements",
      READY_FOR_ESTIMATOR: "Draft Proposal",
      ESTIMATOR_DRAFTING: "Review Proposal & Approval",
      ESTIMATOR_FINAL: "Proposal Sent/Submitted",
      ADMIN_PACKAGING: "Resubmit Proposal",
      NEEDS_REVISION: "Resubmit Proposal",
    });
  });
});
