import { beforeEach, describe, expect, it } from "vitest";

import {
  assignDemoPartnerToDraft,
  createDemoPartner,
  getPartnerDemoSnapshot,
  getPartnerForDraft,
  getPartnerForProject,
  promoteDemoPartnerAssignment,
  resetPartnerDemoStore,
  setDemoPartnerStatus,
  updateDemoPartner,
} from "./partnerDemoStore";

describe("partner demo store", () => {
  beforeEach(() => resetPartnerDemoStore());

  it("creates readable partner numbers and updates lifecycle fields", () => {
    const partner = createDemoPartner({
      name: "Texas Glass Group",
      territory: "Texas",
      address: "Austin, TX",
    });

    expect(partner.partnerNumber).toBe("PTR-1001");

    updateDemoPartner(partner.id, {
      name: "Texas Glass Partners",
      territory: "Texas",
      address: "Dallas, TX",
    });
    setDemoPartnerStatus(partner.id, "INACTIVE");

    expect(getPartnerDemoSnapshot().partners[0]).toMatchObject({
      name: "Texas Glass Partners",
      address: "Dallas, TX",
      status: "INACTIVE",
    });
  });

  it("carries a draft partner assignment to the created project", () => {
    const partner = createDemoPartner({
      name: "Northeast Partner",
      territory: "Northeast",
      address: "",
    });

    assignDemoPartnerToDraft("draft-12", partner.id);
    expect(getPartnerForDraft(getPartnerDemoSnapshot(), "draft-12")?.name).toBe("Northeast Partner");

    promoteDemoPartnerAssignment("draft-12", "project-44");
    expect(getPartnerForProject(getPartnerDemoSnapshot(), "project-44")?.name).toBe("Northeast Partner");
  });
});
