import { describe, it, expect } from "vitest";

import {
  buildParameterFeedbackRequests,
  toFeedbackRequests,
  unitKeyOfPath,
  valuesDiffer,
} from "./fieldFeedback";

const scalarRows = [
  { label: "Man Hours", path: "stage_4.takeoff.man_hours", field: { value: 68 } },
  { label: "Packaging", path: "stage_4.takeoff.packaging", field: { value: 150 } },
];

const unitRows = [
  {
    key: "A",
    unit: "A",
    widthRaw: 40,
    lengthRaw: 90,
    panelsRaw: 2,
    frameTypeRaw: "SERIES_2000_RECESSED",
    glassTypeRaw: "GLASS_NO_IGU",
    widthPath: "stage_4.takeoff.units.A.value_width_in",
    lengthPath: "stage_4.takeoff.units.A.value_length_in",
    panelsPath: "stage_4.takeoff.units.A.value_panel_count",
    frameTypePath: "stage_4.takeoff.units.A.value_frame_type",
    glassTypePath: "stage_4.takeoff.units.A.value_glass_type",
  },
  {
    key: "B",
    unit: "B",
    widthRaw: 20,
    widthPath: "stage_4.takeoff.units.B.value_width_in",
  },
];

describe("valuesDiffer", () => {
  it("treats a numeric value and its string form as unchanged", () => {
    expect(valuesDiffer(48, "48")).toBe(false);
  });

  it("reports a real change", () => {
    expect(valuesDiffer(48, "96")).toBe(true);
  });

  it("reports a change when the previous value was null", () => {
    expect(valuesDiffer(null, "96")).toBe(true);
  });
});

describe("unitKeyOfPath", () => {
  it("extracts the unit key from a takeoff column path", () => {
    expect(unitKeyOfPath("stage_4.takeoff.units.A.value_width_in")).toBe("units.A");
    expect(unitKeyOfPath("stage_4.units.J.value_length_in")).toBe("units.J");
  });

  it("returns null for a plain field path", () => {
    expect(unitKeyOfPath("stage_1.project_name")).toBeNull();
  });
});

describe("toFeedbackRequests", () => {
  it("keeps a field whose AI value was overwritten", () => {
    const requests = toFeedbackRequests([
      { key: "a", label: "A", previousValue: "old", newValue: "new" },
    ]);

    expect(requests).toHaveLength(1);
  });

  it("drops a field that was blank before the edit", () => {
    expect(
      toFeedbackRequests([
        { key: "a", label: "A", previousValue: null, newValue: "new" },
        { key: "b", label: "B", previousValue: "", newValue: "new" },
        { key: "c", label: "C", previousValue: undefined, newValue: "new" },
      ])
    ).toEqual([]);
  });

  it("drops a field whose value did not actually change", () => {
    expect(
      toFeedbackRequests([{ key: "a", label: "A", previousValue: 68, newValue: "68" }])
    ).toEqual([]);
  });
});

describe("buildParameterFeedbackRequests", () => {
  it("asks once per plain field", () => {
    const requests = buildParameterFeedbackRequests(
      { "stage_4.takeoff.man_hours": 80 },
      scalarRows,
      unitRows
    );

    expect(requests).toEqual([
      { key: "stage_4.takeoff.man_hours", label: "Man Hours", previousValue: 68, newValue: 80 },
    ]);
  });

  it("collapses three changed columns of one takeoff row into a single request", () => {
    const requests = buildParameterFeedbackRequests(
      {
        "stage_4.takeoff.units.A.value_width_in": 48,
        "stage_4.takeoff.units.A.value_length_in": 96,
        "stage_4.takeoff.units.A.value_panel_count": 3,
      },
      scalarRows,
      unitRows
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      key: "units.A",
      label: "Takeoff unit A",
      changedColumns: ["Width", "Length", "Panels"],
    });
  });

  it("keeps separate requests for two different takeoff rows", () => {
    const requests = buildParameterFeedbackRequests(
      {
        "stage_4.takeoff.units.A.value_width_in": 48,
        "stage_4.takeoff.units.B.value_width_in": 24,
      },
      scalarRows,
      unitRows
    );

    expect(requests.map((r) => r.key)).toEqual(["units.A", "units.B"]);
  });

  it("tracks unit-specific frame and glass corrections", () => {
    const requests = buildParameterFeedbackRequests(
      {
        "stage_4.takeoff.units.A.value_frame_type": "SERIES_3000",
        "stage_4.takeoff.units.A.value_glass_type": "GLASS_WITH_IGU",
      },
      scalarRows,
      unitRows,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      key: "units.A",
      changedColumns: ["Frame type", "Glass type"],
    });
  });

  it("ignores takeoff columns that were empty before the edit", () => {
    const requests = buildParameterFeedbackRequests(
      { "stage_4.takeoff.units.B.value_length_in": 96 },
      scalarRows,
      unitRows
    );

    expect(requests).toEqual([]);
  });

  it("mixes plain fields and takeoff rows in one pass", () => {
    const requests = buildParameterFeedbackRequests(
      {
        "stage_4.takeoff.man_hours": 80,
        "stage_4.takeoff.units.A.value_width_in": 48,
      },
      scalarRows,
      unitRows
    );

    expect(requests.map((r) => r.key)).toEqual(["stage_4.takeoff.man_hours", "units.A"]);
  });
});
