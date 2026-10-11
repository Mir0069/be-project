import { describe, expect, it } from "vitest";

import {
  buildCalculationSummary,
  expandUnitPricingRows,
  getCalculationGrandTotal,
  getCalculationPricingTotals,
  normalizePricingCategories,
} from "./calculationContract";

describe("calculationContract", () => {
  it("maps the backend calculation fields into one summary", () => {
    const summary = buildCalculationSummary(
      {
        takeoff: {
          panel_count: { value: 9, reasoning: ["Approved takeoff units"] },
          packaging: { value: 2 },
          man_hours: { value: 40 },
        },
      },
      {
        calculated: {
          total_sqft: { value: "96.5" },
          total_weight: { value: 2752 },
          perimeter_lf: { value: 48 },
          silicone_tubes: { value: 9.5 },
          total_man_hours: { value: 42, confidence: "High" },
          total_packaging: { value: 3 },
        },
      },
    );

    expect(summary).toMatchObject([
      { key: "panel_count", value: 9, sourcePath: "stage_4.takeoff.panel_count" },
      { key: "total_sqft", value: "96.5", sourcePath: "stage_5.calculated.total_sqft" },
      { key: "total_weight", value: 2752, sourcePath: "stage_5.calculated.total_weight" },
      { key: "perimeter_lf", value: 48, sourcePath: "stage_5.calculated.perimeter_lf" },
      { key: "silicone_tubes", value: 9.5, sourcePath: "stage_5.calculated.silicone_tubes" },
      { key: "total_man_hours", value: 42, confidence: "High", sourcePath: "stage_5.calculated.total_man_hours" },
      { key: "total_packaging", value: 3, sourcePath: "stage_5.calculated.total_packaging" },
    ]);
  });

  it("falls back to the stage 4 man-hours field when stage 5 has no total", () => {
    const summary = buildCalculationSummary(
      { takeoff: { man_hours: { value: 40 } } },
      { calculated: { total_man_hours: { value: null } } },
    );

    expect(summary.find((item) => item.key === "total_man_hours")).toMatchObject({
      value: 40,
      sourcePath: "stage_4.takeoff.man_hours",
    });
  });

  it("uses rawQty null as missing instead of treating the schema fallback qty as real", () => {
    const categories = normalizePricingCategories(
      [
        {
          title: "Base calculation",
          fields: [
            { label: "Glass", cell: "C9", rawQty: null, qty: 0 },
            { label: "Frame", cell: "C41", rawQty: 2, qty: 2 },
          ],
        },
        {
          title: "Options / Add-ons",
          fields: [{ label: "Sentry Glass", cell: "C16", rawQty: 10 }],
        },
      ],
      { C9: 25, C41: 15, C16: 3 },
    );

    expect(categories[0].fields[0]).toMatchObject({ quantity: null, amount: null });
    expect(categories[0].fields[1]).toMatchObject({ quantity: 2, amount: 30 });
    expect(getCalculationPricingTotals(categories)).toEqual({
      all: 60,
      excludingOptional: 30,
      optional: 30,
    });
  });

  it("keeps workbook add alternates out of the base total even without a backend flag", () => {
    const categories = normalizePricingCategories(
      [
        {
          title: "Optional Add-ons",
          fields: [{ label: "Nano Dot", cell: "C110", rawQty: 100, amount: 5600 }],
        },
      ],
      { C110: 56 },
    );

    expect(categories[0].fields[0]).toMatchObject({
      amount: 5600,
      includedInTotal: false,
      sectionKind: "optional",
    });
    expect(getCalculationPricingTotals(categories)).toEqual({
      all: 0,
      excludingOptional: 0,
      optional: 5600,
    });
  });

  it("adds optional add-ons to a valid final price", () => {
    expect(getCalculationGrandTotal(1250.5, 99.499)).toBe(1350);
    expect(getCalculationGrandTotal(null, 99.499)).toBeNull();
  });

  it("counts an optional add-on only when its acceptance status is accepted", () => {
    const categories = normalizePricingCategories(
      [{
        title: "Optional Add-ons",
        fields: [{
          label: "Nano Dot",
          cell: "C110",
          rawQty: 100,
          amount: 5600,
          optionalStatus: "SELECTED_PENDING_ACCEPTANCE",
        }],
      }],
      { C110: 56 },
    );

    expect(getCalculationPricingTotals(categories).optional).toBe(0);
    categories[0]!.fields[0]!.optionalStatus = "ACCEPTED";
    expect(getCalculationPricingTotals(categories).optional).toBe(5600);
  });

  it("applies quantity overrides and recalculates row amount", () => {
    const categories = normalizePricingCategories(
      [
        {
          title: "Glass Types",
          fields: [
            { label: "Glass - with IGU", cell: "C10", isPercentage: false, quantity: 88, amount: 8800 },
          ],
        },
      ],
      { C10: 100 },
      { C10: 95 }
    );

    expect(categories[0]?.fields[0]).toMatchObject({
      quantity: 95,
      unitCost: 100,
      amount: 9500,
    });
  });

  describe("per-unit products", () => {
    const glassWithIgu = () => normalizePricingCategories(
      [{
        title: "Glass Types",
        fields: [{
          label: "Glass – with IGU",
          cell: "C10",
          quantity: 8,
          amount: 994.56,
          units: [
            { unitKey: "B", quantity: 8, amount: 994.56 },
            { unitKey: "C", quantity: null, amount: null },
          ],
        }],
      }],
      { C10: 124.32 },
      { "C10:B": 10 },
    );

    it("prices each unit line with the shared unit cost and its own quantity override", () => {
      const [field] = glassWithIgu()[0]!.fields;

      expect(field).toMatchObject({
        quantity: 10,
        amount: 1243.2,
        unitLines: [
          { unitKey: "B", quantityKey: "C10:B", quantity: 10, amount: 1243.2 },
          { unitKey: "C", quantityKey: "C10:C", quantity: null, amount: null },
        ],
      });
      expect(getCalculationPricingTotals(glassWithIgu()).all).toBe(1243.2);
    });

    it("expands a per-unit product into one row per unit and leaves other rows alone", () => {
      const [perUnit] = glassWithIgu()[0]!.fields;
      const [plain] = normalizePricingCategories(
        [{ title: "Shop Fabrication", fields: [{ label: "Packaging", cell: "C73", quantity: 1 }] }],
        { C73: 150 },
      )[0]!.fields;

      expect(expandUnitPricingRows([perUnit!, plain!])).toMatchObject([
        { rowKey: "C10:B", quantityKey: "C10:B", unitKey: "B", cell: "C10", quantity: 10, amount: 1243.2 },
        { rowKey: "C10:C", quantityKey: "C10:C", unitKey: "C", cell: "C10", quantity: null, amount: null },
        { rowKey: "C73", quantityKey: "C73", unitKey: null, cell: "C73", quantity: 1, amount: 150 },
      ]);
    });
  });
});
