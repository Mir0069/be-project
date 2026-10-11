import type { IProjectSchema } from '@db/models/proposal.model';
import {
  PRODUCT_CELLS,
  PRODUCT_COST_CELLS,
  PRODUCT_GROUPS,
  hasRealUnitData,
  resolveUnitProducts,
  type ProductGroup,
} from './unit-pricing-products';
import { UNIT_KEYS, UNIT_QUANTITY_COLUMNS, UNIT_SELECTION_COLUMNS, toFiniteNumber } from './unit-derived-values';

export type UnitPricingLine = {
  unitKey: string;
  quantity: number | null;
  quantityOverridden: boolean;
  amount: number | null;
};

export type UnitTakeoffQuantities = {
  unitKey: string;
  sqft: number;
  perimeterLf: number;
  crossbeamLf: number;
};

const CROSSBEAM_COST_CELLS = Object.values(PRODUCT_COST_CELLS.crossbeam);

const round = (value: number): number => Math.round(value * 100) / 100;

/** Stage 7 quantity override key for one unit's line, e.g. "C9:A". */
export const unitQuantityOverrideKey = (cell: string, unitKey: string): string => `${cell}:${unitKey}`;

export const isUnitQuantityOverrideKey = (key: string): boolean => {
  const [cell, unitKey, ...rest] = key.split(':');
  return rest.length === 0 && PRODUCT_CELLS.has(cell ?? '') && (UNIT_KEYS as readonly string[]).includes(unitKey ?? '');
};

/** Older AI runs only marked the crossbeam with 'y' in the unit's own column of rows 53-60. */
const stage6CrossbeamCell = (schema: IProjectSchema, unitIndex: number): string | null =>
  CROSSBEAM_COST_CELLS.find((costCell) => {
    const flag = schema.stage_6?.cells?.[`${UNIT_SELECTION_COLUMNS[unitIndex]}${costCell.slice(1)}`];
    return typeof flag === 'string' && flag.trim().toLowerCase() === 'y';
  }) ?? null;

const takeoffQuantity = (
  group: ProductGroup,
  costCell: string,
  takeoff: UnitTakeoffQuantities | undefined,
  schema: IProjectSchema,
  unitIndex: number,
): number | null => {
  if (!takeoff) return null;
  if (group === 'glass') return round(takeoff.sqft);
  if (group === 'frame') return round(takeoff.perimeterLf);
  if (takeoff.crossbeamLf > 0) return round(takeoff.crossbeamLf);
  // No rafters on the unit: keep the crossbeam LF the AI priced in this unit's worksheet column.
  return toFiniteNumber(schema.stage_6?.cells?.[`${UNIT_QUANTITY_COLUMNS[unitIndex]}${costCell.slice(1)}`]) ?? 0;
};

/** Every unit in the workbook, grouped under the cost cell of the glass, frame and crossbeam it uses. */
export function buildUnitPricingLines(
  schema: IProjectSchema,
  takeoffs: UnitTakeoffQuantities[],
  quantityOverrides: Record<string, number>,
): Map<string, UnitPricingLine[]> {
  const takeoffByUnit = new Map(takeoffs.map((takeoff) => [takeoff.unitKey, takeoff]));
  const lines = new Map<string, UnitPricingLine[]>();

  UNIT_KEYS.forEach((unitKey, unitIndex) => {
    if (!hasRealUnitData(schema.units?.[unitKey])) return;
    const products = resolveUnitProducts(schema, unitKey);

    for (const group of PRODUCT_GROUPS) {
      const product = products[group];
      const costCell = product
        ? PRODUCT_COST_CELLS[group][product]
        : group === 'crossbeam' ? stage6CrossbeamCell(schema, unitIndex) : null;
      if (!costCell) continue;

      const override = toFiniteNumber(quantityOverrides[unitQuantityOverrideKey(costCell, unitKey)]);
      const quantity = override ?? takeoffQuantity(group, costCell, takeoffByUnit.get(unitKey), schema, unitIndex);
      const line: UnitPricingLine = { unitKey, quantity, quantityOverridden: override !== null, amount: null };
      lines.set(costCell, [...(lines.get(costCell) ?? []), line]);
    }
  });

  return lines;
}
