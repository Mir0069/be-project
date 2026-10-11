import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoleGuard from "./RoleGuard";
import type { UserRole } from "@/shared/types/auth.types";

const auth = vi.hoisted(() => ({ role: "HEAD_OF_DIVISION" as string }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ loading: false, user: { id: "user-1", role: auth.role } }),
}));

vi.mock("@/components/ui/Splash", () => ({ default: () => <p>Loading</p> }));

const renderGuarded = (allowedRoles: UserRole[]) =>
  render(
    <MemoryRouter initialEntries={["/guarded"]}>
      <Routes>
        <Route
          path="/guarded"
          element={
            <RoleGuard allowedRoles={allowedRoles}>
              <p>Guarded page</p>
            </RoleGuard>
          }
        />
        <Route path="/sales-manager" element={<p>Sales dashboard</p>} />
        <Route path="/sys-admin" element={<p>Admin dashboard</p>} />
        <Route path="/estimator" element={<p>Estimator dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("RoleGuard", () => {
  afterEach(() => {
    auth.role = "HEAD_OF_DIVISION";
  });

  it.each<[string, UserRole[]]>([
    ["system admin", ["SUPER_ADMIN", "SYSTEM_ADMIN"]],
    ["sales manager", ["SALES_MANAGER", "SYSTEM_ADMIN"]],
    ["estimator", ["ESTIMATOR", "SYSTEM_ADMIN"]],
    ["project workspace", ["ESTIMATOR", "SYSTEM_ADMIN", "SALES_MANAGER"]],
  ])("lets a head of division open %s routes", (_label, allowedRoles) => {
    renderGuarded(allowedRoles);
    expect(screen.getByText("Guarded page")).toBeInTheDocument();
  });

  it("sends a head of division away from Super Admin-only routes", () => {
    renderGuarded(["SUPER_ADMIN"]);
    expect(screen.queryByText("Guarded page")).not.toBeInTheDocument();
    expect(screen.getByText("Sales dashboard")).toBeInTheDocument();
  });

  it("still redirects an estimator away from sales manager routes", () => {
    auth.role = "ESTIMATOR";
    renderGuarded(["SALES_MANAGER", "SYSTEM_ADMIN"]);
    expect(screen.getByText("Estimator dashboard")).toBeInTheDocument();
  });

  it("does not let a system admin into a head of division-only route", () => {
    auth.role = "SYSTEM_ADMIN";
    renderGuarded(["HEAD_OF_DIVISION"]);
    expect(screen.getByText("Admin dashboard")).toBeInTheDocument();
  });
});
