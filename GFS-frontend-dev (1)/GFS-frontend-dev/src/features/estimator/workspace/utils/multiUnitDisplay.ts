import { MULTI_UNIT_KEYS, type MultiUnitKey } from "@/shared/types/multiUnit.types";

export type ApprovedUnitSummary = Record<string, unknown>;

export interface ApprovedUnitRow {
  key: MultiUnitKey;
  data: ApprovedUnitSummary;
}

const asRecord = (value: unknown): ApprovedUnitSummary =>
  value && typeof value === "object" ? (value as ApprovedUnitSummary) : {};

const unwrapValue = (value: unknown): unknown => {
  const record = asRecord(value);
  return "value" in record ? record.value : value;
};

const hasRealValue = (value: unknown): boolean => {
  const unwrapped = unwrapValue(value);
  return unwrapped !== null && unwrapped !== undefined && unwrapped !== "";
};

export const getApprovedUnitRows = (units: unknown): ApprovedUnitRow[] => {
  const unitMap = asRecord(units);

  return MULTI_UNIT_KEYS.flatMap((key) => {
    const data = asRecord(unitMap[key]);
    // The backend always builds a fixed-shape object (value_frame_type,
    // value_width_in, ...) for every unit key still present in schema.units,
    // even a "removed" one whose fields were all cleared to null — so
    // Object.keys(data).length is always > 0 and can't tell a real unit from
    // an emptied-out one. Require at least one actual value instead.
    // value_num_units defaults to 1 for every seeded unit (A-J), so it can't
    // count as real data on its own.
    const hasData = Object.entries(data).some(
      ([field, value]) => field !== "value_num_units" && hasRealValue(value),
    );
    return hasData ? [{ key, data }] : [];
  });
};

export const getUnitValue = (unit: ApprovedUnitSummary, key: string): unknown => {
  const value = unwrapValue(unit[key]);
  if (value !== null && value !== undefined && value !== "") return value;
  if (key === "value_cross_beam") return unwrapValue(unit.extracted_cross_beam);
  return value;
};

export const formatUnitValue = (value: unknown): string => {
  const unwrapped = unwrapValue(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") return "—";
  return String(unwrapped);
};

export const formatUnitOption = (value: unknown): string => {
  const text = formatUnitValue(value);
  if (text === "—") return text;

  return text
    .split("_")
    .map((word) => (word.length <= 2 ? word.toUpperCase() : `${word[0]}${word.slice(1).toLowerCase()}`))
    .join(" ");
};

/** A unit option per unit ("A: Glass NO Igu · B: Glass With Igu") when units differ, else null. */
export const summarizeMixedUnitOption = (units: ApprovedUnitRow[], key: string): string | null => {
  const chosen = units
    .map(({ key: unitKey, data }) => ({ unitKey, label: formatUnitOption(getUnitValue(data, key)) }))
    .filter(({ label }) => label !== "—");
  if (new Set(chosen.map(({ label }) => label)).size <= 1) return null;
  return chosen.map(({ unitKey, label }) => `${unitKey}: ${label}`).join(" · ");
};

export const getUnitSpecLabel = (unit?: ApprovedUnitSummary): string | null => {
  if (!unit) return null;

  const frame = formatUnitOption(getUnitValue(unit, "value_frame_type"));
  const glass = formatUnitOption(getUnitValue(unit, "value_glass_type"));
  const thickness = formatUnitValue(getUnitValue(unit, "value_glass_thickness"));
  const parts = [
    frame !== "—" ? `Frame: ${frame}` : null,
    glass !== "—" ? `Glass: ${glass}` : null,
    thickness !== "—" ? `Thickness: ${thickness}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
};

export const formatProposalStatus = (status?: string): string => {
  if (!status) return "Pending";
  if (status === "READY_FOR_PROPOSAL_EXCEL" || status === "READY_FOR_EXCEL") {
    return "Ready for Excel";
  }
  return status.replaceAll("_", " ");
};
