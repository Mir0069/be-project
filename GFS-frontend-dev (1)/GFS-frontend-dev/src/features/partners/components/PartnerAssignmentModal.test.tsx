import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDemoPartner,
  getPartnerDemoSnapshot,
  getPartnerForDraft,
  resetPartnerDemoStore,
} from "../partnerDemoStore";
import PartnerAssignmentModal from "./PartnerAssignmentModal";

describe("PartnerAssignmentModal", () => {
  beforeEach(() => resetPartnerDemoStore());

  it("searches active partners and stores the selected assignment", async () => {
    createDemoPartner({ name: "Texas Glass Group", territory: "Texas", address: "Austin, TX" });
    createDemoPartner({ name: "Pacific Partner", territory: "West", address: "Seattle, WA" });
    const user = userEvent.setup();
    const onAssigned = vi.fn();

    render(
      <PartnerAssignmentModal
        open
        draftId="draft-1"
        projectName="Wilcox Residence"
        onClose={vi.fn()}
        onAssigned={onAssigned}
      />,
    );

    await user.type(screen.getByLabelText("Search partners"), "Texas");
    await user.click(screen.getByRole("option", { name: /Texas Glass Group/i }));
    await user.click(screen.getByRole("button", { name: "Assign Partner" }));

    expect(onAssigned).toHaveBeenCalledWith("Texas Glass Group");
    expect(getPartnerForDraft(getPartnerDemoSnapshot(), "draft-1")?.name).toBe("Texas Glass Group");
  });

  it("does not allow inactive partners to be assigned", () => {
    render(
      <PartnerAssignmentModal
        open
        draftId="draft-2"
        projectName="Robinson Street"
        onClose={vi.fn()}
        onAssigned={vi.fn()}
      />,
    );

    expect(screen.getByText("No active partners are available. Add one from Partner List.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign Partner" })).toBeDisabled();
  });
});
