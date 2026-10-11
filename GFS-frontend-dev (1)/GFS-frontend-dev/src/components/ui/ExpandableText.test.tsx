import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ExpandableText from "./ExpandableText";

const hasReadMore = (text: string): boolean => {
  const { unmount } = render(<ExpandableText text={text} title="Note" />);
  const found = screen.queryByRole("button", { name: "Read more" }) !== null;
  unmount();
  return found;
};

const transcript = Array.from({ length: 12 }, (_, i) => `00:00:${10 + i}.000 --> 00:00:${11 + i}.000\nLine ${i + 1}`).join("\n\n");

describe("ExpandableText", () => {
  it("shows short text in full without a Read more link", () => {
    render(<ExpandableText text="Client confirmed the deck size." title="Note" />);

    expect(screen.getByText("Client confirmed the deck size.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read more" })).not.toBeInTheDocument();
  });

  it("opens the full text in a popup and closes it with Escape", () => {
    render(<ExpandableText text={transcript} title="Untitled note" subtitle="by Jamunesh Sheta" />);

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    const dialog = screen.getByRole("dialog", { name: "Untitled note" });
    expect(dialog).toHaveTextContent("Line 12");
    expect(dialog).toHaveTextContent("by Jamunesh Sheta");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the full text when the shown text is a shortened copy", () => {
    render(<ExpandableText text="Latest note: How's it going..." fullText={transcript} title="Zoho note" />);

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Line 12");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats text as long past 400 characters or 6 lines", () => {
    expect(hasReadMore("a".repeat(400))).toBe(false);
    expect(hasReadMore("a".repeat(401))).toBe(true);
    expect(hasReadMore("1\n2\n3\n4\n5\n6")).toBe(false);
    expect(hasReadMore("1\n2\n3\n4\n5\n6\n7")).toBe(true);
  });
});
