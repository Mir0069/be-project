import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/features/projects/context/ProjectRouteContext", () => ({ useProjectRoute: vi.fn() }));
vi.mock("@/features/teams-call/query/teamsCallQuery", () => ({ useCallDirectory: vi.fn(), useEstimatorDirectory: vi.fn() }));

import { useAuth } from "@/context/AuthContext";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { useCallDirectory, useEstimatorDirectory } from "@/features/teams-call/query/teamsCallQuery";
import WorkspaceHeader from "./WorkspaceHeader";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const project = {
  projectName: "72 Ever Green",
  jobAddress: null,
  address: null,
  assignedEstimators: [{ id: "e1", name: "Eve Estimator", email: "eve@gfs.com" }],
};

const renderHeader = () =>
  render(
    <MemoryRouter>
      <WorkspaceHeader />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useAuth).mockReturnValue({ user: { id: "me", role: "SALES_MANAGER" } });
  asMock(useCallDirectory).mockReturnValue({ data: [], isLoading: false, isError: false });
  asMock(useEstimatorDirectory).mockReturnValue({ data: [], isLoading: false, isError: false });
});

describe("WorkspaceHeader", () => {
  it("keeps the project title and adds the Discuss on Teams button", () => {
    asMock(useProjectRoute).mockReturnValue({ project });
    renderHeader();

    expect(screen.getByText(/project workspace: 72 ever green/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discuss on teams/i })).toBeInTheDocument();
  });

  it("passes the project's estimators into the picker", () => {
    asMock(useProjectRoute).mockReturnValue({ project });
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: /discuss on teams/i }));

    expect(screen.getByRole("checkbox", { name: /eve estimator/i })).toBeInTheDocument();
  });

  it("waits for the project to load before offering a call", () => {
    asMock(useProjectRoute).mockReturnValue({ project: undefined });
    renderHeader();

    expect(screen.getByText("Project Workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discuss on teams/i })).not.toBeInTheDocument();
  });
});
