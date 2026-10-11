import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MailsTab, tabs } from "./ProjectDashboard";
import type { OutlookEmail } from "@/shared/types/email.types";

describe("ProjectDashboard tabs", () => {
  // The Zoho follow-up activity feature was removed: we no longer create Tasks in
  // Zoho, so there is nothing for a "Zoho Activities" tab to show. This pins the
  // tab set so the tab cannot quietly reappear in a future merge.
  it("shows exactly the five supported tabs, in order", () => {
    expect(tabs.map((t) => t.id)).toEqual([
      "Overview",
      "Zoho Notes",
      "Mails",
      "Teams",
      "Call Records",
    ]);
  });

  it("does not offer a Zoho Activities tab", () => {
    expect(tabs.some((t) => t.id === "Zoho Activities")).toBe(false);
  });

  it("keeps the Zoho Notes tab, which is unaffected by the removal", () => {
    const notes = tabs.find((t) => t.id === "Zoho Notes");
    expect(notes).toBeDefined();
    expect(notes?.label).toBe("Zoho Notes");
  });
});

describe("MailsTab", () => {
  const mail = {
    id: "e-1",
    subject: "dimension changes for 19685 somarville drive",
    fromName: "Jamunesh Sheta",
    fromAddress: "jsheta15@gmail.com",
    bodyText: "hello gfs we need 50x50 glass panels",
    webLink: "https://outlook.office.com/mail/deeplink/e-1",
    receivedDateTime: "2026-08-20T08:23:00Z",
    attachments: [],
  } as unknown as OutlookEmail;

  // Estimators work inside the workspace, so the mail card offers a move action and
  // no longer hands out an escape hatch into Outlook.
  it("offers Move to Project and no Outlook link", () => {
    render(<MailsTab emails={[mail]} />);

    expect(screen.getByRole("button", { name: /move to project/i })).toBeInTheDocument();
    expect(screen.queryByText(/open in outlook/i)).toBeNull();
  });

  it("does not label the action Change Project", () => {
    render(<MailsTab emails={[mail]} />);

    expect(screen.queryByText(/change project/i)).toBeNull();
  });

  it("opens the complete email body from the shortened preview", () => {
    const fullBody = "Line one. Line two. Line three. Line four. Please review the attached drawings.";
    render(<MailsTab emails={[{ ...mail, bodyText: fullBody }]} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /view full email/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent(fullBody);

    fireEvent.click(screen.getByRole("button", { name: /close full email/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a mail attachment from the attachment chip", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: null } as unknown as Window);
    const attachmentMail = {
      ...mail,
      attachments: [
        {
          id: "attachment-1",
          name: "drawings.pdf",
          contentType: "application/pdf",
          size: 120,
          isInline: false,
          downloaded: true,
          storageKey: "documents/project-1/drawings.pdf",
        },
      ],
    } as unknown as OutlookEmail;

    render(<MailsTab emails={[attachmentMail]} />);

    fireEvent.click(screen.getByRole("button", { name: /open drawings\.pdf/i }));

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/preview/documents%2Fproject-1%2Fdrawings.pdf"),
      "_blank",
    );
    open.mockRestore();
  });
});
