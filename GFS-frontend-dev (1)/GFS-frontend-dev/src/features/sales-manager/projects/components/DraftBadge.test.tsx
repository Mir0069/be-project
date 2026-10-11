import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DraftBadge from "./DraftBadge";

const { useUnreadDraftAlertCount } = vi.hoisted(() => ({ useUnreadDraftAlertCount: vi.fn() }));

vi.mock("@/features/notifications/query/notificationsQuery", () => ({ useUnreadDraftAlertCount }));

describe("DraftBadge", () => {
  it("shows the unread draft-alert count", () => {
    useUnreadDraftAlertCount.mockReturnValue({ data: 2 });

    render(<DraftBadge />);

    expect(screen.getByLabelText("2 unread draft alerts")).toHaveTextContent("2");
  });

  it("stays hidden when there are no drafts", () => {
    useUnreadDraftAlertCount.mockReturnValue({ data: 0 });

    const { container } = render(<DraftBadge />);

    expect(container).toBeEmptyDOMElement();
  });
});
