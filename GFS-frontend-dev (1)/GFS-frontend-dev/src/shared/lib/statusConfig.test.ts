import { describe, expect, it } from "vitest";

import {
  getProjectStatusLabel,
  getStatusBadgeClass,
  getStatusRowClass,
  normalizeProjectStatus,
} from "./statusConfig";

describe("project status presentation", () => {
  it("presents READY_FOR_ESTIMATOR as Ready for Estimation", () => {
    expect(normalizeProjectStatus("READY_FOR_ESTIMATOR")).toBe("Ready for Estimation");
    expect(getStatusBadgeClass("Ready for Estimation")).toContain("bg-sky-50");
    expect(getStatusRowClass("Ready for Estimation")).toContain("bg-sky-50");
  });

  it("presents NEEDS_REVISION as Needs Revision even while AI is processing", () => {
    expect(normalizeProjectStatus("NEEDS_REVISION", "PROCESSING")).toBe("Needs Revision");
  });

  it("uses estimator-specific wording without changing the canonical status", () => {
    expect(getProjectStatusLabel("Ready for Estimation", "default")).toBe("Ready for Estimation");
    expect(getProjectStatusLabel("Ready for Estimation", "estimator")).toBe("Awaiting Estimator Review");
  });

  it("keeps estimator work statuses under In Progress", () => {
    expect(normalizeProjectStatus("ESTIMATOR_DRAFTING")).toBe("In-progress");
    expect(normalizeProjectStatus("ESTIMATOR_FINAL")).toBe("In-progress");
  });

  it("shows an unassigned estimator-work project as Not Started without changing its workflow status", () => {
    expect(normalizeProjectStatus("ESTIMATOR_DRAFTING", undefined, false)).toBe("Not started");
    expect(normalizeProjectStatus("ESTIMATOR_DRAFTING", undefined, true)).toBe("In-progress");
  });

  it("presents legacy PENDING project records as Input Pending", () => {
    expect(normalizeProjectStatus("PENDING", "COMPLETED")).toBe("Input Pending");
  });

  it("presents COMPLETED or ADMIN_PACKAGING as Completed even if analysisStatus is PROCESSING", () => {
    expect(normalizeProjectStatus("ADMIN_PACKAGING", "PROCESSING")).toBe("Completed");
    expect(normalizeProjectStatus("COMPLETED", "PROCESSING")).toBe("Completed");
  });

  it("presents WAITING_FOR_INPUTS with PROCESSING as AI Extraction In Progress", () => {
    expect(normalizeProjectStatus("WAITING_FOR_INPUTS", "PROCESSING")).toBe("AI Extraction In Progress");
  });

  it("presents READY_FOR_ESTIMATOR with COMPLETED as Ready for Estimation", () => {
    expect(normalizeProjectStatus("READY_FOR_ESTIMATOR", "COMPLETED")).toBe("Ready for Estimation");
  });

  it("presents ESTIMATOR_DRAFTING as In-progress even if analysisStatus is PROCESSING", () => {
    expect(normalizeProjectStatus("ESTIMATOR_DRAFTING", "PROCESSING")).toBe("In-progress");
  });

  it("presents READY_FOR_ESTIMATOR as Ready for Estimation even if analysisStatus is PROCESSING", () => {
    expect(normalizeProjectStatus("READY_FOR_ESTIMATOR", "PROCESSING")).toBe("Ready for Estimation");
  });
});
