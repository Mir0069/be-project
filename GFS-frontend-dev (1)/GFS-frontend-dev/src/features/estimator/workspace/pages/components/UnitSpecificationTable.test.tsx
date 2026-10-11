import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnitSpecificationTable } from "./UnitSpecificationTable";

describe("UnitSpecificationTable", () => {
  it("shows only units that have a value for the current specification", () => {
    render(
      <UnitSpecificationTable
        field="value_glass_type"
        units={{
          A: { unit_id: "A", value_glass_type: "GLASS_WITH_IGU" },
          B: { unit_id: "B", value_glass_type: null },
          C: { unit_id: "C", value_glass_type: "EGR" },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Glass Type by unit" })).toBeInTheDocument();
    expect(screen.getByText("Unit A")).toBeInTheDocument();
    expect(screen.getByText("Glass With Igu")).toBeInTheDocument();
    expect(screen.getByText("Unit C")).toBeInTheDocument();
    expect(screen.queryByText("Unit B")).not.toBeInTheDocument();
  });

  it("does not render when AI has not sent a per-unit value", () => {
    const { container } = render(
      <UnitSpecificationTable
        field="value_frame_type"
        units={{ A: { unit_id: "A", value_frame_type: null } }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows an editable AI decision, value, and reasoning for each glass unit", () => {
    render(
      <UnitSpecificationTable
        field="value_glass_type"
        variant="detailed"
        editable
        fieldPathPrefix="stage_2.units"
        allowedValues={["GLASS_NO_IGU", "GLASS_WITH_IGU"]}
        units={{
          A: {
            unit_id: "A",
            value_glass_type: "GLASS_NO_IGU",
            reasoning: ["Unit A is specified as non-IGU glass."],
            extracted_confidence: 92,
          },
          B: {
            unit_id: "B",
            value_glass_type: "GLASS_WITH_IGU",
            reasoning: ["Unit B requires insulated glass."],
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Unit A Glass Type" })).toHaveTextContent("Glass NO Igu");
    expect(screen.getByRole("button", { name: "Unit B Glass Type" })).toHaveTextContent("Glass With Igu");
    expect(screen.getAllByText("Y")).toHaveLength(2);
    expect(screen.getByText("Unit A is specified as non-IGU glass.")).toBeInTheDocument();
    expect(screen.getByText("Unit B requires insulated glass.")).toBeInTheDocument();
  });
});
