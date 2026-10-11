import type { IProjectSchema } from '@db/models/proposal.model';

/**
 * Per-unit man hours, packaging and proposal descriptions reach the backend
 * through two different AI channels:
 *
 *   - Stage 5 writes them onto the unit itself (units.X.value_man_hours,
 *     units.X.value_packaging, units.X.value_description) — the canonical home.
 *   - Stage 6 re-emits the same values as workbook cells: Pricing Worksheet
 *     row 71 (man hours) and row 73 (packaging) in each unit's quantity column
 *     (E = Unit A, H = Unit B, ...) and Proposal sheet column J on the unit
 *     grid (J23 = Unit A, J24 = Unit B, ...).
 *
 * The unit value always wins; the Stage 6 cell is the fallback for projects
 * whose Stage 5 per-unit values never persisted (they used to be dropped by the
 * Stage 4 scoping guard). Every reader — Excel/PDF generation, the Final
 * Parameters calculator and the approved-stages summary — resolves through
 * here so they cannot disagree about a unit's hours, packaging or wording.
 */

export const UNIT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

/** Pricing Worksheet quantity column per unit (row 71 = Shop Fabrication Man Hours). */
export const UNIT_QUANTITY_COLUMNS = ['E', 'H', 'K', 'N', 'Q', 'T', 'W', 'Z', 'AC', 'AF'] as const;
/** Pricing Worksheet 'y' selection column per unit. */
export const UNIT_SELECTION_COLUMNS = ['D', 'G', 'J', 'M', 'P', 'S', 'V', 'Y', 'AB', 'AE'] as const;
export const MAN_HOURS_ROW = 71;
export const PACKAGING_ROW = 73; // NEW

/** Proposal sheet unit grid: row 23 = Unit A ... row 32 = Unit J; J is the merged J:K description. */
export const PROPOSAL_UNIT_FIRST_ROW = 23;
export const PROPOSAL_DESCRIPTION_COLUMN = 'J';

const unitIndex = (unitKey: string): number => UNIT_KEYS.indexOf(unitKey.toUpperCase() as (typeof UNIT_KEYS)[number]);

export const unitManHoursCell = (unitKey: string): string | null => {
  const index = unitIndex(unitKey);
  return index < 0 ? null : `${UNIT_QUANTITY_COLUMNS[index]}${MAN_HOURS_ROW}`;
};

// NEW
export const unitPackagingCell = (unitKey: string): string | null => {
  const index = unitIndex(unitKey);
  return index < 0 ? null : `${UNIT_QUANTITY_COLUMNS[index]}${PACKAGING_ROW}`;
};

export const unitDescriptionCell = (unitKey: string): string | null => {
  const index = unitIndex(unitKey);
  return index < 0 ? null : `${PROPOSAL_DESCRIPTION_COLUMN}${PROPOSAL_UNIT_FIRST_ROW + index}`;
};

/** Inverse of unitDescriptionCell: "J24" -> "B"; anything outside J23:J32 -> null. */
export const unitKeyForDescriptionCell = (address: string): string | null => {
  const match = /^J(\d+)$/.exec(address);
  if (!match) return null;
  const index = Number(match[1]) - PROPOSAL_UNIT_FIRST_ROW;
  return index >= 0 && index < UNIT_KEYS.length ? UNIT_KEYS[index]! : null;
};

/** Inverse of unitManHoursCell: "H71" -> "B"; anything else -> null. */
export const unitKeyForManHoursCell = (address: string): string | null => {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match || Number(match[2]) !== MAN_HOURS_ROW) return null;
  const index = (UNIT_QUANTITY_COLUMNS as readonly string[]).indexOf(match[1]!);
  return index < 0 ? null : UNIT_KEYS[index]!;
};

/** Inverse of unitPackagingCell: "H73" -> "B"; anything else -> null. */
// NEW
export const unitKeyForPackagingCell = (address: string): string | null => {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match || Number(match[2]) !== PACKAGING_ROW) return null;
  const index = (UNIT_QUANTITY_COLUMNS as readonly string[]).indexOf(match[1]!);
  return index < 0 ? null : UNIT_KEYS[index]!;
};

export const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * The template ships a literal "Description" in every unit row's J:K merge;
 * harvested/generated cells can carry it back. It is boilerplate, never data.
 */
export const isRealDescription = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'description';

/** Unit's own hours first, then the Stage 6 row-71 cell the AI computed for it. */
export function resolveUnitManHours(schema: IProjectSchema, unitKey: string): number | null {
  const own = toFiniteNumber(schema.units?.[unitKey]?.value_man_hours);
  if (own !== null) return own;
  const cell = unitManHoursCell(unitKey);
  return cell ? toFiniteNumber(schema.stage_6?.cells?.[cell]) : null;
}

/** Unit's own packaging first, then the Stage 6 row-73 cell the AI computed for it. */
// NEW
export function resolveUnitPackaging(schema: IProjectSchema, unitKey: string): number | null {
  const own = toFiniteNumber(schema.units?.[unitKey]?.value_packaging);
  if (own !== null) return own;
  const cell = unitPackagingCell(unitKey);
  return cell ? toFiniteNumber(schema.stage_6?.cells?.[cell]) : null;
}

/** Unit's own description first, then the Stage 6 Proposal J-cell for its row. */
export function resolveUnitDescription(schema: IProjectSchema, unitKey: string): string | null {
  const own = schema.units?.[unitKey]?.value_description;
  if (isRealDescription(own)) return own.trim();
  const cell = unitDescriptionCell(unitKey);
  const fromCells = cell ? schema.stage_6_proposal?.cells?.[cell] : null;
  return isRealDescription(fromCells) ? fromCells.trim() : null;
}

/** Whether a human edit holds this unit field against AI writes. */
export const isUnitFieldHumanHeld = (unit: unknown, field: string): boolean => {
  const meta = (unit as { _meta?: { human_override_fields?: unknown; human_override?: unknown } } | null)?._meta;
  if (Array.isArray(meta?.human_override_fields)) return meta!.human_override_fields.includes(field);
  return meta?.human_override === true;
};