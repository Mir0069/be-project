export type FinalParameterFieldSchema = {
  label: string;
  cell: string;
  qtyKey?: string;
  isVisible?: (summary: any) => boolean;
};

export type FinalParameterCategorySchema = {
  title: string;
  fields: FinalParameterFieldSchema[];
};

const isTriggerSelected = (s: any, triggerCell: string): boolean => {
  const val = s?.stage_6?.cells?.[triggerCell];
  return typeof val === 'string' && val.trim().toLowerCase() === 'y';
};

const hasAnyCrossbeamTrigger = (s: any): boolean => {
  return ['D53', 'D54', 'D55', 'D56', 'D57', 'D58', 'D59', 'D60'].some((cell) =>
    isTriggerSelected(s, cell),
  );
};

const isSeries2000 = (s: any): boolean => {
  const frame = String(s?.stage_3?.frame_type ?? '');
  return frame.includes('2000');
};

// resolveQuantityValue remains the same
export function resolveQuantityValue(summary: any, keyPath?: string): number | string | undefined {
  if (!keyPath) return undefined;
  const parts = keyPath.split('.');
  let current: any = summary;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export const FINAL_PARAMETERS_SCHEMA: FinalParameterCategorySchema[] = [
  {
    title: "Glass Types",
    fields: [
      { label: "Glass – no IGU", cell: "C9", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_2?.glass_type === "GLASS_NO_IGU" || String(s?.stage_2?.glass_type).includes("no IGU") },
      { label: "Glass – with IGU", cell: "C10", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_2?.glass_type === "GLASS_WITH_IGU" || String(s?.stage_2?.glass_type).includes("with IGU") },
      { label: "Glass 2.0 system", cell: "C11", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_2?.glass_type === "GLASS_2_0" || String(s?.stage_2?.glass_type).includes("2.0") },
      { label: "Stair treads", cell: "C12", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_2?.glass_type === "STAIR_TREAD" || String(s?.stage_2?.glass_type).includes("Stair") },
      { label: "Non-Walkable glass", cell: "C13", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_2?.glass_type === "NON_WALKABLE" || String(s?.stage_2?.glass_type).includes("Walkable") },
      { label: "EGR", cell: "C14", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_2?.glass_type === "EGR" || String(s?.stage_2?.glass_type).includes("EGR") },
    ]
  },
  {
    title: "Options / Add-ons",
    fields: [
      { label: "Sentry Glass interlayer", cell: "C16", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.sentry_glass === "y" || s?.stage_5?.addons?.sentry_glass === "Y" },
      { label: "Krypton Gas", cell: "C17", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.krypton_gas === "y" || s?.stage_5?.addons?.krypton_gas === "Y" },
      { label: "Backpaint", cell: "C20", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.backpaint === "y" || s?.stage_5?.addons?.backpaint === "Y" },
      { label: "Custom", cell: "C21", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.custom_shape === "y" || s?.stage_5?.addons?.custom_shape === "Y" },
    ]
  },
  {
    title: "Framing",
    fields: [
      { label: "Series 1000 Pedestal TB", cell: "C38", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_1000_PEDESTAL" || String(s?.stage_3?.frame_type).includes("1000 Pedestal") },
      { label: "Series 1000 Recessed TB", cell: "C39", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_1000_RECESSED" || String(s?.stage_3?.frame_type).includes("1000 Recessed") },
      { label: "Perimeter non-TB", cell: "C40", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "PERIMETER_NON_TB" || String(s?.stage_3?.frame_type).includes("non-thermally") },
      { label: "Series 2000 Pedestal", cell: "C41", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_2000_PEDESTAL" || String(s?.stage_3?.frame_type).includes("2000 Pedestal") },
      { label: "Series 2000 Recessed", cell: "C42", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_2000_RECESSED" || String(s?.stage_3?.frame_type).includes("2000 Recessed") },
      { label: "Series 3000", cell: "C45", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_3000" || String(s?.stage_3?.frame_type).includes("3000") },
      { label: "Deck perimeter", cell: "C46", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "DECK_PERIMETER" || String(s?.stage_3?.frame_type).includes("Deck") },
      { label: "Econoframe lengths", cell: "C47", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "ECONOFRAME" || String(s?.stage_3?.frame_type) === "Econoframe" },
      { label: "Series 2000 with plate", cell: "C43", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_2000_WITH_PLATE" || String(s?.stage_3?.frame_type).includes("with plate") },
      { label: "Series 2000 non-walkable", cell: "C44", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "SERIES_2000_NON_WALKABLE" || String(s?.stage_3?.frame_type).includes("non-walkable") },
      { label: "Round Frame 42\"", cell: "C48", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "ROUND_FRAME_42" || String(s?.stage_3?.frame_type).includes("Round Frame") },
      { label: "2\" Horizontal cap - Series 1000", cell: "C49", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "HORIZONTAL_CAP_SERIES_1000" || String(s?.stage_3?.frame_type).includes("Horizontal cap") },
      { label: "3' Vertical cap - Series 1000", cell: "C50", qtyKey: "stage_5.calculated.perimeter_lf", isVisible: (s) => s?.stage_3?.frame_type === "VERTICAL_CAP_SERIES_1000" || String(s?.stage_3?.frame_type).includes("Vertical cap") },
    ]
  },
  {
    title: "Cross Beam",
    fields: [
      {
        label: "Series 1000 T-Section TB",
        cell: "C53",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D53")
          : (s?.stage_4?.crossbeam === "SERIES_1000_T_SECTION_TB" || (s?.stage_4?.crossbeam === "T_SECTION_TB" && !isSeries2000(s))),
      },
      {
        label: "Series 1000 I-Beam TB",
        cell: "C54",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D54")
          : (s?.stage_4?.crossbeam === "SERIES_1000_I_BEAM_TB" || (s?.stage_4?.crossbeam === "I_BEAM_TB" && !isSeries2000(s))),
      },
      {
        label: "Series 1000 T-Section",
        cell: "C55",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D55")
          : ["T_SECTION_NTB", "SERIES_1000_T_SECTION"].includes(s?.stage_4?.crossbeam),
      },
      {
        label: "Series 1000 I-Beam",
        cell: "C56",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D56")
          : s?.stage_4?.crossbeam === "SERIES_1000_I_BEAM",
      },
      {
        label: "Series 2000 T-Section TB",
        cell: "C57",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D57")
          : (s?.stage_4?.crossbeam === "SERIES_2000_T_SECTION_TB" || (s?.stage_4?.crossbeam === "T_SECTION_TB" && isSeries2000(s))),
      },
      {
        label: "Series 2000 I-Beam TB",
        cell: "C58",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D58")
          : (["I_BEAM_TB_2000", "SERIES_2000_I_BEAM_TB"].includes(s?.stage_4?.crossbeam) || (s?.stage_4?.crossbeam === "I_BEAM_TB" && isSeries2000(s))),
      },
      {
        label: "Econoframe 2.5\"",
        cell: "C59",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D59")
          : s?.stage_4?.crossbeam === "ECONOFRAME_2_5",
      },
      {
        label: "Econoframe 3.5\"",
        cell: "C60",
        qtyKey: "stage_4.takeoff.total_crossbeam_length_in",
        isVisible: (s) => hasAnyCrossbeamTrigger(s)
          ? isTriggerSelected(s, "D60")
          : s?.stage_4?.crossbeam === "ECONOFRAME_3_5",
      },
    ]
  },
  {
    title: "Gasket LF & Hardware",
    fields: [
      { label: "Waste (%)", cell: "C61" },
      { label: "Brackets - Includes $10 for paint", cell: "C62" },
      { label: "Fasteners", cell: "C63" },
      { label: "Silicone", cell: "C64" },
      { label: "Perimeter", cell: "C66" },
      { label: "Rafters", cell: "C67" },
      { label: "Custom gasket", cell: "C68" },
      { label: "3m tape", cell: "C69" },
    ]
  },
  {
    title: "Shop Fabrication",
    fields: [
      { label: "Man Hours", cell: "C71", qtyKey: "stage_5.calculated.total_man_hours" },
      { label: "Paint by LF", cell: "C72", qtyKey: "stage_5.calculated.perimeter_lf" },
      { label: "Packaging", cell: "C73", qtyKey: "stage_5.calculated.total_packaging" },
    ]
  },
  {
    title: "Additional Charges",
    fields: [
      { label: "Engineering", cell: "C75" },
      { label: "Stamped Drawings", cell: "C76" },
      { label: "Calculations glass only No IGU", cell: "C77" },
      { label: "Calculations glass only with IGU", cell: "C78" },
      { label: "Calculations frame & glass no IGU", cell: "C79" },
      { label: "Calculations frame & glass with IGU", cell: "C80" },
      { label: "Custom Upcharge (%)", cell: "C81" },
      { label: "Shop Drawings", cell: "C82" },
    ]
  },
  {
    title: "Shipping & Overhead",
    fields: [
      { label: "Shipping", cell: "C85" },
      { label: "Overhead (%)", cell: "C86" },
      { label: "Profit (%)", cell: "C87" },
      { label: "Insurance (%)", cell: "C88" },
      { label: "Sales Rep Commission (%)", cell: "C89" },
      { label: "Duty (%)", cell: "C90" },
      { label: "Transgroup Fees", cell: "C91" },
    ]
  },
  {
    title: "Markup & Discount",
    fields: [
      { label: "Mark up (%)", cell: "C93" },
      { label: "Discount Amount (%)", cell: "C94" },
    ]
  },
  {
    // These rows mirror the workbook's separate "Add Alternates" block.
    // They are displayed after Final Calculated Price and never contribute to
    // the base proposal total.
    title: "Optional Add-ons",
    fields: [
      { label: "Seeded Organic", cell: "C107", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.seeded_organic === "y" || s?.stage_5?.addons?.seeded_organic === "Y" },
      { label: "Heat Soak Testing", cell: "C109", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.heat_soak_testing === "y" || s?.stage_5?.addons?.heat_soak_testing === "Y" },
      { label: "Nano Dot", cell: "C110", qtyKey: "stage_5.calculated.total_sqft", isVisible: (s) => s?.stage_5?.addons?.nanodot === "y" || s?.stage_5?.addons?.nanodot === "Y" },
    ]
  }
];
