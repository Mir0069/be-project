import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import UserTable from "./UserTable";

const auth = vi.hoisted(() => ({ role: "SYSTEM_ADMIN" as string }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: auth.role }),
}));

vi.mock("../query/manage-user.query", () => ({
  useUsers: () => ({
    data: [
      { id: "hod-1", firstName: "Hana", lastName: "Head", email: "hana@gfs.test", role: "HEAD_OF_DIVISION", isActive: true },
      { id: "est-1", firstName: "Eli", lastName: "Est", email: "eli@gfs.test", role: "ESTIMATOR", isActive: true },
    ],
    isLoading: false,
    isError: false,
  }),
  useResetUserPassword: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
}));

const resetButtonFor = (email: string) => {
  const row = screen.getByText(email).closest("tr") as HTMLElement;
  return within(row).getByRole("button", { name: /reset password/i });
};

describe("UserTable head of division rows", () => {
  afterEach(() => {
    auth.role = "SYSTEM_ADMIN";
  });

  it("labels the Head of Division role in full", () => {
    render(<UserTable />);
    expect(screen.getByText("HEAD OF DIVISION")).toBeInTheDocument();
  });

  it.each(["SYSTEM_ADMIN", "HEAD_OF_DIVISION"])(
    "stops %s from resetting a Head of Division password",
    (role) => {
      auth.role = role;
      render(<UserTable />);

      expect(resetButtonFor("hana@gfs.test")).toBeDisabled();
      expect(resetButtonFor("eli@gfs.test")).toBeEnabled();
    },
  );

  it("lets a Super Admin reset a Head of Division password", () => {
    auth.role = "SUPER_ADMIN";
    render(<UserTable />);

    expect(resetButtonFor("hana@gfs.test")).toBeEnabled();
  });
});
