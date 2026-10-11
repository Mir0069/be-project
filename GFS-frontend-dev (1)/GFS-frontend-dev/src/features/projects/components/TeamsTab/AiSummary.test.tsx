import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AiSummary } from "./AiSummary";
import type { TeamsAiSummary } from "@/shared/types/teams.types";

const summary: TeamsAiSummary = {
  summary: "Discussed walkable glass staircase scope.",
  keyPoints: ["Load rating required", "Client to share diagrams"],
  requirements: ["Walkable glass treads"],
  confidence: 0.82,
  updatedAt: "2026-07-08T10:00:00Z",
};

describe("AiSummary", () => {
  it("renders the summary text, key points, and requirements under a label", () => {
    render(<AiSummary summary={summary} label="Meeting Summary" />);
    expect(screen.getByText("Meeting Summary")).toBeInTheDocument();
    expect(screen.getByText("Discussed walkable glass staircase scope.")).toBeInTheDocument();
    expect(screen.getByText("Load rating required")).toBeInTheDocument();
    expect(screen.getByText("Client to share diagrams")).toBeInTheDocument();
    expect(screen.getByText("Requirements")).toBeInTheDocument();
    expect(screen.getByText("Walkable glass treads")).toBeInTheDocument();
  });

  it("renders nothing when there is no content", () => {
    const { container } = render(
      <AiSummary summary={{ summary: "", keyPoints: [], requirements: [], confidence: null, updatedAt: "" }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
