import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import NotificationsPage from "./NotificationsPage";

const auth = vi.hoisted(() => ({ role: "HEAD_OF_DIVISION" as string }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: auth.role }),
}));

vi.mock("@/features/notifications/query/notificationsQuery", () => ({
  useNotifications: () => ({
    data: {
      items: [
        {
          id: "draft-1",
          type: "DRAFT_REQUIRES_REVIEW",
          title: "New lead waiting",
          message: "Review the draft opportunity",
          projectId: null,
          payload: null,
          opportunityStatus: "OPEN",
          isRead: false,
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMarkAsRead: () => ({ mutate: vi.fn() }),
  useMarkAllAsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useClearAllMail: () => ({ mutate: vi.fn(), isPending: false }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );

describe("NotificationsPage opportunities", () => {
  afterEach(() => {
    auth.role = "HEAD_OF_DIVISION";
  });

  it.each(["HEAD_OF_DIVISION", "SALES_MANAGER"])("shows new opportunities to %s", (role) => {
    auth.role = role;
    renderPage();
    expect(screen.getByText("New Opportunities")).toBeInTheDocument();
  });

  it("keeps the opportunities queue away from an estimator", () => {
    auth.role = "ESTIMATOR";
    renderPage();
    expect(screen.queryByText("New Opportunities")).not.toBeInTheDocument();
  });
});
