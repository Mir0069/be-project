import { describe, expect, it } from "vitest";

import { getSidebarItemsForPath } from "./sidebarItems";

describe("sales manager navigation", () => {
  it("uses the confirmed navigation order and routes", () => {
    const items = getSidebarItemsForPath("/sales-manager");

    expect(items.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: "Dashboard", path: "/sales-manager" },
      { label: "Project List", path: "/sales-manager/projects" },
      { label: "Kanban", path: "/sales-manager/project-kanban" },
      { label: "Drafts", path: "/sales-manager/drafts" },
      { label: "Partners", path: "/sales-manager/partners" },
      { label: "Notifications", path: "/sales-manager/notifications" },
      { label: "Audit Logs", path: "/sales-manager/audit-logs" },
    ]);
  });

  it("keeps the estimator Kanban link within the estimator routes", () => {
    const items = getSidebarItemsForPath("/estimator");

    expect(items.find((item) => item.label === "Kanban")?.path).toBe(
      "/estimator/project-kanban",
    );
  });

  it("keeps Dashboard, Project List and Kanban as separate estimator routes", () => {
    const items = getSidebarItemsForPath("/estimator");

    expect(items.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: "Dashboard", path: "/estimator" },
      { label: "Project List", path: "/estimator/projects" },
      { label: "Kanban", path: "/estimator/project-kanban" },
      { label: "Notifications", path: "/estimator/notifications" },
    ]);
  });
});

describe("head of division navigation", () => {
  const expected = [
    { label: "Dashboard", path: "/sales-manager" },
    { label: "Project List", path: "/sales-manager/projects" },
    { label: "Kanban", path: "/sales-manager/project-kanban" },
    { label: "Drafts", path: "/sales-manager/drafts" },
    { label: "Partners", path: "/sales-manager/partners" },
    { label: "Notifications", path: "/sales-manager/notifications" },
    { label: "Audit Logs", path: "/sales-manager/audit-logs" },
    { label: "Manage Users", path: "/sys-admin/manage-users" },
  ];

  it.each(["/sales-manager", "/sys-admin/manage-users", "/estimator/projects", "/sales-manager/drafts"])(
    "shows the sales manager menu plus Manage Users on %s",
    (pathname) => {
      const items = getSidebarItemsForPath(pathname, "HEAD_OF_DIVISION");

      expect(items.map(({ label, path }) => ({ label, path }))).toEqual(expected);
    },
  );

  it("leaves other roles on their path-based menus", () => {
    expect(getSidebarItemsForPath("/sys-admin", "SYSTEM_ADMIN").map((item) => item.label)).toEqual([
      "Dashboard",
      "Manage Users",
      "Audit Logs",
    ]);
    expect(getSidebarItemsForPath("/sales-manager", "SALES_MANAGER")).toHaveLength(7);
    expect(getSidebarItemsForPath("/estimator", "ESTIMATOR")).toHaveLength(4);
  });
});
