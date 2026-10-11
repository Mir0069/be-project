import { describe, it, expect } from "vitest";
import type { CallDirectoryUser } from "@/services/teams-call";
import {
  MAX_CALLEES,
  buildCallGroups,
  buildTeamsCallLink,
  canListEstimators,
  canStartTeamsCall,
  filterCallGroups,
} from "./teamsCall";

const sm = (id: string, firstName: string, email = `${id}@gfs.com`): CallDirectoryUser => ({
  id, firstName, lastName: "Sales", email, role: "SALES_MANAGER",
});
const hod = (id: string, firstName: string, email = `${id}@gfs.com`): CallDirectoryUser => ({
  id, firstName, lastName: "Head", email, role: "HEAD_OF_DIVISION",
});
const est = (id: string, firstName: string, email = `${id}@gfs.com`): CallDirectoryUser => ({
  id, firstName, lastName: "Estimator", email, role: "ESTIMATOR",
});

describe("buildTeamsCallLink", () => {
  it("builds the Teams call deep link with video on", () => {
    expect(buildTeamsCallLink(["a@gfs.com"])).toBe(
      "https://teams.microsoft.com/l/call/0/0?users=a%40gfs.com&withVideo=true",
    );
  });

  it("comma-joins several people and encodes each address", () => {
    expect(buildTeamsCallLink(["a+b@gfs.com", "c@gfs.com"])).toBe(
      "https://teams.microsoft.com/l/call/0/0?users=a%2Bb%40gfs.com,c%40gfs.com&withVideo=true",
    );
  });
});

describe("canStartTeamsCall", () => {
  it.each(["ESTIMATOR", "SALES_MANAGER", "HEAD_OF_DIVISION"])("allows %s", (role) => {
    expect(canStartTeamsCall(role)).toBe(true);
  });

  it.each(["SYSTEM_ADMIN", "SUPER_ADMIN", null, undefined])("blocks %s", (role) => {
    expect(canStartTeamsCall(role)).toBe(false);
  });
});

describe("canListEstimators", () => {
  it.each(["SALES_MANAGER", "HEAD_OF_DIVISION", "SYSTEM_ADMIN", "SUPER_ADMIN"])("allows %s", (role) => {
    expect(canListEstimators(role)).toBe(true);
  });

  it("blocks an estimator, because /users/estimators would answer 403", () => {
    expect(canListEstimators("ESTIMATOR")).toBe(false);
  });
});

describe("buildCallGroups", () => {
  it("orders groups project, sales managers, estimators, heads of division", () => {
    const groups = buildCallGroups(
      [{ id: "e1", name: "Eve", email: "eve@gfs.com" }],
      [hod("h1", "Hana"), est("x1", "Xena"), sm("s1", "Sam")],
    );

    expect(groups.map((g) => g.key)).toEqual(["project", "salesManagers", "estimators", "headsOfDivision"]);
    expect(groups[1].contacts).toEqual([{ id: "s1", name: "Sam Sales", email: "s1@gfs.com" }]);
    expect(groups[2].contacts).toEqual([{ id: "x1", name: "Xena Estimator", email: "x1@gfs.com" }]);
  });

  it("lets a head of division reach an estimator who is not on the project", () => {
    const groups = buildCallGroups([], [est("x1", "Xena")], "hodId");

    expect(groups.map((g) => g.key)).toEqual(["estimators"]);
  });

  it("leaves out the signed-in user", () => {
    const groups = buildCallGroups([{ id: "me", name: "Me", email: "me@gfs.com" }], [sm("s1", "Sam")], "me");

    expect(groups.map((g) => g.key)).toEqual(["salesManagers"]);
  });

  it("lists a person once, under the earliest group they belong to", () => {
    const onProject = [{ id: "x1", name: "Xena Estimator", email: "x1@gfs.com" }];
    const groups = buildCallGroups(onProject, [est("x1", "Xena")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("project");
  });

  it("drops people without an email, since they cannot be called", () => {
    const groups = buildCallGroups([{ id: "e1", name: "Eve", email: null }], []);

    expect(groups).toEqual([]);
  });

  it("sorts each group by name and falls back to the email for a blank name", () => {
    const groups = buildCallGroups(
      [
        { id: "e2", name: "Zed", email: "zed@gfs.com" },
        { id: "e1", name: "  ", email: "amy@gfs.com" },
      ],
      [],
    );

    expect(groups[0].contacts.map((c) => c.name)).toEqual(["amy@gfs.com", "Zed"]);
  });

  it("ignores directory roles it has no group for", () => {
    const admin = { ...sm("a1", "Ada"), role: "SYSTEM_ADMIN" as const };

    expect(buildCallGroups([], [admin])).toEqual([]);
  });
});

describe("filterCallGroups", () => {
  const groups = buildCallGroups([{ id: "e1", name: "Eve", email: "eve@gfs.com" }], [sm("s1", "Sam")]);

  it("returns every group for a blank query", () => {
    expect(filterCallGroups(groups, "  ")).toBe(groups);
  });

  it("matches name or email, case-insensitively, and drops empty groups", () => {
    expect(filterCallGroups(groups, "SAM").map((g) => g.key)).toEqual(["salesManagers"]);
    expect(filterCallGroups(groups, "eve@").map((g) => g.key)).toEqual(["project"]);
    expect(filterCallGroups(groups, "nobody")).toEqual([]);
  });
});

describe("MAX_CALLEES", () => {
  it("leaves room for the caller inside Teams' 20-person group call limit", () => {
    expect(MAX_CALLEES + 1).toBe(20);
  });
});
