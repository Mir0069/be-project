import { describe, it, expect } from "vitest";

import { getNotificationDestination, getTypeMeta, getSourceMeta } from "./utils";

describe("notification badge metadata", () => {
  it("labels the auto-provisioned Teams workspace notification", () => {
    const meta = getTypeMeta("TEAMS_WORKSPACE_CREATED");
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe("Teams");
  });

  it("labels the ready Dropbox workspace notification", () => {
    expect(getTypeMeta("DROPBOX_WORKSPACE_CREATED")?.label).toBe("Dropbox");
  });

  it("labels the workspace-needs-a-decision notification distinctly", () => {
    const meta = getTypeMeta("TEAMS_WORKSPACE_NEEDS_DECISION");
    expect(meta!.label).toBe("Teams action");
    expect(meta!.label).not.toBe(getTypeMeta("TEAMS_WORKSPACE_CREATED")!.label);
  });

  it("labels the could-not-add-team-member notification as an action", () => {
    const meta = getTypeMeta("TEAMS_MEMBER_NOT_ADDED");
    expect(meta?.label).toBe("Teams action");
    expect(meta?.className).toContain("amber");
  });

  it("sends the could-not-add-team-member notification to its project", () => {
    expect(
      getNotificationDestination({
        type: "TEAMS_MEMBER_NOT_ADDED",
        projectId: "65b0c1d2e3f4a5b6c7d8e9f0",
        payload: { referenceNumber: "GFS-2026-1001" },
      }),
    ).toBe("/projects/GFS-2026-1001");
  });

  it("labels document added as New Document", () => {
    expect(getTypeMeta("DOCUMENT_ADDED")?.label).toBe("New Document");
  });

  it("routes document added notifications to the documents tab", () => {
    expect(
      getNotificationDestination({
        type: "DOCUMENT_ADDED",
        projectId: "65b0c1d2e3f4a5b6c7d8e9f0",
        payload: { referenceNumber: "GFS-2026-1001" },
      }),
    ).toBe("/projects/GFS-2026-1001/documents");
  });

  it("returns null for types without a badge", () => {
    expect(getTypeMeta("PROJECT_CREATED")).toBeNull();
  });

  it("labels draft review notifications as new opportunities", () => {
    expect(getTypeMeta("DRAFT_REQUIRES_REVIEW")?.label).toBe("New opportunity");
  });

  it("labels docs processing as AI Extraction Processing", () => {
    expect(getTypeMeta("DOCS_PROCESSING")?.label).toBe("AI Extraction Processing");
  });

  it("labels docs processed as Ready for Estimation", () => {
    expect(getTypeMeta("DOCS_PROCESSED")?.label).toBe("Ready for Estimation");
  });

  it("labels final workflow notifications as Completed", () => {
    expect(getTypeMeta("PROJECT_COMPLETED")?.label).toBe("Completed");
  });

  it("labels cloud-link failures as requiring action", () => {
    expect(getTypeMeta("CLOUD_LINK_FAILED")?.label).toBe("Action required");
  });

  it("routes cloud-link failures to their recovery screen", () => {
    expect(getNotificationDestination({
      type: "CLOUD_LINK_FAILED",
      projectId: "project-1",
    })).toBe("/projects/project-1/documents");
    expect(getNotificationDestination({
      type: "CLOUD_LINK_FAILED",
      projectId: null,
    })).toBe("/sales-manager/drafts");
  });

  it("prefers the public project reference in browser routes", () => {
    expect(getNotificationDestination({
      type: "PROJECT_ASSIGNED",
      projectId: "507f1f77bcf86cd799439011",
      payload: { referenceNumber: "GFS-2026-1042" },
    })).toBe("/projects/GFS-2026-1042");
  });

  it("maps creation sources to badges", () => {
    expect(getSourceMeta("ZOHO_FIRST")?.label).toBe("From Zoho");
    expect(getSourceMeta("unknown")).toBeNull();
  });
});
