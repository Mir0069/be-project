import type { IProjectSchema, IUnitField, OptionalAddOnStatus } from '@db/models/proposal.model';
import { FINAL_PARAMETERS_SCHEMA, type FinalParameterFieldSchema } from './schema/final-parameters.schema';
import { UNIT_KEYS, resolveUnitManHours, resolveUnitPackaging} from './unit-derived-values';
import { PRODUCT_CELLS } from './unit-pricing-products';
import { buildUnitPricingLines, type UnitPricingLine } from './unit-pricing-lines';

export type FinalParameterPricingType = 'unit' | 'percentage' | 'manual' | 'conditional';
export type FinalParameterSelection = 'Y' | 'N';

export const OPTIONAL_ADD_ON_CELLS = ['C107', 'C109', 'C110'] as const;
export type OptionalAddOnCell = (typeof OPTIONAL_ADD_ON_CELLS)[number];

export type ResolvedFinalParameterField = {
  label: string;
  cell: string;
  qty: number | null;
  rawQty: number | null;
  quantity: number | null;
  isPercentage: boolean;
  amount: number | null;
  selection: FinalParameterSelection | null;
  pricingType: FinalParameterPricingType;
  includedInTotal: boolean;
  calculationSource: string;
  optionalStatus?: OptionalAddOnStatus;
  /** Glass, frame and crossbeam rows: one priced line per unit that uses this product. */
  units?: UnitPricingLine[];
};

export type ResolvedFinalParameterCategory = {
  title: string;
  fields: ResolvedFinalParameterField[];
};

export type FinalParameterCalculation = {
  categories: ResolvedFinalParameterCategory[];
  subtotal: number;
  total: number;
  finalPrice: number;
  alternateTotal: number;
  optionalAddOnTotal: number;
  grandTotal: number;
  quantityOverrides?: Record<string, number>;
  optionalAddOnStatuses: Record<OptionalAddOnCell, OptionalAddOnStatus>;
  metrics: {
    totalSqft: number;
    perimeterLf: number;
    totalCrossbeamLengthIn: number;
    rafterLf: number;
    verticalRafterCount: number;
    horizontalRafterCount: number;
    bracketCount: number;
    fastenerCount: number;
    paintLf: number;
    alternateSqft: number;
    totalManHours: number;
    totalPackaging: number;
  };
};

type UnitMetrics = {
  unitKey: string;
  widthIn: number;
  lengthIn: number;
  panelCount: number;
  numUnits: number;
  verticalRafters: number;
  horizontalRafters: number;
  manHours: number;
  packaging: number;
  sqft: number;
  perimeterLf: number;
  crossbeamLengthIn: number;
  bracketCount: number;
  fastenerCount: number;
};

const finiteNumber = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const round = (value: number): number => Math.round(value * 100) / 100;

const fieldValue = (field: unknown): unknown => {
  if (field && typeof field === 'object' && 'value' in field) {
    return (field as { value?: unknown }).value;
  }
  return field;
};

const yes = (value: unknown): boolean => {
  const normalized = String(fieldValue(value) ?? '').trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes' || normalized === 'true' || normalized === '1';
};

const readNumber = (value: unknown, fallback = 0): number => finiteNumber(fieldValue(value)) ?? fallback;

const readOptionalNumber = (value: unknown): number | null => finiteNumber(fieldValue(value));

const ADDITIONAL_CHARGE_CELLS = [
  'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82',
  'C69', 'C85', 'C89', 'C91', 'C93', 'C94',
] as const;

// The workbook adds these fixed additional charges after overhead, profit,
// insurance, and other percentage-based calculations. Keep them out of the
// percentage base, then add their selected amounts to the final price.
const FIXED_ADDITIONAL_CHARGE_CELLS = new Set([
  'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C82',
]);

/**
 * Display vs metrics gate: a unit carrying only a spec selection
 * (frame/glass/thickness) or location/drawing is real for Excel display but
 * must not mint hardware — with zero rafter inputs the bracket/fastener
 * formulas yield 4 brackets + 16 fasteners out of thin air. Metrics require
 * at least one dimensional input.
 */
const unitHasMetrics = (unit: IUnitField): boolean =>
  unit.value_width_in != null ||
  unit.value_length_in != null ||
  unit.value_panel_count != null ||
  unit.value_rafter_count != null ||
  unit.value_vertical_rafter_count != null ||
  unit.value_horizontal_rafter_count != null;

const getUnitMetrics = (schema: IProjectSchema): UnitMetrics[] => Object.entries(schema.units ?? {})
  .filter(([_, unit]) => unit && unitHasMetrics(unit))
  .map(([unitKey, unit], index) => {
    // Each unit owns its take-off row (A=115 ... J=124), even when an earlier unit has no dimensions.
    const letterIndex = (UNIT_KEYS as readonly string[]).indexOf(unitKey.toUpperCase());
    const unitTakeoffRow = 115 + (letterIndex >= 0 ? letterIndex : index);
    const widthIn = readNumber(unit.value_width_in);
    const lengthIn = readNumber(unit.value_length_in);
    const panelCount = readNumber(unit.value_panel_count);
    const numUnits = Math.max(1, readNumber(unit.value_num_units, 1));
    const manHours = resolveUnitManHours(schema, unitKey) ?? 0;
    const packaging = resolveUnitPackaging(schema, unitKey) ?? 0;
    const stage6VertRafters = readOptionalNumber(
      schema.stage_6?.cells?.[unit.excel_vert_rafter_cell ?? `K${unitTakeoffRow}`],
    );
    const stage6HorizRafters = readOptionalNumber(
      schema.stage_6?.cells?.[unit.excel_horiz_rafter_cell ?? `L${unitTakeoffRow}`],
    );
    // New takeoffs store vertical rafters explicitly. Older projects only
    // have value_rafter_count, and seeded rows may contain an explicit zero
    // for value_vertical_rafter_count, so prefer the legacy count whenever it
    // is the only positive rafter input available.
    const rawVert = readOptionalNumber(unit.value_vertical_rafter_count);
    const explicitVerticalRafters = (rawVert != null && rawVert > 0)
      ? rawVert
      : (stage6VertRafters ?? (rawVert ?? 0));
    const legacyRafters = readOptionalNumber(unit.value_rafter_count) ?? 0;
    let verticalRafters = readNumber(
      explicitVerticalRafters > 0 || legacyRafters <= 0
        ? explicitVerticalRafters
        : legacyRafters,
    );
    let horizontalRafters = readNumber(
      readOptionalNumber(unit.value_horizontal_rafter_count) ?? stage6HorizRafters ?? 0,
    );

    // If estimator has not entered rafters and stage_6 did not specify,
    // infer 1 crossbeam per panel division (e.g. 2 panels = 1 crossbeam).
    if (verticalRafters === 0 && horizontalRafters === 0 && panelCount > 1) {
      verticalRafters = panelCount - 1;
    }

    const horizontalBranch = horizontalRafters > 0
      ? verticalRafters * 4 + horizontalRafters * 4 + verticalRafters * horizontalRafters * 4 + 4
      : verticalRafters * 4 + 4;
    const fastenerBranch = horizontalRafters > 0
      ? verticalRafters * 12 + horizontalRafters * 12 + verticalRafters * horizontalRafters * 8 + 16
      : verticalRafters * 12 + 16;

    return {
      unitKey,
      widthIn,
      lengthIn,
      panelCount,
      numUnits,
      verticalRafters,
      horizontalRafters,
      manHours,
      packaging,
      // These formulas intentionally mirror Pricing Worksheet H/I/N rows.
      sqft: (widthIn * lengthIn) / 144,
      perimeterLf: (2 * (widthIn + lengthIn)) / 12,
      crossbeamLengthIn: verticalRafters * widthIn + horizontalRafters * lengthIn,
      bracketCount: horizontalBranch,
      fastenerCount: fastenerBranch,
    };
  });

const toTakeoffQuantities = (unit: UnitMetrics) => ({
  unitKey: unit.unitKey,
  sqft: unit.sqft,
  perimeterLf: unit.perimeterLf,
  crossbeamLf: unit.crossbeamLengthIn / 12,
});

const sumLineQuantities = (lines: UnitPricingLine[]): number =>
  round(lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0));

const getAddon = (schema: IProjectSchema, name: string): unknown =>
  (schema.stage_5?.addons as unknown as Record<string, unknown> | undefined)?.[name];

const getManualQuantity = (schema: IProjectSchema, cell: string): number | null => {
  const dynamicSources: unknown[] = [
    (schema as any).stage_7?.line_item_quantities,
    (schema as any).stage_7?.quantities,
    (schema as any).stage_7?.quantity_overrides,
    (schema as any).stage_5?.line_item_quantities,
    (schema as any).stage_5?.additional_charges,
    (schema as any).stage_4?.takeoff,
  ];

  const aliases: Record<string, string[]> = {
    C64: ['silicone', 'silicone_tubes', 'E64'],
    C68: ['custom_gasket', 'E68'],
    C69: ['three_m_tape', 'tape', 'E69'],
    C71: ['man_hours', 'total_man_hours', 'E71'],
    C73: ['packaging', 'total_packaging', 'E73'],
    C75: ['engineering', 'E75'],
    C76: ['stamped_drawings', 'E76'],
    C77: ['calculations_glass_only_no_igu', 'E77'],
    C78: ['calculations_glass_only_with_igu', 'E78'],
    C79: ['calculations_frame_glass_no_igu', 'E79'],
    C80: ['calculations_frame_glass_with_igu', 'E80'],
    C81: ['custom_upcharge', 'E81'],
    C82: ['shop_drawings', 'E82'],
    C85: ['shipping', 'E85'],
    C91: ['transgroup_fees', 'E91'],
  };

  for (const source of dynamicSources) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    const direct = readOptionalNumber(record[cell]);
    if (direct !== null) return direct;
    for (const alias of aliases[cell] ?? []) {
      const value = readOptionalNumber(record[alias]);
      if (value !== null) return value;
    }
  }

  // Check stage_7.cost_overrides ONLY for E-row quantity aliases (e.g. E68, E75),
  // never for C-row unit cost overrides (e.g. C71, C73).
  const costOverrides = (schema as any).stage_7?.cost_overrides as Record<string, unknown> | undefined;
  if (costOverrides && typeof costOverrides === 'object') {
    for (const alias of aliases[cell] ?? []) {
      if (alias.startsWith('E')) {
        const value = readOptionalNumber(costOverrides[alias]);
        if (value !== null) return value;
      }
    }
  }

  if (cell === 'C64') {
    const existing = readOptionalNumber(schema.stage_5?.calculated?.silicone_tubes);
    if (existing !== null) return existing;
  }
  if (cell === 'C71') {
    const existing = readOptionalNumber(schema.stage_5?.calculated?.total_man_hours);
    if (existing !== null) return existing;
  }
  if (cell === 'C73') {
    const existing = readOptionalNumber(schema.stage_5?.calculated?.total_packaging);
    if (existing !== null) return existing;
  }

  return null;
};

const getAdditionalChargeSelection = (schema: IProjectSchema, cell: string): FinalParameterSelection => {
  const stored = schema.stage_7?.additional_charge_selections?.[cell];
  if (stored === 'Y' || stored === 'N') return stored;

  const rowMatch = /^C(\d+)$/.exec(cell);
  if (rowMatch && rowMatch[1]) {
    const row = rowMatch[1];
    const selections = schema.stage_7?.additional_charge_selections as Record<string, unknown> | undefined;
    const rowStored = selections?.[`D${row}`] ?? selections?.[row];
    if (rowStored === 'Y' || rowStored === 'N') return rowStored;
  }

  // Preserve the legacy sales-rep setting when reading an older project;
  // projects without an explicit setting safely default to N.
  if (cell === 'C89') return yes(getAddon(schema, 'sales_rep_commission')) ? 'Y' : 'N';
  if (cell === 'C69') return yes(getAddon(schema, 'three_m_tape')) ? 'Y' : 'N';
  if (cell === 'C93') return yes(getAddon(schema, 'markup')) ? 'Y' : 'N';
  if (cell === 'C94') return yes(getAddon(schema, 'discount')) ? 'Y' : 'N';

  // Preserve any legacy manual charge quantity when reading older projects;
  // new projects default safely to N.
  return (getManualQuantity(schema, cell) ?? 0) > 0 ? 'Y' : 'N';
};

const isEnabledForCell = (schema: IProjectSchema, cell: string): boolean => {
  if (ADDITIONAL_CHARGE_CELLS.includes(cell as (typeof ADDITIONAL_CHARGE_CELLS)[number])) {
    return getAdditionalChargeSelection(schema, cell) === 'Y';
  }

  const addonMap: Record<string, string> = {
    C89: 'sales_rep_commission',
    C90: 'duty',
    C91: 'transgroup_fees',
    C93: 'markup',
    C94: 'discount',
    C69: 'three_m_tape',
    C81: 'custom_upcharge',
  };
  const addon = addonMap[cell];
  return addon ? yes(getAddon(schema, addon)) : false;
};

const isPercentageCell = (cell: string): boolean =>
  ['C61', 'C81', 'C86', 'C87', 'C88', 'C89', 'C90', 'C93', 'C94'].includes(cell);

const isAlternateCell = (cell: string): boolean => ['C107', 'C109', 'C110'].includes(cell);

const OPTIONAL_ADD_ON_SOURCES: Record<OptionalAddOnCell, string> = {
  C107: 'seeded_organic',
  C109: 'heat_soak_testing',
  C110: 'nanodot',
};

const OPTIONAL_ADD_ON_STATUSES: OptionalAddOnStatus[] = [
  'NOT_SELECTED',
  'SELECTED_PENDING_ACCEPTANCE',
  'ACCEPTED',
  'DECLINED',
];

export const getOptionalAddOnStatuses = (schema: IProjectSchema): Record<OptionalAddOnCell, OptionalAddOnStatus> => {
  const stored = schema.stage_7?.optional_add_on_statuses ?? {};
  return Object.fromEntries(
    OPTIONAL_ADD_ON_CELLS.map((cell) => {
      const storedStatus = stored[cell];
      if (storedStatus && OPTIONAL_ADD_ON_STATUSES.includes(storedStatus)) {
        return [cell, storedStatus];
      }
      const addonKey = OPTIONAL_ADD_ON_SOURCES[cell] as keyof IProjectSchema['stage_5']['addons'];
      const addon = schema.stage_5?.addons?.[addonKey];
      return [cell, yes(addon) ? 'SELECTED_PENDING_ACCEPTANCE' : 'NOT_SELECTED'];
    }),
  ) as Record<OptionalAddOnCell, OptionalAddOnStatus>;
};

const getSummary = (schema: IProjectSchema, metrics: ReturnType<typeof calculateMetrics>): Record<string, unknown> => ({
  stage_2: { glass_type: fieldValue(schema.stage_2?.glass_type) },
  stage_3: { frame_type: fieldValue(schema.stage_3?.decision?.frame_type) },
  stage_4: {
    crossbeam: fieldValue(schema.stage_4?.crossbeam),
    panel_count: fieldValue(schema.stage_4?.takeoff?.panel_count),
    takeoff: {
      perimeter_lf: metrics.perimeterLf,
      total_crossbeam_length_in: metrics.totalCrossbeamLengthIn,
    },
  },
  stage_5: {
    addons: Object.fromEntries(
      Object.entries(schema.stage_5?.addons ?? {}).map(([key, value]) => [key, fieldValue(value)]),
    ),
    calculated: {
      total_sqft: metrics.totalSqft,
      perimeter_lf: metrics.perimeterLf,
      silicone_tubes: fieldValue(schema.stage_5?.calculated?.silicone_tubes),
      total_man_hours: fieldValue(schema.stage_5?.calculated?.total_man_hours),
      total_packaging: fieldValue(schema.stage_5?.calculated?.total_packaging),
    },
  },
  stage_6: {
    cells: schema.stage_6?.cells ?? {},
  },
});

type CalculatedMetrics = {
  units: UnitMetrics[];
  totalSqft: number;
  perimeterLf: number;
  totalCrossbeamLengthIn: number;
  rafterLf: number;
  verticalRafterCount: number;
  horizontalRafterCount: number;
  bracketCount: number;
  fastenerCount: number;
  paintLf: number;
  alternateSqft: number;
  totalManHours: number;
  totalPackaging:number;
};

function calculateMetrics(schema: IProjectSchema): CalculatedMetrics {
  const units = getUnitMetrics(schema);
  const storedSqft = readOptionalNumber(schema.stage_5?.calculated?.total_sqft);
  const storedPerimeter = readOptionalNumber(schema.stage_5?.calculated?.perimeter_lf);
  const storedManHours = readOptionalNumber(schema.stage_5?.calculated?.total_man_hours);
  const storedPackaging = readOptionalNumber(schema.stage_5?.calculated?.total_packaging);
  const derivedSqft = units.reduce((sum, unit) => sum + unit.sqft, 0);
  const derivedPerimeter = units.reduce((sum, unit) => sum + unit.perimeterLf, 0);
  const derivedManHours = units.reduce((sum, unit) => sum + unit.manHours, 0);
  const derivedPackaging = units.reduce((sum, unit) => sum + unit.packaging, 0);
  const totalSqft = units.length > 0 ? derivedSqft : storedSqft ?? 0;
  const perimeterLf = units.length > 0 ? derivedPerimeter : storedPerimeter ?? 0;
  const totalManHours = units.length > 0 && derivedManHours > 0 ? derivedManHours : storedManHours ?? derivedManHours;
  const totalPackaging = units.length > 0 && derivedPackaging > 0 ? derivedPackaging : storedPackaging ?? derivedPackaging;
  const totalCrossbeamLengthIn = units.reduce((sum, unit) => sum + unit.crossbeamLengthIn, 0);
  const rafterLf = totalCrossbeamLengthIn / 12;
  const verticalRafterCount = units.reduce((sum, unit) => sum + unit.verticalRafters, 0);
  const horizontalRafterCount = units.reduce((sum, unit) => sum + unit.horizontalRafters, 0);
  const bracketCount = units.reduce((sum, unit) => sum + unit.bracketCount, 0);
  const fastenerCount = units.reduce((sum, unit) => sum + unit.fastenerCount, 0);
  const alternateSqft = units.reduce((sum, unit) => sum + unit.sqft * unit.numUnits, 0);

  return {
    units,
    totalSqft: round(totalSqft),
    perimeterLf: round(perimeterLf),
    totalCrossbeamLengthIn: round(totalCrossbeamLengthIn),
    rafterLf: round(rafterLf),
    verticalRafterCount: round(verticalRafterCount),
    horizontalRafterCount: round(horizontalRafterCount),
    bracketCount: round(bracketCount),
    fastenerCount: round(fastenerCount),
    paintLf: round(perimeterLf + rafterLf),
    alternateSqft: round(alternateSqft),
    totalManHours: round(totalManHours),
    totalPackaging: round(totalPackaging),
  };
}

const valueForCell = (
  cell: string,
  schema: IProjectSchema,
  metrics: CalculatedMetrics,
): { quantity: number | null; amount: number | null; pricingType: FinalParameterPricingType; source: string; enabled: boolean; selection?: FinalParameterSelection | null; optionalStatus?: OptionalAddOnStatus } => {
  const glassCells = ['C9', 'C10', 'C11', 'C12', 'C13', 'C14'];
  const addonCells = ['C16', 'C17', 'C18', 'C19', 'C21'];
  const frameCells = ['C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47', 'C48', 'C49', 'C50'];
  const crossbeamCells = ['C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'C59', 'C60'];

  if (glassCells.includes(cell)) return { quantity: metrics.totalSqft, amount: null, pricingType: 'unit', source: 'Pricing Worksheet H115:H125', enabled: true };
  if (addonCells.includes(cell)) return { quantity: metrics.totalSqft, amount: null, pricingType: 'unit', source: 'Pricing Worksheet H115:H125', enabled: true };
  if (cell === 'C20') return { quantity: metrics.paintLf, amount: null, pricingType: 'unit', source: 'Pricing Worksheet E66+E67', enabled: true };
  if (frameCells.includes(cell)) return { quantity: metrics.perimeterLf, amount: null, pricingType: 'unit', source: 'Pricing Worksheet I115:I125', enabled: true };
  if (crossbeamCells.includes(cell)) {
    const row = cell.slice(1);
    const stage6Qty = readOptionalNumber(schema.stage_6?.cells?.[`E${row}`]);
    const quantity = (metrics.rafterLf > 0 ? metrics.rafterLf : stage6Qty) ?? 0;
    return { quantity, amount: null, pricingType: 'unit', source: 'Pricing Worksheet N115:N125 ÷ 12', enabled: true };
  }
  if (cell === 'C61') return { quantity: null, amount: null, pricingType: 'percentage', source: 'Pricing Worksheet SUM(F38:F60) × C61', enabled: true };
  if (cell === 'C62') return { quantity: metrics.bracketCount, amount: null, pricingType: 'unit', source: 'Pricing Worksheet bracket formula from K/L takeoff counts', enabled: true };
  if (cell === 'C63') return { quantity: metrics.fastenerCount, amount: null, pricingType: 'unit', source: 'Pricing Worksheet fastener formula from K/L takeoff counts', enabled: true };
  if (cell === 'C64') return { quantity: getManualQuantity(schema, cell), amount: null, pricingType: 'manual', source: 'Approved Silicone quantity / stage_5.calculated.silicone_tubes', enabled: true };
  if (cell === 'C66') return { quantity: metrics.perimeterLf, amount: null, pricingType: 'unit', source: 'Pricing Worksheet I115:I125', enabled: true };
  if (cell === 'C67') {
    const stage6Qty = readOptionalNumber(schema.stage_6?.cells?.['E67']);
    const quantity = (metrics.rafterLf > 0 ? metrics.rafterLf : stage6Qty) ?? 0;
    return { quantity, amount: null, pricingType: 'unit', source: 'Pricing Worksheet N115:N125 ÷ 12', enabled: true };
  }
  if (cell === 'C68') return { quantity: getManualQuantity(schema, cell), amount: null, pricingType: 'manual', source: 'Manual custom gasket quantity', enabled: true };
  if (cell === 'C69') {
    const selection = getAdditionalChargeSelection(schema, cell);
    return {
      quantity: selection === 'Y' ? metrics.paintLf : 0,
      amount: null,
      pricingType: 'conditional',
      source: '3m tape selection (Y/N) × (perimeter + rafters LF)',
      enabled: true,
      selection,
    };
  }
  if (cell === 'C71') {
    const manualQty = getManualQuantity(schema, cell);
    const quantity = (manualQty !== null && manualQty > 0)
      ? manualQty
      : (metrics.totalManHours > 0 ? metrics.totalManHours : (manualQty ?? 0));
    return { quantity, amount: null, pricingType: 'manual', source: 'Approved Man Hours quantity', enabled: true };
  }
  if (cell === 'C72') return { quantity: metrics.paintLf, amount: null, pricingType: 'unit', source: 'Pricing Worksheet SUM(E66:E67)', enabled: true };
  if (cell === 'C73') {
    // Units' own packaging wins, like the Excel row 73; the project-level value is only a fallback.
    const unitPackaging = round(metrics.units.reduce((sum, unit) => sum + unit.packaging, 0));
    if (unitPackaging > 0) {
      return { quantity: unitPackaging, amount: null, pricingType: 'manual', source: 'Approved Unit Breakdown packaging', enabled: true };
    }
    const manualQty = getManualQuantity(schema, cell);
    const quantity = (manualQty !== null && manualQty > 0)
      ? manualQty
      : (metrics.totalPackaging > 0 ? metrics.totalPackaging : (manualQty ?? 0));
    return { quantity, amount: null, pricingType: 'manual', source: 'Approved Packaging quantity', enabled: true };
  }
  if (['C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C82'].includes(cell)) {
    const selection = getAdditionalChargeSelection(schema, cell);
    return {
      quantity: selection === 'Y' ? 1 : 0,
      amount: null,
      pricingType: 'conditional',
      source: 'Additional charge selection (Y/N)',
      enabled: true,
      selection,
    };
  }
  if (cell === 'C85') {
    const selection = getAdditionalChargeSelection(schema, cell);
    return {
      quantity: selection === 'Y' ? 1 : 0,
      amount: null,
      pricingType: 'conditional',
      source: 'Shipping selection (Y/N) × fixed cost',
      enabled: true,
      selection,
    };
  }
  if (cell === 'C81') {
    const enabled = isEnabledForCell(schema, cell);
    return {
      quantity: null,
      amount: null,
      pricingType: 'percentage',
      source: 'Additional charge selection (Y/N) × base total',
      enabled,
      selection: getAdditionalChargeSelection(schema, cell),
    };
  }
  if (cell === 'C86' || cell === 'C87' || cell === 'C88' || cell === 'C89' || cell === 'C90' || cell === 'C93' || cell === 'C94') {
    const enabled = cell === 'C86' || cell === 'C87' || cell === 'C88' || isEnabledForCell(schema, cell);
    return {
      quantity: null,
      amount: null,
      pricingType: 'percentage',
      source: cell === 'C89' ? 'Sales Rep Commission selection (Y/N) × calculated base' : `Pricing Worksheet ${cell} percentage formula`,
      enabled,
      selection: ADDITIONAL_CHARGE_CELLS.includes(cell as (typeof ADDITIONAL_CHARGE_CELLS)[number])
        ? getAdditionalChargeSelection(schema, cell)
        : null,
    };
  }
  if (cell === 'C91') {
    const selection = getAdditionalChargeSelection(schema, cell);
    const enabled = selection === 'Y';
    return {
      quantity: enabled ? 1 : 0,
      amount: null,
      pricingType: 'conditional',
      source: 'Transgroup Fees selection (Y/N) ÷ # of units',
      enabled: true,
      selection,
    };
  }
  if (isAlternateCell(cell)) {
    const optionalStatus = getOptionalAddOnStatuses(schema)[cell as OptionalAddOnCell];
    return {
      quantity: metrics.alternateSqft,
      amount: null,
      pricingType: 'conditional',
      source: 'Pricing Worksheet H115 × J115',
      enabled: true,
      selection: optionalStatus === 'ACCEPTED' ? 'Y' : 'N',
      optionalStatus,
    };
  }

  const fallbackQuantity = getManualQuantity(schema, cell);
  return { quantity: fallbackQuantity, amount: null, pricingType: 'manual', source: 'Manual quantity input', enabled: fallbackQuantity !== null, selection: null };
};

export function calculateFinalParameters(
  schema: IProjectSchema,
  costOverrides: Record<string, number> = {},
  quantityOverrides: Record<string, number> = schema.stage_7?.quantity_overrides ?? {},
): FinalParameterCalculation {
  const metrics = calculateMetrics(schema);
  const summary = getSummary(schema, metrics);
  const quantities = new Map<string, { quantity: number | null; pricingType: FinalParameterPricingType; source: string; enabled: boolean; selection?: FinalParameterSelection | null; optionalStatus?: OptionalAddOnStatus }>();
  const amountByCell = new Map<string, number>();
  const optionalAddOnStatuses = getOptionalAddOnStatuses(schema);

  // With take-off dimensions, glass/frame/crossbeam are priced per unit like the workbook's unit columns.
  const unitLines = metrics.units.length > 0
    ? buildUnitPricingLines(schema, metrics.units.map(toTakeoffQuantities), quantityOverrides)
    : null;
  // An older product-level quantity override keeps pricing that product as a single line.
  const hasUnitLines = (cell: string): boolean => {
    const rowMatch = /^C(\d+)$/.exec(cell);
    const row = rowMatch?.[1];
    const hasOverride =
      finiteNumber(quantityOverrides[cell]) !== null ||
      (row ? finiteNumber(quantityOverrides[`E${row}`]) !== null : false);
    return Boolean(unitLines?.has(cell)) && !hasOverride;
  };
  const isFieldVisible = (field: FinalParameterFieldSchema): boolean => {
    if (unitLines && PRODUCT_CELLS.has(field.cell)) return unitLines.has(field.cell);
    return !field.isVisible || field.isVisible(summary);
  };

  for (const category of FINAL_PARAMETERS_SCHEMA) {
    for (const field of category.fields) {
      if (!isFieldVisible(field)) continue;
      let resolved = valueForCell(field.cell, schema, metrics);
      if (hasUnitLines(field.cell)) {
        resolved = { ...resolved, quantity: sumLineQuantities(unitLines!.get(field.cell)!) };
      }
      const isPercentage = isPercentageCell(field.cell) || field.label.includes('(%)');
      const rowMatch = /^C(\d+)$/.exec(field.cell);
      const row = rowMatch?.[1];
      const overrideQty =
        quantityOverrides[field.cell] ??
        (row ? quantityOverrides[`E${row}`] : undefined);
      if (
        !isPercentage &&
        overrideQty !== undefined &&
        overrideQty !== null &&
        Number.isFinite(overrideQty)
      ) {
        resolved = {
          ...resolved,
          quantity: Number(overrideQty),
        };
      }
      quantities.set(field.cell, resolved);
    }
  }

  const cost = (cell: string): number => {
    const direct = finiteNumber(costOverrides[cell]);
    if (direct !== null) return direct;
    const rowMatch = /^C(\d+)$/.exec(cell);
    const row = rowMatch?.[1];
    if (row) {
      const fVal = finiteNumber(costOverrides[`F${row}`]);
      if (fVal !== null) return fVal;
    }
    return 0;
  };
  const pricedUnitLines = (cell: string): UnitPricingLine[] =>
    (unitLines?.get(cell) ?? []).map((line) => ({
      ...line,
      amount: line.quantity === null ? null : round(line.quantity * cost(cell)),
    }));
  const simpleAmount = (cell: string): number | null => {
    const resolved = quantities.get(cell);
    if (!resolved || resolved.quantity === null || !resolved.enabled) return null;
    // Each unit is rounded on its own, the same as the worksheet's per-unit price columns.
    if (hasUnitLines(cell)) return round(pricedUnitLines(cell).reduce((sum, line) => sum + (line.amount ?? 0), 0));
    return round(resolved.quantity * cost(cell));
  };

  const framingAmount = ['C38', 'C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45', 'C46', 'C47', 'C48', 'C49', 'C50']
    .reduce((sum, cell) => sum + (simpleAmount(cell) ?? 0), 0);
  const crossbeamAmount = ['C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'C59', 'C60']
    .reduce((sum, cell) => sum + (simpleAmount(cell) ?? 0), 0);
  const baseWithoutWaste = framingAmount + crossbeamAmount;
  const baseGlassAmount = ['C9', 'C10', 'C11', 'C12', 'C13', 'C14']
    .reduce((sum, cell) => sum + (simpleAmount(cell) ?? 0), 0);

  const amountForCell = (cell: string): number | null => {
    if (cell === 'C61') return round(baseWithoutWaste * cost(cell));
    if (cell === 'C86') return round((subtotalBeforeAdjustments() + (simpleAmount('C85') ?? 0)) * cost(cell));
    if (cell === 'C87') return round((subtotalBeforeAdjustments() + (simpleAmount('C85') ?? 0) + (amountByCell.get('C86') ?? 0)) * cost(cell));
    if (cell === 'C88') return round((subtotalBeforeAdjustments() + (simpleAmount('C85') ?? 0) + (amountByCell.get('C86') ?? 0) + (amountByCell.get('C87') ?? 0)) * cost(cell));
    if (cell === 'C89') {
      if (!isEnabledForCell(schema, cell)) return null;
      return round((subtotalBeforeAdjustments() + (simpleAmount('C85') ?? 0) + (amountByCell.get('C86') ?? 0) + (amountByCell.get('C87') ?? 0) + (amountByCell.get('C88') ?? 0)) * cost(cell));
    }
    if (cell === 'C90') return isEnabledForCell(schema, cell) ? round(baseGlassAmount * cost(cell)) : null;
    if (cell === 'C91') {
      const quantity = quantities.get(cell)?.quantity;
      if (quantity === null || quantity === undefined || getAdditionalChargeSelection(schema, cell) !== 'Y') return null;
      const divisor = Math.max(1, metrics.units.reduce((sum, unit) => sum + unit.numUnits, 0));
      return round(cost(cell) / divisor);
    }
    if (cell === 'C93') return isEnabledForCell(schema, cell) ? round(totalBeforeMarkup() * cost(cell)) : null;
    if (cell === 'C94') return isEnabledForCell(schema, cell) ? round(-totalBeforeMarkup() * cost(cell)) : null;
    if (cell === 'C81') return isEnabledForCell(schema, cell) ? round(totalBeforeMarkup() * cost(cell)) : null;
    return simpleAmount(cell);
  };

  const subtotalBeforeAdjustments = (): number => {
    let subtotal = 0;
    for (const category of FINAL_PARAMETERS_SCHEMA) {
      for (const field of category.fields) {
        if (!isFieldVisible(field)) continue;
        if (field.cell === 'C85' || field.cell === 'C86' || field.cell === 'C87' || field.cell === 'C88' || field.cell === 'C89' || field.cell === 'C90' || field.cell === 'C91' || field.cell === 'C93' || field.cell === 'C94' || field.cell === 'C81') continue;
        if (FIXED_ADDITIONAL_CHARGE_CELLS.has(field.cell)) continue;
        if (isAlternateCell(field.cell)) continue;
        subtotal += amountByCell.get(field.cell) ?? simpleAmount(field.cell) ?? 0;
      }
    }
    return round(subtotal);
  };

  const totalBeforeMarkup = (): number => round(
    subtotalBeforeAdjustments() +
    (simpleAmount('C85') ?? 0) +
    (amountByCell.get('C86') ?? 0) +
    (amountByCell.get('C87') ?? 0) +
    (amountByCell.get('C88') ?? 0) +
    (amountByCell.get('C89') ?? 0) +
    (amountByCell.get('C90') ?? 0) +
    (amountByCell.get('C91') ?? 0),
  );

  for (const category of FINAL_PARAMETERS_SCHEMA) {
    for (const field of category.fields) {
      if (!isFieldVisible(field)) continue;
      const amount = amountForCell(field.cell);
      if (amount !== null) amountByCell.set(field.cell, amount);
    }
  }

  // Re-run dependent percentage rows after the base amounts have been populated.
  for (const cell of ['C61', 'C86', 'C87', 'C88', 'C89', 'C90', 'C91', 'C93', 'C94', 'C81']) {
    const amount = amountForCell(cell);
    if (amount !== null) amountByCell.set(cell, amount);
  }

  const categories = FINAL_PARAMETERS_SCHEMA.map((category) => ({
    title: category.title,
    fields: category.fields
      .filter(isFieldVisible)
      .map((field) => {
        const resolved = quantities.get(field.cell) ?? valueForCell(field.cell, schema, metrics);
        const amount = amountByCell.has(field.cell) ? amountByCell.get(field.cell)! : null;
        const quantity = resolved.quantity;
        const isPercentage = isPercentageCell(field.cell) || field.label.includes('(%)');
        return {
          label: field.label,
          cell: field.cell,
          qty: isPercentage ? null : quantity,
          rawQty: isPercentage ? null : quantity,
          quantity: isPercentage ? null : quantity,
          isPercentage,
          amount,
          selection: resolved.selection ?? null,
          pricingType: resolved.pricingType,
          includedInTotal: !isAlternateCell(field.cell),
          calculationSource: resolved.source,
          optionalStatus: resolved.optionalStatus,
          ...(hasUnitLines(field.cell) ? { units: pricedUnitLines(field.cell) } : {}),
        };
      }),
  })).filter((category) => category.fields.length > 0);

  const subtotal = subtotalBeforeAdjustments();
  const total = totalBeforeMarkup();
  const finalPrice = round(
    total +
    (amountByCell.get('C93') ?? 0) +
    (amountByCell.get('C94') ?? 0) +
    // Fixed additional charges are added after percentage calculations, as in Excel.
    [...FIXED_ADDITIONAL_CHARGE_CELLS].reduce((sum, cell) => sum + (amountByCell.get(cell) ?? 0), 0) +
    // Custom Upcharge (C81) is percentage-based and intentionally excluded
    // from the subtotal until this final adjustment is applied.
    (amountByCell.get('C81') ?? 0),
  );
  const alternateTotal = ['C107', 'C109', 'C110'].reduce((sum, cell) => sum + (simpleAmount(cell) ?? 0), 0);
  const optionalAddOnTotal = round(
    OPTIONAL_ADD_ON_CELLS.reduce(
      (sum, cell) => sum + (optionalAddOnStatuses[cell] === 'ACCEPTED' ? simpleAmount(cell) ?? 0 : 0),
      0,
    ),
  );
  const grandTotal = round(finalPrice + optionalAddOnTotal);

  return {
    categories,
    subtotal,
    total,
    finalPrice,
    alternateTotal,
    optionalAddOnTotal,
    grandTotal,
    quantityOverrides,
    optionalAddOnStatuses,
    metrics: {
      totalSqft: metrics.totalSqft,
      perimeterLf: metrics.perimeterLf,
      totalCrossbeamLengthIn: metrics.totalCrossbeamLengthIn,
      rafterLf: metrics.rafterLf,
      verticalRafterCount: metrics.verticalRafterCount,
      horizontalRafterCount: metrics.horizontalRafterCount,
      bracketCount: metrics.bracketCount,
      fastenerCount: metrics.fastenerCount,
      paintLf: metrics.paintLf,
      alternateSqft: metrics.alternateSqft,
      totalManHours: metrics.totalManHours,
      totalPackaging: metrics.totalPackaging,
    },
  };
}
