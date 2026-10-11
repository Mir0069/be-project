import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FullEmailModal from "./FullEmailModal";
import type { DraftProject } from "@/features/sales-manager/query/draftsQuery";

const draft: DraftProject = {
  id: "draft-1",
  messageId: "message-1",
  subject: "Glass flooring drawings",
  fromName: "Awais",
  fromAddress: "awais@example.com",
  receivedDateTime: "2026-09-20T10:00:00.000Z",
  bodyText: "Please review the complete drawing package.",
};

describe("FullEmailModal", () => {
  it("shows the complete email and closes from the modal action", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<FullEmailModal draft={draft} onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Please review the complete drawing package.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<FullEmailModal draft={draft} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
