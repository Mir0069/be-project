import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ZohoNotesTab from "./ZohoNotesTab";
import type { ZohoNote } from "@/shared/types/zoho.types";

const notes: ZohoNote[] = [
  {
    id: "n-1",
    title: "Kickoff",
    content: "Discussed storefront glass scope with the client.",
    author: "Sales Manager",
    createdTime: "2026-05-12T15:39:00Z",
  },
];

describe("ZohoNotesTab", () => {
  it("renders a note with title, content and author", () => {
    render(<ZohoNotesTab notes={notes} />);
    expect(screen.getByText("Kickoff")).toBeInTheDocument();
    expect(screen.getByText("Discussed storefront glass scope with the client.")).toBeInTheDocument();
    expect(screen.getByText("by Sales Manager")).toBeInTheDocument();
  });

  it("previews a long note and opens the full text in a popup", () => {
    const transcript = `WEBVTT\n\n${Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n")}`;
    render(<ZohoNotesTab notes={[{ ...notes[0]!, title: null, content: transcript }]} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    const dialog = screen.getByRole("dialog", { name: "Untitled note" });
    expect(dialog).toHaveTextContent("Line 20");
    expect(dialog).toHaveTextContent("by Sales Manager");
  });

  it("shows the empty state when there are no notes", () => {
    render(<ZohoNotesTab notes={[]} />);
    expect(screen.getByText("No notes on this lead.")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    render(<ZohoNotesTab isLoading />);
    expect(screen.getByText(/Loading notes/)).toBeInTheDocument();
  });
});
