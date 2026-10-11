import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FieldFeedbackModal } from "@/features/estimator/workspace/pages/components/FieldFeedbackModal";
import type { FieldFeedbackAnswers, FieldFeedbackRequest } from "@/shared/types/fieldFeedback.types";
import { useFieldFeedbackQueue } from "./useFieldFeedbackQueue";

const onResolved = vi.fn();

/** Mirrors how a stage screen uses the hook: collect on Update, then save. */
const Harness = ({ requests }: { requests: FieldFeedbackRequest[] }) => {
  const { collect, modalProps } = useFieldFeedbackQueue();

  return (
    <div>
      <FieldFeedbackModal {...modalProps} />
      <button type="button" onClick={async () => onResolved(await collect(requests))}>
        Update
      </button>
    </div>
  );
};

const requestFor = (key: string, label: string): FieldFeedbackRequest => ({
  key,
  label,
  previousValue: "old",
  newValue: "new",
});

const clickUpdate = () => fireEvent.click(screen.getByText("Update"));
const chooseReason = (value: string) => fireEvent.change(screen.getByLabelText("Reason"), { target: { value } });

const answers = (): FieldFeedbackAnswers => onResolved.mock.calls[0]![0] as FieldFeedbackAnswers;

beforeEach(() => vi.clearAllMocks());

describe("useFieldFeedbackQueue", () => {
  it("resolves immediately with no modal when nothing changed", async () => {
    render(<Harness requests={[]} />);

    clickUpdate();

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows one modal per changed field, in order", async () => {
    render(
      <Harness
        requests={[requestFor("a", "Project Name"), requestFor("b", "Contact Name")]}
      />
    );

    clickUpdate();

    await screen.findByText("Project Name");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    chooseReason("OTHER");
    fireEvent.click(screen.getByText("Save"));

    await screen.findByText("Contact Name");
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("resolves null for a skipped field and still returns the others", async () => {
    render(
      <Harness
        requests={[requestFor("a", "Project Name"), requestFor("b", "Contact Name")]}
      />
    );

    clickUpdate();
    await screen.findByText("Project Name");
    fireEvent.click(screen.getByText("Close"));

    await screen.findByText("Contact Name");
    chooseReason("AI_READ_IT_WRONG");
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(answers()).toEqual({ a: null, b: { reasonCode: "AI_READ_IT_WRONG" } });
  });

  it("closes the modal once the last field is answered", async () => {
    render(<Harness requests={[requestFor("a", "Project Name")]} />);

    clickUpdate();
    await screen.findByText("Project Name");
    chooseReason("OTHER");
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("groups every changed column of one takeoff unit into a single modal", async () => {
    render(
      <Harness
        requests={[
          {
            key: "units.A",
            label: "Takeoff unit A",
            previousValue: 40,
            newValue: 48,
            changedColumns: ["Width", "Length", "Panels"],
          },
        ]}
      />
    );

    clickUpdate();

    await screen.findByText("Takeoff unit A");
    expect(screen.getByText("Changed: Width, Length, Panels")).toBeInTheDocument();
    expect(screen.queryByText("1 of 3")).not.toBeInTheDocument();
  });
});
