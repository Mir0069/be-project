import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FieldFeedbackModal } from "./FieldFeedbackModal";

const onSkip = vi.fn();
const onSave = vi.fn();

const request = {
  key: "stage_1.project_name",
  label: "Project Name",
  previousValue: "1500 CLINTON",
  newValue: "1500 Clinton Street",
};

const renderModal = (props: Partial<React.ComponentProps<typeof FieldFeedbackModal>> = {}) =>
  render(
    <FieldFeedbackModal open request={request} onSkip={onSkip} onSave={onSave} {...props} />
  );

const chooseReason = (value: string) => fireEvent.change(screen.getByLabelText("Reason"), { target: { value } });

beforeEach(() => vi.clearAllMocks());

describe("FieldFeedbackModal", () => {
  it("renders the field label, the previous value and the new value", () => {
    renderModal();

    expect(screen.getByText("Project Name")).toBeInTheDocument();
    expect(screen.getByText("1500 CLINTON")).toBeInTheDocument();
    expect(screen.getByText("1500 Clinton Street")).toBeInTheDocument();
  });

  it("shows only the national number when the phone number changes", () => {
    renderModal({
      request: {
        key: "stage_1.contact_phone",
        label: "Contact Phone",
        previousValue: "+1 862.253.4228",
        newValue: "+1 617.555.0199",
      },
    });

    expect(screen.getByText("862.253.4228")).toBeInTheDocument();
    expect(screen.getByText("617.555.0199")).toBeInTheDocument();
    expect(screen.queryByText("+1 862.253.4228")).not.toBeInTheDocument();
    expect(screen.queryByText("+1 617.555.0199")).not.toBeInTheDocument();
  });

  it("shows both country codes when only the country code changes", () => {
    renderModal({
      request: {
        key: "stage_1.contact_phone",
        label: "Contact Phone",
        previousValue: "+1 862.253.4228",
        newValue: "+44 862.253.4228",
      },
    });

    expect(screen.getByText("+1 862.253.4228")).toBeInTheDocument();
    expect(screen.getByText("+44 862.253.4228")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderModal({ open: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables Save until a reason is chosen", () => {
    renderModal();

    expect(screen.getByText("Save")).toBeDisabled();
    chooseReason("AI_READ_IT_WRONG");
    expect(screen.getByText("Save")).toBeEnabled();
  });

  it("calls onSave with the chosen reason and the typed note", () => {
    renderModal();

    chooseReason("WRONG_SOURCE");
    fireEvent.change(screen.getByLabelText("Additional note"), {
      target: { value: "  taken from the old revision  " },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith({
      reasonCode: "WRONG_SOURCE",
      note: "taken from the old revision",
    });
  });

  it("omits the note when it is left empty", () => {
    renderModal();

    chooseReason("COMPANY_STANDARD");
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith({ reasonCode: "COMPANY_STANDARD" });
  });

  it("calls onSkip on Close and never calls onSave", () => {
    renderModal();

    chooseReason("OTHER");
    fireEvent.click(screen.getByText("Close"));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("skips when the backdrop is clicked", () => {
    renderModal();

    fireEvent.click(screen.getByRole("dialog"));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("passes the changed columns through for a takeoff row", () => {
    renderModal({
      request: {
        key: "units.A",
        label: "Takeoff unit A",
        previousValue: 40,
        newValue: 48,
        changedColumns: ["Width", "Length"],
      },
    });

    expect(screen.getByText("Changed: Width, Length")).toBeInTheDocument();

    chooseReason("AI_READ_IT_WRONG");
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith({
      reasonCode: "AI_READ_IT_WRONG",
      changedColumns: ["Width", "Length"],
    });
  });

  it("shows the position when several fields are queued", () => {
    renderModal({ position: { index: 2, total: 3 } });

    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("resets the form between fields", () => {
    const { rerender } = renderModal();
    chooseReason("OTHER");

    rerender(
      <FieldFeedbackModal
        open
        request={{ ...request, key: "stage_1.contact_name", label: "Contact Name" }}
        onSkip={onSkip}
        onSave={onSave}
      />
    );

    expect(screen.getByLabelText("Reason")).toHaveValue("");
    expect(screen.getByText("Save")).toBeDisabled();
  });
});
