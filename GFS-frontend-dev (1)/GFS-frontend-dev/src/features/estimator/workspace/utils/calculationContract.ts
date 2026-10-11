export type BackendCalculationField = {
  value?: unknown;
  reasoning?: unknown;
  confidence?: number | string | null;
  extracted_confidence?: number | string | null;
  status?: string | null;
  [key: string]: unknown;
};

export type CalculationSummaryItem = {
  key: string;
  label: string;
  value: unknown;
  unit: string;
  sourcePath: string;
  reasoning?: unknown;
  confidence?: number | string | null;
};

export type PricingSectionKind = "base" | "optional" | "adjustment";
export type OptionalAddOnStatus =
  | "NOT_SELECTED"
  | "SELECTED_PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "DECLINED";

export type BackendUnitPricingLine = {
  unitKey: string;
  quantity?: unknown;
  amount?: unknown;
  quantityOverridden?: boolean;
};

export type BackendPricingField = {
  label: string;
  cell: string;
  rawQty?: unknown;
  qty?: unknown;
  quantity?: unknown;
  amount?: unknown;
  selection?: "Y" | "N" | null;
  isPercentage?: boolean;
  includedInTotal?: boolean;
  pricingType?: string;
  calculationSource?: string;
  optionalStatus?: OptionalAddOnStatus;
  /** Glass, frame and crossbeam rows: one line per unit using this product. */
  units?: BackendUnitPricingLine[];
};

export type CalculationUnitLine = {
  unitKey: string;
  quantityKey: string;
  quantity: number | null;
  amount: number | null;
};

export type BackendPricingCategory = {
  title: string;
  fields: BackendPricingField[];
};

export type CalculationPricingItem = BackendPricingField & {
  categoryTitle: string;
  sectionKind: PricingSectionKind;
  unitCost: number | null;
  quantity: number | null;
  amount: number | null;
  selection: "Y" | "N" | null;
  optionalStatus?: OptionalAddOnStatus;
  unitLines?: CalculationUnitLine[];
};

/** One table row: a whole product, or one unit's line of a per-unit product. */
export type CalculationPricingRow = CalculationPricingItem & {
  rowKey: string;
  quantityKey: string;
  unitKey: string | null;
};

export type CalculationPricingCategory = {
  title: string;
  sectionKind: PricingSectionKind;
  fields: CalculationPricingItem[];
};

export type CalculationPricingTotals = {
  all: number;
  excludingOptional: number;
  optional: number;
};

const OPTIONAL_ADD_ON_CELLS = new Set(["C107", "C109", "C110"]);

const CALCULATION_SUMMARY_DEFINITIONS = [
  {
    key: "panel_count",
    label: "Panel Count",
    unit: "panels",
    candidates: [{ source: "stage_4", path: "takeoff.panel_count" }],
  },
  {
    key: "total_sqft",
    label: "Total Sqft",
    unit: "sq ft",
    candidates: [{ source: "stage_5", path: "calculated.total_sqft" }],
  },
  {
    key: "total_weight",
    label: "Total Weight",
    unit: "lbs",
    candidates: [{ source: "stage_5", path: "calculated.total_weight" }],
  },
  {
    key: "perimeter_lf",
    label: "Perimeter",
    unit: "LF",
    candidates: [{ source: "stage_5", path: "calculated.perimeter_lf" }],
  },
  {
    key: "silicone_tubes",
    label: "Silicone Tubes",
    unit: "tubes",
    candidates: [{ source: "stage_5", path: "calculated.silicone_tubes" }],
  },
  {
    key: "total_man_hours",
    label: "Man Hours",
    unit: "hours",
    candidates: [
      { source: "stage_5", path: "calculated.total_man_hours" },
      { source: "stage_4", path: "takeoff.man_hours" },
    ],
  },
  {
    key: "total_packaging",
    label: "Packaging",
    unit: "units",
    candidates: [
      { source: "stage_5", path: "calculated.total_packaging" },
    ],
  },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readPath = (source: Record<string, unknown> | undefined, path: string): unknown => {
  if (!source) return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, source);
};

const unwrapField = (value: unknown): BackendCalculationField | undefined => {
  if (!isRecord(value)) return value == null ? undefined : { value };
  return "value" in value || "reasoning" in value || "status" in value ? value as BackendCalculationField : { value };
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

/** Stage 7 quantity override key for one unit's line, e.g. "C9:A". */
export const unitQuantityOverrideKey = (cell: string, unitKey: string): string => `${cell}:${unitKey}`;

const normalizeUnitLines = (
  field: BackendPricingField,
  unitCost: number | null,
  quantityOverrides: Record<string, number>,
): CalculationUnitLine[] => (field.units ?? []).map((line) => {
  const quantityKey = unitQuantityOverrideKey(field.cell, line.unitKey);
  const quantity = toNumber(quantityOverrides[quantityKey]) ?? toNumber(line.quantity);
  const amount = unitCost !== null && quantity !== null
    ? roundCurrency(unitCost * quantity)
    : toNumber(line.amount);
  return { unitKey: line.unitKey, quantityKey, quantity, amount };
});

export const formatCalculationValue = (value: unknown): string => {
  const numeric = toNumber(value);
  if (numeric !== null) {
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.00$/, "");
  }

  if (value == null || value === "") return "Not provided";
  return String(value);
};

export const buildCalculationSummary = (
  stage4Fields?: Record<string, unknown>,
  stage5Fields?: Record<string, unknown>,
): CalculationSummaryItem[] => CALCULATION_SUMMARY_DEFINITIONS.map((definition) => {
  let source = definition.candidates[0].source;
  let sourcePath = definition.candidates[0].path;
  let field: BackendCalculationField | undefined;

  for (const candidateDefinition of definition.candidates) {
    const sourceFields = candidateDefinition.source === "stage_4" ? stage4Fields : stage5Fields;
    const fieldCandidate = unwrapField(readPath(sourceFields, candidateDefinition.path));
    if (fieldCandidate && fieldCandidate.value != null && fieldCandidate.value !== "") {
      source = candidateDefinition.source;
      sourcePath = candidateDefinition.path;
      field = fieldCandidate;
      break;
    }
    if (!field && fieldCandidate) {
      source = candidateDefinition.source;
      sourcePath = candidateDefinition.path;
      field = fieldCandidate;
    }
  }

  return {
    key: definition.key,
    label: definition.label,
    unit: definition.unit,
    value: field?.value,
    sourcePath: `${source}.${sourcePath}`,
    reasoning: field?.reasoning,
    confidence: field?.confidence ?? field?.extracted_confidence,
  };
});

export const classifyPricingSection = (title: string): PricingSectionKind => {
  const normalized = title.toLowerCase();
  if (normalized.includes("add-on") || normalized.includes("option")) return "optional";
  if (
    normalized.includes("additional") ||
    normalized.includes("shipping") ||
    normalized.includes("overhead") ||
    normalized.includes("markup") ||
    normalized.includes("discount")
  ) {
    return "adjustment";
  }
  return "base";
};

export const normalizePricingCategories = (
  categoriesOrPayload:
    | BackendPricingCategory[]
    | { categories?: BackendPricingCategory[] }
    | undefined,
  costOverrides: Record<string, number>,
  quantityOverrides: Record<string, number> = {},
): CalculationPricingCategory[] => {
  const categoriesList: BackendPricingCategory[] = Array.isArray(categoriesOrPayload)
    ? categoriesOrPayload
    : categoriesOrPayload?.categories ?? [];

  return categoriesList.map((category) => {
    const sectionKind = classifyPricingSection(category.title);

    return {
      title: category.title,
      sectionKind,
      fields: (category.fields ?? []).map((field) => {
        const unitCost = toNumber(costOverrides[field.cell]);

        if (field.units?.length) {
          const unitLines = normalizeUnitLines(field, unitCost, quantityOverrides);
          return {
            ...field,
            categoryTitle: category.title,
            sectionKind,
            unitCost,
            quantity: roundCurrency(unitLines.reduce((sum, line) => sum + (line.quantity ?? 0), 0)),
            amount: roundCurrency(unitLines.reduce((sum, line) => sum + (line.amount ?? 0), 0)),
            selection: field.selection === "Y" || field.selection === "N" ? field.selection : null,
            unitLines,
          };
        }

        const baseQuantity = toNumber(
          "quantity" in field
            ? field.quantity
            : "rawQty" in field
              ? field.rawQty
              : field.qty,
        );
        const overrideQuantity = toNumber(quantityOverrides[field.cell]);
        const quantity = overrideQuantity !== null ? overrideQuantity : baseQuantity;
        const backendAmount = toNumber(field.amount);

        // Immediate recalculation for standard quantity rows on edit:
        const canComputeDirectly = !field.isPercentage && unitCost !== null && quantity !== null;
        const amount = canComputeDirectly
          ? Math.round(unitCost * quantity * 100) / 100
          : "amount" in field
            ? backendAmount
            : null;

        return {
          ...field,
          categoryTitle: category.title,
          sectionKind,
          unitCost,
          quantity,
          amount,
          selection: field.selection === "Y" || field.selection === "N" ? field.selection : null,
          // Add Alternates are displayed after the base final price and must
          // remain excluded even when an older backend response omits the flag.
          includedInTotal: OPTIONAL_ADD_ON_CELLS.has(field.cell) ? false : field.includedInTotal,
        };
      }),
    };
  });
};

/** Splits per-unit products into one row per unit ("Unit A · Glass – no IGU"); others stay one row. */
export const expandUnitPricingRows = (fields: CalculationPricingItem[]): CalculationPricingRow[] =>
  fields.flatMap((field): CalculationPricingRow[] => field.unitLines?.length
    ? field.unitLines.map((line) => ({
      ...field,
      rowKey: line.quantityKey,
      quantityKey: line.quantityKey,
      unitKey: line.unitKey,
      quantity: line.quantity,
      amount: line.amount,
    }))
    : [{ ...field, rowKey: field.cell, quantityKey: field.cell, unitKey: null }]);

export const getCalculationPricingTotals = (
  categories: CalculationPricingCategory[],
): CalculationPricingTotals => categories.reduce<CalculationPricingTotals>((totals, category) => {
  const categoryTotal = category.fields.reduce(
    (sum, field) => sum + (field.includedInTotal === false ? 0 : field.amount ?? 0),
    0,
  );
  const optionalTotal = category.fields.reduce(
    (sum, field) => sum + (
      !OPTIONAL_ADD_ON_CELLS.has(field.cell)
        ? field.amount ?? 0
        : field.optionalStatus === "ACCEPTED" || field.optionalStatus === undefined
        ? field.amount ?? 0
        : 0
    ),
    0,
  );
  return {
    all: totals.all + categoryTotal,
    excludingOptional: totals.excludingOptional + (category.sectionKind === "optional" ? 0 : categoryTotal),
    optional: totals.optional + (category.sectionKind === "optional" ? optionalTotal : 0),
  };
}, { all: 0, excludingOptional: 0, optional: 0 });

export const getCalculationGrandTotal = (
  finalPrice: number | null,
  optionalAddOnTotal: number,
): number | null => finalPrice === null
  ? null
  : Math.round((finalPrice + optionalAddOnTotal) * 100) / 100;

export const calculationSectionBadge: Record<PricingSectionKind, { label: string; className: string }> = {
  base: { label: "Base calculation", className: "bg-blue-50 text-blue-700 border-blue-200" },
  optional: { label: "Optional add-ons", className: "bg-amber-50 text-amber-700 border-amber-200" },
  adjustment: { label: "Pricing adjustments", className: "bg-violet-50 text-violet-700 border-violet-200" },
};
