import {
  hasPreviousValue,
  type FieldFeedbackRequest,
} from "@/shared/types/fieldFeedback.types";

/** Inputs hand back strings, so compare loosely against the stored value. */
export const valuesDiffer = (previous: unknown, next: unknown): boolean => {
  if (previous === next) return false;
  if (previous === null || previous === undefined) return true;
  return String(previous) !== String(next);
};

/**
 * Keep only the edits worth asking about: a value the AI actually produced that
 * the estimator has genuinely changed. Filling a blank is not a correction.
 */
export const toFeedbackRequests = (
  candidates: FieldFeedbackRequest[]
): FieldFeedbackRequest[] =>
  candidates.filter(
    (c) => hasPreviousValue(c.previousValue) && valuesDiffer(c.previousValue, c.newValue)
  );

/** `stage_4.takeoff.units.A.value_width_in` -> `units.A`. Null for any other path. */
export const unitKeyOfPath = (path: string): string | null => {
  const match = /\.units\.([A-J])\./.exec(path);
  return match ? `units.${match[1]}` : null;
};

interface ScalarRow {
  label: string;
  path: string;
  field?: { value?: unknown } | undefined;
}

interface UnitRow {
  key: string;
  unit: string;
  [column: string]: unknown;
}

const UNIT_COLUMNS: Array<{ pathKey: string; rawKey: string; label: string }> = [
  { pathKey: "locationPath", rawKey: "locationRaw", label: "Location" },
  { pathKey: "drawingPath", rawKey: "drawingRaw", label: "Drawing number" },
  { pathKey: "widthPath", rawKey: "widthRaw", label: "Width" },
  { pathKey: "lengthPath", rawKey: "lengthRaw", label: "Length" },
  { pathKey: "panelsPath", rawKey: "panelsRaw", label: "Panels" },
  { pathKey: "numUnitsPath", rawKey: "numUnitsRaw", label: "Number of units" },
  { pathKey: "verticalRaftersPath", rawKey: "verticalRaftersRaw", label: "Vertical rafters" },
  { pathKey: "horizontalRaftersPath", rawKey: "horizontalRaftersRaw", label: "Horizontal rafters" },
  { pathKey: "frameTypePath", rawKey: "frameTypeRaw", label: "Frame type" },
  { pathKey: "glassTypePath", rawKey: "glassTypeRaw", label: "Glass type" },
  { pathKey: "crossbeamPath", rawKey: "crossbeamRaw", label: "Crossbeam" },
  { pathKey: "glassThicknessPath", rawKey: "glassThicknessRaw", label: "Glass thickness" },
];

/**
 * Parameters mixes plain fields with the takeoff table. Plain fields get one
 * request each; every changed column of a takeoff row collapses into a single
 * request keyed `units.<id>`, so filling a row asks once rather than once per column.
 */
export const buildParameterFeedbackRequests = (
  changes: Record<string, unknown>,
  scalarRows: ScalarRow[],
  unitRows: UnitRow[]
): FieldFeedbackRequest[] => {
  const scalars: FieldFeedbackRequest[] = [];
  const unitColumns = new Map<string, { unit: string; columns: string[]; previousValue: unknown; newValue: unknown }>();

  for (const [path, newValue] of Object.entries(changes)) {
    const unitKey = unitKeyOfPath(path);

    if (!unitKey) {
      const row = scalarRows.find((r) => r.path === path);
      scalars.push({
        key: path,
        label: row?.label ?? path,
        previousValue: row?.field?.value ?? null,
        newValue,
      });
      continue;
    }

    const row = unitRows.find((r) => `units.${r.key}` === unitKey);
    const column = UNIT_COLUMNS.find((c) => row?.[c.pathKey] === path);
    const previousValue = column ? row?.[column.rawKey] : undefined;
    if (!hasPreviousValue(previousValue) || !valuesDiffer(previousValue, newValue)) continue;

    const existing = unitColumns.get(unitKey);
    if (existing) {
      existing.columns.push(column?.label ?? path);
    } else {
      unitColumns.set(unitKey, {
        unit: row?.unit ?? unitKey,
        columns: [column?.label ?? path],
        previousValue,
        newValue,
      });
    }
  }

  const unitRequests: FieldFeedbackRequest[] = [...unitColumns.entries()].map(([key, entry]) => ({
    key,
    label: `Takeoff unit ${entry.unit}`,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    changedColumns: entry.columns,
  }));

  return [...toFeedbackRequests(scalars), ...unitRequests];
};
