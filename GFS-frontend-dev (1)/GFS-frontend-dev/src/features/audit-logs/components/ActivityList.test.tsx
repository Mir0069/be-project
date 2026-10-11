import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityList } from "./ActivityList";
import type { AuditLogItem } from "@/shared/types/auditLog.types";

const item: AuditLogItem = { id: "1", action: "extraction.started", description: "AI extraction started", category: "EXTRACTION", visibility: "BASIC", source: "SYSTEM", actorId: "system", actorRole: null, actorEmail: null, projectId: "project-1", divisionId: null, targetType: "PROJECT", targetId: "project-1", targetLabel: null, requestId: null, createdAt: "2026-09-14T01:00:00Z" };

describe("ActivityList", () => {
  it("does not collapse distinct records or mark started processing completed", () => {
    render(<MemoryRouter><ActivityList items={[item, { ...item, id: "2" }]} /></MemoryRouter>);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("In progress")).toHaveLength(2);
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });
  it("shows the relevant project on global records and labels documents correctly", () => {
    render(<MemoryRouter><ActivityList items={[{ ...item, project: { id: "project-1", projectName: "Blue Ridge", referenceNumber: "GFS-2026-1025" }, category: "DOCUMENT", action: "document.restored", description: "Document restored", targetType: "DOCUMENT", targetLabel: "Drawing.pdf" }]} showProjectBadge /></MemoryRouter>);
    expect(screen.getByText("Document: Drawing.pdf")).toBeInTheDocument();
    expect(screen.getByText("Blue Ridge")).toBeInTheDocument();
    expect(screen.getByText("GFS-2026-1025")).toBeInTheDocument();
  });
  it("finds the project for records that carry only a project id", () => {
    const projectLookup = { "project-1": { id: "project-1", projectName: "Blue Ridge", referenceNumber: "GFS-2026-1025" } };
    render(<MemoryRouter><ActivityList items={[item]} showProjectBadge projectLookup={projectLookup} /></MemoryRouter>);
    expect(screen.getByText("Blue Ridge")).toBeInTheDocument();
  });
  it("shows no project badge on records without a project", () => {
    const projectLookup = { "project-1": { id: "project-1", projectName: "Blue Ridge", referenceNumber: "GFS-2026-1025" } };
    render(<MemoryRouter><ActivityList items={[{ ...item, projectId: null }]} showProjectBadge projectLookup={projectLookup} /></MemoryRouter>);
    expect(screen.queryByText("Blue Ridge")).not.toBeInTheDocument();
    expect(screen.getByText("AI processing started")).toBeInTheDocument();
  });
  it("labels an affected team member separately from the actor", () => {
    render(<MemoryRouter><ActivityList items={[{ ...item, category: "USER", action: "user.create", description: "A new team member account was created.", source: "API", targetType: "USER", targetLabel: "Jane Doe · jane@example.com" }]} /></MemoryRouter>);
    expect(screen.getByText("Team member: Jane Doe · jane@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Actor:/)).toBeInTheDocument();
  });
  it("explains supporting records in the client-friendly project view", () => {
    render(<MemoryRouter><ActivityList items={[{ ...item, category: "SYSTEM", action: "system.sync", description: "System sync", source: "API" }]} clientFriendly /></MemoryRouter>);
    expect(screen.getByText("System record: Activity recorded")).toBeInTheDocument();
    expect(screen.getByText("Audit record")).toBeInTheDocument();
    expect(screen.getByText("GFS saved this supporting record as part of the complete project audit log.")).toBeInTheDocument();
  });
  it("shows approved and changed values in plain language", () => {
    render(<MemoryRouter><ActivityList items={[{
      ...item,
      category: "PROPOSAL",
      action: "proposal.optional_add_on_status_updated",
      description: "Optional add-on updated",
      source: "API",
      before: { status: "NOT_SELECTED" },
      after: { status: "ACCEPTED" },
    }]} clientFriendly /></MemoryRouter>);
    expect(screen.getByText("View audit details")).toBeInTheDocument();
    expect(screen.getByText("Optional add-on selection")).toBeInTheDocument();
    expect(screen.getByText("Not Selected → Accepted")).toBeInTheDocument();
  });
});
