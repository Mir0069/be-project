import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/projects/query/teamsQuery", () => ({
  useConnectTeamsProvisioning: vi.fn(),
  useCreateTeamsWorkspace: vi.fn(),
}));

import {
  useConnectTeamsProvisioning,
  useCreateTeamsWorkspace,
} from "@/features/projects/query/teamsQuery";
import { ProvisioningDecision } from "./ProvisioningDecision";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const connectMutate = vi.fn();
const createMutate = vi.fn();
const onManualConnect = vi.fn();

const CANDIDATES = [
  {
    teamId: "t1",
    teamName: "GFS - 182 Robinson Street",
    channelId: "c1",
    channelName: "182 Robinson St discussion",
    score: 0.95,
  },
  {
    teamId: "t2",
    teamName: "Client Projects",
    channelId: "c2",
    channelName: "182 Robinson St",
    score: 0.6,
  },
];

const renderCard = (candidates = CANDIDATES) =>
  render(
    <ProvisioningDecision
      projectId="p1"
      candidates={candidates}
      onManualConnect={onManualConnect}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  asMock(useConnectTeamsProvisioning).mockReturnValue({ mutate: connectMutate, isPending: false });
  asMock(useCreateTeamsWorkspace).mockReturnValue({
    mutate: createMutate,
    isPending: false,
    isError: false,
  });
});

describe("ProvisioningDecision — candidates found", () => {
  it("asks the user to confirm, showing both team and channel names", () => {
    renderCard();

    expect(screen.getByText(/We found this team and channel/)).toBeInTheDocument();
    expect(screen.getByText("GFS - 182 Robinson Street")).toBeInTheDocument();
    expect(screen.getByText("182 Robinson St discussion")).toBeInTheDocument();
    expect(screen.getByText("Client Projects")).toBeInTheDocument();
    expect(screen.getAllByText("Connect")).toHaveLength(2);
  });

  it("marks only the top candidate as the best match", () => {
    renderCard();
    expect(screen.getAllByText("Best match")).toHaveLength(1);
  });

  it("never shows the raw match score", () => {
    renderCard();
    expect(screen.queryByText(/0\.95/)).toBeNull();
    expect(screen.queryByText(/0\.6/)).toBeNull();
  });

  it("connects the candidate that was clicked", () => {
    renderCard();

    fireEvent.click(screen.getAllByText("Connect")[1]!);

    expect(connectMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        teamId: "t2",
        teamName: "Client Projects",
        channelId: "c2",
        channelName: "182 Robinson St",
      }),
      expect.anything(),
    );
    expect(connectMutate.mock.calls[0]![0]).not.toHaveProperty("force");
  });

  it("arms only the row that came back already-linked", () => {
    connectMutate.mockImplementation((_vars, opts) => {
      opts.onError({
        data: { error: { message: "Already on 7 Maple Ave.", details: { alreadyLinked: true } } },
      });
    });
    renderCard();

    fireEvent.click(screen.getAllByText("Connect")[0]!);

    expect(screen.getByText("Connect anyway")).toBeInTheDocument();
    expect(screen.getAllByText("Connect")).toHaveLength(1);
    expect(screen.getByText("Already on 7 Maple Ave.")).toBeInTheDocument();
  });

  it("retries with force once the user confirms", () => {
    connectMutate.mockImplementation((_vars, opts) => {
      opts.onError({ data: { error: { message: "linked", details: { alreadyLinked: true } } } });
    });
    renderCard();

    fireEvent.click(screen.getAllByText("Connect")[0]!);
    fireEvent.click(screen.getByText("Connect anyway"));

    expect(connectMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ channelId: "c1", force: true }),
      expect.anything(),
    );
  });

  it('reveals the fallback actions behind "None of these"', () => {
    renderCard();

    expect(screen.queryByText("Create automatically")).toBeNull();
    fireEvent.click(screen.getByText("None of these"));

    expect(screen.getByText("Create automatically")).toBeInTheDocument();
    expect(screen.getByText("Connect manually")).toBeInTheDocument();
  });
});

describe("ProvisioningDecision — nothing found", () => {
  it("offers both fallback actions straight away", () => {
    renderCard([]);

    expect(screen.getByText(/could not find a team and channel/)).toBeInTheDocument();
    expect(screen.getByText("Create automatically")).toBeInTheDocument();
    expect(screen.getByText("Connect manually")).toBeInTheDocument();
  });

  it("asks the backend to create the workspace", () => {
    renderCard([]);
    fireEvent.click(screen.getByText("Create automatically"));
    expect(createMutate).toHaveBeenCalledWith({ projectId: "p1" });
  });

  it("hands manual connect back to the parent", () => {
    renderCard([]);
    fireEvent.click(screen.getByText("Connect manually"));
    expect(onManualConnect).toHaveBeenCalled();
  });

  it("explains on hover what each action will do", () => {
    renderCard([]);

    expect(screen.getByText("Create automatically").closest("button")).toHaveAttribute(
      "title",
      expect.stringContaining("Creates a new private team") as unknown as string,
    );
    expect(screen.getByText("Connect manually").closest("button")).toHaveAttribute(
      "title",
      expect.stringContaining("Nothing new is created") as unknown as string,
    );
  });

  it("renders both fallback actions as buttons of the same shape", () => {
    renderCard([]);

    const create = screen.getByText("Create automatically").closest("button")!;
    const manual = screen.getByText("Connect manually").closest("button")!;

    for (const shape of ["inline-flex", "rounded-md", "px-4", "py-2", "text-sm", "font-medium"]) {
      expect(create.className).toContain(shape);
      expect(manual.className).toContain(shape);
    }
  });
});
