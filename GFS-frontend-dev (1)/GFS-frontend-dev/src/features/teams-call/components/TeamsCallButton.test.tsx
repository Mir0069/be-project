import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/features/teams-call/query/teamsCallQuery", () => ({ useCallDirectory: vi.fn(), useEstimatorDirectory: vi.fn() }));

import { useAuth } from "@/context/AuthContext";
import { useCallDirectory, useEstimatorDirectory } from "@/features/teams-call/query/teamsCallQuery";
import { TeamsCallButton } from "./TeamsCallButton";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;
const signInAs = (role: string) => asMock(useAuth).mockReturnValue({ user: { id: "me", role } });

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useCallDirectory).mockReturnValue({ data: [], isLoading: false, isError: false });
  asMock(useEstimatorDirectory).mockReturnValue({ data: [], isLoading: false, isError: false });
});

describe("TeamsCallButton", () => {
  it.each(["ESTIMATOR", "SALES_MANAGER", "HEAD_OF_DIVISION"])("is offered to %s", (role) => {
    signInAs(role);
    render(<TeamsCallButton />);

    expect(screen.getByRole("button", { name: /discuss on teams/i })).toBeInTheDocument();
  });

  it.each(["SYSTEM_ADMIN", "SUPER_ADMIN"])("is hidden from %s", (role) => {
    signInAs(role);
    render(<TeamsCallButton />);

    expect(screen.queryByRole("button", { name: /discuss on teams/i })).not.toBeInTheDocument();
  });

  it("opens the picker with project people, minus the caller", () => {
    signInAs("ESTIMATOR");
    render(
      <TeamsCallButton
        assigned={[
          { id: "me", name: "Me Myself", email: "me@gfs.com" },
          { id: "e2", name: "Other Estimator", email: "other@gfs.com" },
        ]}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discuss on teams/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /other estimator/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /me myself/i })).not.toBeInTheDocument();
  });

  it("does not fetch the directory until the picker is opened", () => {
    signInAs("SALES_MANAGER");
    render(<TeamsCallButton />);

    expect(useCallDirectory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /discuss on teams/i }));
    expect(useCallDirectory).toHaveBeenCalled();
  });

  it("closes the picker from Cancel", () => {
    signInAs("SALES_MANAGER");
    render(<TeamsCallButton />);

    fireEvent.click(screen.getByRole("button", { name: /discuss on teams/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
