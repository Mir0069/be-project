import { describe, expect, it } from "vitest";
import {
  FINAL_PARAMETER_REASONING_MAX_POINTS,
  formatFinalParameterReasoning,
} from "./finalParameterReasoning";

describe("formatFinalParameterReasoning", () => {
  it("cleans technical markers and keeps the Final Parameters output to three points", () => {
    const points = formatFinalParameterReasoning({
      reason: [
        "[canonical] calculated.total_sqft: calculated from approved dimensions.",
        "Based on width × length for each approved unit.",
        "The same calculation is repeated for approved dimensions.",
        "Additional calculation detail from the worksheet.",
      ],
      fallback: "Calculated from dimensions.",
      label: "Total Sqft",
    });

    expect(points).toHaveLength(FINAL_PARAMETER_REASONING_MAX_POINTS);
    expect(points[0]).toBe("Calculated from approved dimensions.");
    expect(points.some((point) => point.includes("[canonical]"))).toBe(false);
  });

  it("renders only the PDF filename as a non-interactive source point", () => {
    const points = formatFinalParameterReasoning({
      reason: "Calculated from the approved drawing. Source: C:\\plans\\floor plan.pdf (p. 2).",
      fallback: "Calculated from dimensions.",
      label: "Total Sqft",
    });

    expect(points).toContain("Source: floor plan.pdf");
    expect(points.join(" ")).not.toContain("C:\\plans");
    expect(points.join(" ")).not.toContain("(p. 2)");
  });

  it("uses the fallback when dynamic reasoning is missing", () => {
    expect(formatFinalParameterReasoning({
      reason: null,
      fallback: "Calculated from approved unit dimensions.",
      label: "Total Sqft",
    })).toEqual(["Calculated from approved unit dimensions."]);
  });
});
