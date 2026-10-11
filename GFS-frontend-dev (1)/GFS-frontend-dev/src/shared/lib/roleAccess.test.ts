import { describe, expect, it } from "vitest";

import { canManageRole, formatRoleLabel, hasAnyRole } from "./roleAccess";

describe("hasAnyRole", () => {
  it.each(["SYSTEM_ADMIN", "SALES_MANAGER", "ESTIMATOR"])(
    "lets Head of Division satisfy a %s check",
    (role) => {
      expect(hasAnyRole("HEAD_OF_DIVISION", [role])).toBe(true);
    },
  );

  it("does not give Head of Division Super Admin access", () => {
    expect(hasAnyRole("HEAD_OF_DIVISION", ["SUPER_ADMIN"])).toBe(false);
  });

  it("keeps the existing roles as exact matches", () => {
    expect(hasAnyRole("SALES_MANAGER", ["SALES_MANAGER", "SYSTEM_ADMIN"])).toBe(true);
    expect(hasAnyRole("ESTIMATOR", ["SALES_MANAGER", "SYSTEM_ADMIN"])).toBe(false);
    expect(hasAnyRole("SYSTEM_ADMIN", ["HEAD_OF_DIVISION"])).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(hasAnyRole(undefined, ["ESTIMATOR"])).toBe(false);
    expect(hasAnyRole(null, ["ESTIMATOR"])).toBe(false);
  });
});

describe("canManageRole", () => {
  it("only lets a Super Admin manage a Head of Division", () => {
    expect(canManageRole("SUPER_ADMIN", "HEAD_OF_DIVISION")).toBe(true);
    expect(canManageRole("SYSTEM_ADMIN", "HEAD_OF_DIVISION")).toBe(false);
    expect(canManageRole("HEAD_OF_DIVISION", "HEAD_OF_DIVISION")).toBe(false);
  });

  it("leaves other roles manageable as before", () => {
    expect(canManageRole("SYSTEM_ADMIN", "ESTIMATOR")).toBe(true);
    expect(canManageRole("HEAD_OF_DIVISION", "SALES_MANAGER")).toBe(true);
  });
});

describe("formatRoleLabel", () => {
  it("replaces every underscore", () => {
    expect(formatRoleLabel("HEAD_OF_DIVISION")).toBe("HEAD OF DIVISION");
    expect(formatRoleLabel("SALES_MANAGER")).toBe("SALES MANAGER");
  });
});
