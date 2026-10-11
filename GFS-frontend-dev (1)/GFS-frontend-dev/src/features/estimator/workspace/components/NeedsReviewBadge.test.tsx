import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NeedsReviewBadge from "./NeedsReviewBadge";

describe("NeedsReviewBadge", () => {
  it("clearly labels a value that needs human review", () => {
    render(<NeedsReviewBadge />);

    expect(screen.getByRole("status", { name: "Needs review" })).toHaveTextContent("Needs review");
  });
});
