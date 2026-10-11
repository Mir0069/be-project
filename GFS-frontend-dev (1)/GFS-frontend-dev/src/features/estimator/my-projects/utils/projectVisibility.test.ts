import { describe, it, expect } from "vitest";
import { visibleProjectsFor, isAssignedTo, canViewAllProjects } from "./projectVisibility";

const ESTIMATOR = { id: "est-1", email: "est1@gfs.test", role: "ESTIMATOR" };
const OTHER_ESTIMATOR = { id: "est-2", email: "est2@gfs.test", role: "ESTIMATOR" };

const project = (name: string, assignedEstimators: any[]) => ({ name, assignedEstimators });

describe("project visibility", () => {
  describe("canViewAllProjects", () => {
    it.each(["SYSTEM_ADMIN", "SUPER_ADMIN", "SALES_MANAGER", "HEAD_OF_DIVISION"])("allows %s", (role) => {
      expect(canViewAllProjects(role)).toBe(true);
    });

    it("does not allow an estimator", () => {
      expect(canViewAllProjects("ESTIMATOR")).toBe(false);
    });

    it("does not allow a missing role", () => {
      expect(canViewAllProjects(undefined)).toBe(false);
    });
  });

  describe("isAssignedTo", () => {
    it("hides an unassigned project instead of showing it to everyone", () => {
      expect(isAssignedTo(project("Nobody", []), ESTIMATOR)).toBe(false);
    });

    it("treats a missing assignment list as unassigned", () => {
      expect(isAssignedTo({ name: "No field" }, ESTIMATOR)).toBe(false);
    });

    it("matches a populated assignment by id", () => {
      expect(isAssignedTo(project("Mine", [{ id: "est-1" }]), ESTIMATOR)).toBe(true);
    });

    it("matches a populated assignment by email, case insensitively", () => {
      expect(isAssignedTo(project("Mine", [{ email: "EST1@GFS.TEST" }]), ESTIMATOR)).toBe(true);
    });

    it("matches a bare id string assignment", () => {
      expect(isAssignedTo(project("Mine", ["est-1"]), ESTIMATOR)).toBe(true);
    });

    it("does not match somebody else's project", () => {
      expect(isAssignedTo(project("Theirs", [{ id: "est-2" }]), ESTIMATOR)).toBe(false);
    });

    it("ignores null entries in the assignment list", () => {
      expect(isAssignedTo(project("Mine", [null, { id: "est-1" }]), ESTIMATOR)).toBe(true);
      expect(isAssignedTo(project("Theirs", [null]), ESTIMATOR)).toBe(false);
    });
  });

  describe("visibleProjectsFor", () => {
    const projects = [
      project("Mine", [{ id: "est-1" }]),
      project("Theirs", [{ id: "est-2" }]),
      project("Unassigned", []),
    ];

    it("shows an estimator only their own projects", () => {
      expect(visibleProjectsFor(projects, ESTIMATOR).map((p) => p.name)).toEqual(["Mine"]);
    });

    it("shows a different estimator a different set", () => {
      expect(visibleProjectsFor(projects, OTHER_ESTIMATOR).map((p) => p.name)).toEqual(["Theirs"]);
    });

    it("shows a sales manager everything including unassigned", () => {
      const visible = visibleProjectsFor(projects, { role: "SALES_MANAGER" });
      expect(visible.map((p) => p.name)).toEqual(["Mine", "Theirs", "Unassigned"]);
    });

    it("shows nothing to an estimator with no assignments at all", () => {
      expect(visibleProjectsFor(projects, { id: "est-9", role: "ESTIMATOR" })).toEqual([]);
    });

    it("hides everything from a null viewer", () => {
      expect(visibleProjectsFor(projects, null)).toEqual([]);
    });
  });
});
