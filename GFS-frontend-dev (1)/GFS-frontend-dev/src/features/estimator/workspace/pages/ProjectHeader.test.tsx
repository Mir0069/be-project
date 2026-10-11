import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/features/projects/query/proposalsQuery", () => ({
  useProposalStage: vi.fn(),
  useSaveStageFields: vi.fn(),
  useApproveProposalStage: vi.fn(),
  useUnapproveProposalStage: vi.fn(),
}));

// The stage pages render CitationLink, which pulls the project's documents through
// react-query. Stub it so this test needs no QueryClientProvider and stays about feedback.
vi.mock("@/features/projects/query/documentsQuery", () => ({
  useDocuments: () => ({ data: [] }),
  usePreviewDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/toast", () => ({ showToast: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isSalesManager: false }) }));
vi.mock("@/features/projects/context/ProjectRouteContext", () => ({
  useProjectRoute: () => ({ projectId: "p1", publicProjectKey: "GFS-2026-1008" }),
}));

import {
  useApproveProposalStage,
  useProposalStage,
  useSaveStageFields,
  useUnapproveProposalStage,
} from "@/features/projects/query/proposalsQuery";
import ProjectHeader from "./ProjectHeader";

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const saveFields = vi.fn();
const approveStage = vi.fn();
const refetch = vi.fn();

const stage = {
  status: "PENDING_APPROVAL",
  fields_to_show: {
    project_name: { value: "1500 CLINTON", reasoning: ["Title block lists the name."] },
    architect: { value: "MHS Architecture" },
    homeowner: { value: null },
  },
};

const setup = () => {
  asMock(useProposalStage).mockReturnValue({
    data: stage,
    isLoading: false,
    isError: false,
    refetch,
  });
  asMock(useSaveStageFields).mockReturnValue({ mutateAsync: saveFields, isPending: false });
  asMock(useApproveProposalStage).mockReturnValue({
    mutateAsync: approveStage,
    isPending: false,
    isError: false,
    isSuccess: false,
  });
  asMock(useUnapproveProposalStage).mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
};

const editField = (currentValue: string, nextValue: string) =>
  fireEvent.change(screen.getByDisplayValue(currentValue), { target: { value: nextValue } });

const clickUpdate = () => fireEvent.click(screen.getByRole("button", { name: "Update" }));

const savedFields = () => asMock(saveFields).mock.calls[0]![0].fields;

beforeEach(() => {
  vi.clearAllMocks();
  setup();
  saveFields.mockResolvedValue({});
  approveStage.mockResolvedValue({});
});

describe("ProjectHeader — field feedback on Update", () => {
  it("asks for a reason when an AI value is overwritten", async () => {
    render(<ProjectHeader />);

    editField("1500 CLINTON", "1500 Clinton Street");
    clickUpdate();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Project Name")).toBeInTheDocument();
    expect(within(dialog).getByText("1500 CLINTON")).toBeInTheDocument();
  });

  it("sends the feedback alongside the field patch when the popup is saved", async () => {
    render(<ProjectHeader />);

    editField("1500 CLINTON", "1500 Clinton Street");
    clickUpdate();

    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "AI_READ_IT_WRONG" } });
    fireEvent.change(screen.getByLabelText("Additional note"), { target: { value: "title block was clearer" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(saveFields).toHaveBeenCalled());
    expect(savedFields()).toEqual([
      {
        fieldPath: "stage_1.project_name",
        value: "1500 Clinton Street",
        feedback: { reasonCode: "AI_READ_IT_WRONG", note: "title block was clearer" },
      },
    ]);
  });

  it("saves the edited value even when the estimator closes the popup", async () => {
    render(<ProjectHeader />);

    editField("1500 CLINTON", "1500 Clinton Street");
    clickUpdate();

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(saveFields).toHaveBeenCalled());
    expect(savedFields()).toEqual([
      { fieldPath: "stage_1.project_name", value: "1500 Clinton Street" },
    ]);
  });

  it("does not open the popup for a field that was blank before the edit", async () => {
    render(<ProjectHeader />);

    editField("", "Jane Homeowner");
    clickUpdate();

    await waitFor(() => expect(saveFields).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(savedFields()).toEqual([
      { fieldPath: "stage_1.homeowner", value: "Jane Homeowner" },
    ]);
  });

  it("uses readable project type labels and ignores casing-only edits", async () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        ...stage,
        fields_to_show: {
          ...stage.fields_to_show,
          project_type: {
            value: "Residential",
            _meta: { allowed_values: ["RESIDENTIAL", "COMMERCIAL"] },
          },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    const projectType = screen.getByRole("combobox");
    expect(projectType).toHaveValue("RESIDENTIAL");
    expect(within(projectType).getByRole("option", { name: "RESIDENTIAL" })).toBeInTheDocument();
    fireEvent.change(projectType, { target: { value: "RESIDENTIAL" } });
    clickUpdate();

    await waitFor(() => expect(saveFields).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("accepts a mixed-case project type during approval", async () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        ...stage,
        fields_to_show: {
          ...stage.fields_to_show,
          project_type: {
            value: "Commercial",
            _meta: { allowed_values: ["RESIDENTIAL", "COMMERCIAL"] },
          },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Approve Data" }));

    await waitFor(() => expect(approveStage).toHaveBeenCalledWith({ projectId: "p1", stage: 1 }));
    expect(screen.queryByText("Select one of: RESIDENTIAL, COMMERCIAL.")).not.toBeInTheDocument();
  });

  it("asks once per changed field when several are edited together", async () => {
    render(<ProjectHeader />);

    editField("1500 CLINTON", "1500 Clinton Street");
    editField("MHS Architecture", "MHS Architects");
    clickUpdate();

    await screen.findByRole("dialog");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close"));
    await screen.findByText("2 of 2");
    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => expect(saveFields).toHaveBeenCalled());
    expect(savedFields()).toHaveLength(2);
  });

  it("does not render composite header reasoning as a project field", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "PENDING_APPROVAL",
        fields_to_show: {
          project_name: { value: "214 Hudson St" },
          project_address: { value: "214 Hudson St, NJ" },
          contact_name: { value: "Anthony Viganola" },
          _signals: {
            contact_name: { reasoning: "Extracted from sender line in email" },
          },
          reasoning:
            "Header Extraction: project_name: The email line begins with '214 Hudson St - Series 2000' | project_address: The only location-like text provided is 214 Hudson St",
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    const rowsWithReasoningParameter = screen
      .getAllByRole("row")
      .filter((row) => within(row).queryByRole("cell", { name: "Reasoning" }));
    expect(rowsWithReasoningParameter).toHaveLength(0);
    expect(screen.queryByDisplayValue("Header Extraction: project_name: The email line begins with '214 Hudson St - Series 2000' | project_address: The only location-like text provided is 214 Hudson St")).not.toBeInTheDocument();
  });

  it("does not render quote number in the table even if provided in legacy payload", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "PENDING_APPROVAL",
        fields_to_show: {
          project_name: { value: "1500 CLINTON" },
          quote_number: { value: "Q-12345" },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.queryByText("Quote Number")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Q-12345")).not.toBeInTheDocument();
  });

  it("hides internal validation fields from the project header table", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "PENDING_APPROVAL",
        fields_to_show: {
          project_name: { value: "1500 CLINTON" },
          person_checked: { value: "Not provided" },
          header_validation: { value: { source: "intake" } },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.queryByText("Person Checked")).not.toBeInTheDocument();
    expect(screen.queryByText("Header Validation")).not.toBeInTheDocument();
  });

  it("hides validation metadata even when the backend uses a display-style key", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "PENDING_APPROVAL",
        fields_to_show: {
          project_name: { value: "1500 CLINTON" },
          "Header Validation": { value: { source: "intake" } },
          headerValidation: { value: { source: "intake" } },
          "header.validation": { value: { source: "intake" } },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.queryByText("Header Validation")).not.toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });

  it("hides the AI's Zoho note summary from the project header table", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "PENDING_APPROVAL",
        fields_to_show: {
          project_name: { value: "1500 CLINTON" },
          crm_note_summary: { value: "Customer wants IGU glass and a Series 3000 frame." },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.queryByText("Crm Note Summary")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Customer wants IGU glass and a Series 3000 frame.")).not.toBeInTheDocument();
    expect(screen.queryByText("Customer wants IGU glass and a Series 3000 frame.")).not.toBeInTheDocument();
  });

  it("renders person quoting as a select dropdown with assigned estimators and saves selection", async () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "PENDING_APPROVAL",
        fields_to_show: {
          project_name: { value: "1500 CLINTON" },
          person_quoting: {
            value: "John Doe",
            _meta: {
              allowed_values: ["John Doe", "Jane Smith", "John Doe & Jane Smith"],
            },
          },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.getByText("Person Quoting")).toBeInTheDocument();
    const select = screen.getByDisplayValue("John Doe");
    expect(select.tagName).toBe("SELECT");
    expect(within(select).getByRole("option", { name: "Jane Smith" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "John Doe & Jane Smith" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "Jane Smith" } });
    clickUpdate();

    const closeBtn = await screen.findByText("Close");
    fireEvent.click(closeBtn);

    await waitFor(() => expect(saveFields).toHaveBeenCalled());
    expect(savedFields()).toEqual([
      { fieldPath: "stage_1.person_quoting", value: "Jane Smith" },
    ]);
  });

  it("renders multiple customer phone numbers separately", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "APPROVED",
        fields_to_show: {
          project_name: { value: "Aspen Deck Project" },
          contact_phone: { value: "(801) 483-1660 (801) 635-6312 (801) 887-7226" },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.getByText("Customer Phone")).toBeInTheDocument();
    expect(screen.getByText(/\(801\) 483-1660/)).toBeInTheDocument();
    expect(screen.getByText(/\(801\) 635-6312/)).toBeInTheDocument();
    expect(screen.getByText(/\(801\) 887-7226/)).toBeInTheDocument();
  });

  it("shows a clear state for missing approved header values", () => {
    asMock(useProposalStage).mockReturnValue({
      data: {
        status: "APPROVED",
        fields_to_show: {
          project_name: { value: "182 Robinson St" },
          project_type: { value: null },
          contact_email: { value: "" },
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });

    render(<ProjectHeader />);

    expect(screen.getAllByText("Not provided")).toHaveLength(2);
  });
});
