import ExcelJS from 'exceljs';

export interface PricingSnapshot {
  subtotal?: number;
  total?: number;
  final_price: number;
  optional_add_on_total?: number;
  grand_total?: number;
}

const normalizeLabel = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const numericCellValue = (value: unknown): number | null => {
  const resolved = value && typeof value === 'object' && 'result' in value
    ? (value as { result?: unknown }).result
    : value;
  if (resolved === null || resolved === undefined || resolved === '') return null;
  const parsed = typeof resolved === 'number' ? resolved : Number(resolved);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const findLabelRow = (worksheet: ExcelJS.Worksheet, label: string): number | null => {
  const target = normalizeLabel(label);
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rowValues = Array.isArray(row.values) ? row.values : Object.values(row.values);
    if (rowValues.some((value) => normalizeLabel(value) === target)) return rowNumber;
  }
  return null;
};

/**
 * The worksheet stores one amount column per unit. For multi-unit projects,
 * the preceding quantity-total column contains the unit amount multiplied by
 * its number of units. Sum those totals for active units only, preventing
 * phantom template numbers from inflating the project price.
 */
const sumUnitTotals = (
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  activeUnitCount?: number,
): number | null => {
  const amountColumns = ['F', 'I', 'L', 'O', 'R', 'U', 'X', 'AA', 'AD', 'AG'];
  const quantityTotalColumns = ['E', 'H', 'K', 'N', 'Q', 'T', 'W', 'Z', 'AC', 'AF'];
  let total = 0;
  let found = false;

  const maxUnits = typeof activeUnitCount === 'number' && activeUnitCount > 0
    ? Math.min(activeUnitCount, amountColumns.length)
    : amountColumns.length;

  for (let index = 0; index < maxUnits; index += 1) {
    const unitTotal = numericCellValue(worksheet.getCell(`${quantityTotalColumns[index]}${rowNumber}`).value);
    const unitAmount = numericCellValue(worksheet.getCell(`${amountColumns[index]}${rowNumber}`).value);
    const amount = unitTotal !== null ? unitTotal : unitAmount;
    if (amount === null) continue;
    total += amount;
    found = true;
  }

  return found ? total : null;
};

const findRightmostNumber = (worksheet: ExcelJS.Worksheet, label: string): number | null => {
  const target = normalizeLabel(label);

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rowValues = Array.isArray(row.values) ? row.values : Object.values(row.values);
    const containsLabel = rowValues.some((value) => normalizeLabel(value) === target);
    if (!containsLabel) continue;

    for (let column = worksheet.columnCount; column >= 1; column -= 1) {
      const value = numericCellValue(row.getCell(column).value);
      if (value !== null) return value;
    }
  }

  return null;
};

/** Reads the calculated pricing totals returned by Microsoft Graph. Accepts either an existing loaded Workbook or a Buffer. */
export const extractPricingSnapshot = async (
  workbookOrBuffer: ExcelJS.Workbook | Buffer,
  activeUnitCount?: number,
): Promise<PricingSnapshot | null> => {
  let workbook: ExcelJS.Workbook;
  if (workbookOrBuffer instanceof ExcelJS.Workbook) {
    workbook = workbookOrBuffer;
  } else {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookOrBuffer as any);
  }
  const worksheet = workbook.getWorksheet('Pricing Worksheet') ?? workbook.worksheets[0];
  if (!worksheet) return null;

  const finalPriceRow = findLabelRow(worksheet, 'FINAL PRICE');
  const finalPrice = finalPriceRow === null
    ? null
    : sumUnitTotals(worksheet, finalPriceRow, activeUnitCount) ?? findRightmostNumber(worksheet, 'FINAL PRICE');
  // A zero final price means the workbook formula has not been calculated,
  // not that the approved proposal is free. Treat it as unavailable so it
  // cannot overwrite a previously saved value.
  if (finalPrice === null || finalPrice <= 0) return null;

  const subtotalRow = findLabelRow(worksheet, 'Sub Total');
  const totalRow = findLabelRow(worksheet, 'TOTAL');
  const subtotal = subtotalRow === null
    ? null
    : sumUnitTotals(worksheet, subtotalRow, activeUnitCount) ?? findRightmostNumber(worksheet, 'Sub Total');
  const total = totalRow === null
    ? null
    : sumUnitTotals(worksheet, totalRow, activeUnitCount) ?? findRightmostNumber(worksheet, 'TOTAL');
  return {
    ...(subtotal !== null ? { subtotal } : {}),
    ...(total !== null ? { total } : {}),
    final_price: finalPrice,
  };
};
