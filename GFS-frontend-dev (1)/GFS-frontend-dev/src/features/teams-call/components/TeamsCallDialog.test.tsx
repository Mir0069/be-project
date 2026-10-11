import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/features/teams-call/query/teamsCallQuery", () => ({
  useCallDirectory: vi.fn(),
  useEstimatorDirectory: vi.fn(),
}));

import { useCallDirectory, useEstimatorDirectory } from "@/features/teams-call/query/teamsCallQuery";
import type { CallDirectoryUser } from "@/services/teams-call";
import { TeamsCallDialog } from "./TeamsCallDialog";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const directory: CallDirectoryUser[] = [
  { id: "s1", firstName: "Sam", lastName: "Sales", email: "sam@gfs.com", role: "SALES_MANAGER" },
  { id: "h1", firstName: "Hana", lastName: "Head", email: "hana@gfs.com", role: "HEAD_OF_DIVISION" },
];
const estimatorDirectory: CallDirectoryUser[] = [
  { id: "x1", firstName: "Xena", lastName: "Estimator", email: "xena@gfs.com", role: "ESTIMATOR" },
];
const assigned = [{ id: "e1", name: "Eve Estimator", email: "eve@gfs.com" }];

type QueryState = Partial<{ data: CallDirectoryUser[] | undefined; isLoading: boolean; isError: boolean }>;

const mockDirectory = (o: QueryState = {}) =>
  asMock(useCallDirectory).mockReturnValue({ data: directory, isLoading: false, isError: false, ...o });

// Mirrors the real hook: disabled for callers who may not list estimators, so it returns no data.
const mockEstimators = (o: QueryState = {}) =>
  asMock(useEstimatorDirectory).mockImplementation((enabled: boolean) => ({
    data: enabled ? estimatorDirectory : undefined,
    isLoading: false,
    isError: false,
    ...o,
  }));

const onClose = vi.fn();
const renderDialog = (people = assigned, callerRole = "SALES_MANAGER") =>
  render(<TeamsCallDialog assigned={people} selfId="me" callerRole={callerRole} onClose={onClose} />);

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDirectory();
  mockEstimators();
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  openSpy.mockRestore();
});

describe("TeamsCallDialog", () => {
  it("groups people as project, sales managers, estimators, then heads of division", () => {
    renderDialog();

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["On this project", "Sales Managers", "Estimators", "Heads of Division"]);
    expect(within(screen.getByRole("region", { name: "On this project" })).getByText("Eve Estimator")).toBeInTheDocument();
  });

  it("lets a head of division call an estimator who is not on the project", () => {
    renderDialog(assigned, "HEAD_OF_DIVISION");

    expect(useEstimatorDirectory).toHaveBeenCalledWith(true);
    expect(within(screen.getByRole("region", { name: "Estimators" })).getByText("Xena Estimator")).toBeInTheDocument();
  });

  it("does not ask for the estimator list when an estimator is calling", () => {
    renderDialog(assigned, "ESTIMATOR");

    expect(useEstimatorDirectory).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("region", { name: "Estimators" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "On this project" })).toBeInTheDocument();
  });

  it("keeps Start call disabled until someone is picked", () => {
    renderDialog();
    const start = screen.getByRole("button", { name: /start call/i });

    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /sam sales/i }));
    expect(start).toBeEnabled();
  });

  it("opens one Teams call for everyone picked, in pick order, then closes", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: /eve estimator/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sam sales/i }));
    fireEvent.click(screen.getByRole("button", { name: /start call \(2\)/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://teams.microsoft.com/l/call/0/0?users=eve%40gfs.com,sam%40gfs.com&withVideo=true",
      "_blank",
      "noopener,noreferrer",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles a person off when clicked again or removed from the chips", () => {
    renderDialog();
    const sam = screen.getByRole("checkbox", { name: /sam sales/i });

    fireEvent.click(sam);
    expect(sam).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Remove Sam Sales" }));
    expect(sam).toHaveAttribute("aria-checked", "false");
  });

  it("narrows the list by search", () => {
    renderDialog();

    fireEvent.change(screen.getByRole("textbox", { name: /search people/i }), { target: { value: "hana" } });

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /hana head/i })).toBeInTheDocument();
  });

  it("says so when nobody matches the search", () => {
    renderDialog();

    fireEvent.change(screen.getByRole("textbox", { name: /search people/i }), { target: { value: "zzz" } });

    expect(screen.getByText('No one matches "zzz".')).toBeInTheDocument();
  });

  it("stops at the Teams group call limit", () => {
    const crowd = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, email: `p${i}@gfs.com` }));
    mockDirectory({ data: [] });
    renderDialog(crowd, "ESTIMATOR");
    const boxes = screen.getAllByRole("checkbox");

    boxes.slice(0, 19).forEach((box) => fireEvent.click(box));

    expect(boxes[19]).toBeDisabled();
    expect(screen.getByText(/limited to 20 people/i)).toBeInTheDocument();
  });

  it("still lets you call project people when a list fails to load", () => {
    mockDirectory({ data: undefined, isError: true });
    renderDialog();

    expect(screen.getByText(/couldn't load the full list/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /eve estimator/i })).toBeEnabled();
  });

  it("shows a loading line while a list is fetched", () => {
    mockDirectory({ data: undefined, isLoading: true });
    renderDialog();

    expect(screen.getByText(/loading people/i)).toBeInTheDocument();
  });

  it("closes on Escape without starting a call", () => {
    renderDialog();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
