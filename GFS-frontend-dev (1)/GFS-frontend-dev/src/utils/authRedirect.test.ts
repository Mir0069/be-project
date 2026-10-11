import { describe, expect, it } from "vitest";

import { getDashboardRoute } from "./authRedirect";

describe("getDashboardRoute", () => {
  it("lands a head of division on the sales manager dashboard", () => {
    expect(getDashboardRoute("HEAD_OF_DIVISION")).toBe("/sales-manager");
  });

  it("keeps the existing landing routes", () => {
    expect(getDashboardRoute("SUPER_ADMIN")).toBe("/sys-admin");
    expect(getDashboardRoute("SYSTEM_ADMIN")).toBe("/sys-admin");
    expect(getDashboardRoute("SALES_MANAGER")).toBe("/sales-manager");
    expect(getDashboardRoute("ESTIMATOR")).toBe("/estimator");
    expect(getDashboardRoute(null)).toBe("/login");
  });
});
