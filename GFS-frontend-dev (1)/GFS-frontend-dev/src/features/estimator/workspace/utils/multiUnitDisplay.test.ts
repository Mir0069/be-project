import { describe, expect, it } from "vitest";

import { getApprovedUnitRows, summarizeMixedUnitOption } from "./multiUnitDisplay";

describe("summarizeMixedUnitOption", () => {
  it("lists each unit's option when units differ", () => {
    const units = getApprovedUnitRows({
      A: { value_glass_type: "GLASS_NO_IGU" },
      B: { value_glass_type: "GLASS_WITH_IGU" },
      C: { value_glass_type: "GLASS_WITH_IGU" },
    });

    expect(summarizeMixedUnitOption(units, "value_glass_type")).toBe(
      "A: Glass NO Igu · B: Glass With Igu · C: Glass With Igu",
    );
  });

  it("returns null when every unit uses the same option or none is set", () => {
    const same = getApprovedUnitRows({
      A: { value_frame_type: "SERIES_2000_PEDESTAL" },
      B: { value_frame_type: "SERIES_2000_PEDESTAL", value_width_in: 24 },
    });
    const unset = getApprovedUnitRows({ A: { value_width_in: 96 } });

    expect(summarizeMixedUnitOption(same, "value_frame_type")).toBeNull();
    expect(summarizeMixedUnitOption(unset, "value_frame_type")).toBeNull();
  });
});
