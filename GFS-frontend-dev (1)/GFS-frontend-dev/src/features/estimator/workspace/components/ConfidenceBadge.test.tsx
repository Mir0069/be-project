import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfidenceBadge } from "./ConfidenceBadge";

describe("ConfidenceBadge", () => {
  it("renders a normalized percentage for numeric confidence values", () => {
    render(<ConfidenceBadge confidence={0.92} />);

    expect(screen.getByLabelText("AI confidence: 92%")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("supports qualitative confidence values from the extraction API", () => {
    render(<ConfidenceBadge confidence="HIGH_CONFIDENCE" />);

    expect(screen.getByLabelText("AI confidence: High")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("renders nothing when confidence is not available", () => {
    const { container } = render(<ConfidenceBadge />);

    expect(container).toBeEmptyDOMElement();
  });
});
