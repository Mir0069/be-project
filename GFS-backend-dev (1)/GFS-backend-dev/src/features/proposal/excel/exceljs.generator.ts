import ExcelJS from 'exceljs';
import { IProjectSchema } from '@db/models/proposal.model';
import { ExcelTemplateModel } from '@db/models/excel-template.model';

// Cached workbook buffer — stores a COPY of the raw bytes from MongoDB.
// We copy it again before every load() call because ExcelJS.load() can
// mutate / partially consume the underlying ArrayBuffer in place, which
// silently corrupts the cached reference for subsequent requests.
let cachedWorkbookBuffer: Buffer | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const parseParameterValue = (raw: any): number | string => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return raw;
  const trimmed = String(raw).trim();
  const stripped = trimmed.replace(/^\$/, '').replace(/%$/, '');
  if (stripped !== '') {
    const num = Number(stripped);
    if (!isNaN(num)) return num;
  }
  return trimmed;
};

/**
 * MD §5.3: a stage_6 cells value that is a string starting with `=` is an
 * Excel formula, not literal text. ExcelJS only treats `{ formula }` objects
 * as formulas — assigning the raw "=SUM(...)" string writes literal text.
 * Centralize the conversion so sparse AI cell maps (only real values present,
 * trigger chars written as-given) round-trip correctly if AI ever emits a
 * formula. Non-formula values pass through parseParameterValue unchanged.
 */
export const toExcelCellValue = (raw: unknown): string | number | { formula: string } => {
  if (typeof raw === 'string' && raw.startsWith('=')) {
    return { formula: raw.slice(1) };
  }
  return parseParameterValue(raw);
};

/**
 * Returns a FRESH COPY of the template buffer every time so callers
 * can safely hand it to ExcelJS without corrupting the cached original.
 */
export async function loadTemplateBuffer(): Promise<Buffer> {
  const now = Date.now();

  if (!cachedWorkbookBuffer || now - lastCacheTime >= CACHE_TTL) {
    const templateDoc = await ExcelTemplateModel.findOne({ isActive: true });
    if (!templateDoc?.fileBuffer) {
      throw new Error('No active Excel template found in database');
    }
    // Store a defensive copy so the DB buffer and our cache are independent.
    // In some Mongoose versions/configurations, fileBuffer is a mongodb.Binary object.
    const rawData = (templateDoc.fileBuffer as any).buffer || templateDoc.fileBuffer;
    cachedWorkbookBuffer = Buffer.from(rawData);
    lastCacheTime = now;
  }

  // CRITICAL: always return a fresh copy — never the cached reference itself.
  // ExcelJS.xlsx.load() can mutate the underlying ArrayBuffer, which would
  // corrupt the cache and cause every subsequent request to load a broken workbook.
  return Buffer.from(cachedWorkbookBuffer);
}

export async function generateProposalExcel(schema: IProjectSchema, resolvedCategories: any[] = []): Promise<Buffer> {
  // loadTemplateBuffer now always returns an isolated copy — safe to mutate.
  const templateBuffer = await loadTemplateBuffer();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as any);
  (workbook as any).calcProperties = {
    calcMode: 'auto',
    fullCalcOnLoad: true,
  };

  const sheet = workbook.worksheets[0]; // Pricing Worksheet
  if (!sheet) {
    throw new Error('Template does not contain any worksheets');
  }

  // Build the final cell map:
  //   1. stage_6.cells  — all AI-computed qty / input values
  //   2. stage_7.cost_overrides  — estimator edits that win over everything
  const mergedCells: Record<string, string | number> = {};

  // 1. Add dynamically resolved fields from Stage 1-5 (Final Parameters schema)
  for (const cat of resolvedCategories) {
    for (const field of cat.fields) {
      if (field.cell) {
        mergedCells[field.cell] = field.rawQty !== undefined ? field.rawQty : field.qty;
      }
    }
  }

  // 2. Add legacy stage 6 cells (if any)
  if (schema.stage_6?.cells) {
    Object.assign(mergedCells, schema.stage_6.cells);
  }

  if (schema.stage_7?.cost_overrides) {
    // Applied last so they unconditionally overwrite stage_6 values.
    for (const [cell, cost] of Object.entries(schema.stage_7.cost_overrides)) {
      mergedCells[cell] = cost;
    }
  }
console.log("Sheet name:", sheet.name);
console.log("Merged cells:", Object.keys(mergedCells).length);
console.log("Sample:", Object.entries(mergedCells).slice(0, 20));

for (const [address, value] of Object.entries(mergedCells)) {
  if (value == null) continue;

  const cell = sheet.getCell(address);
  cell.value = toExcelCellValue(value) as any;

  if (["C2", "F2", "E115", "D9", "C9"].includes(address)) {
    console.log(address, "=>", cell.value);
  }
}

console.log("Final C2:", sheet.getCell("C2").value);
console.log("Final E115:", sheet.getCell("E115").value);
  for (const [address, value] of Object.entries(mergedCells)) {
    if (value === null || value === undefined) continue;

    const cell = sheet.getCell(address);
    // Always write the value directly — stage_6 and stage_7 values are the
    // source of truth for every cell they cover.  The formula-preservation
    // guard that existed here was the root cause of production failures: it
    // silently no-op'd qty writes whenever the template cell happened to
    // contain a formula, so those columns stayed at 0 in the output.
    // Formulas in cells NOT present in mergedCells are untouched naturally.
    // Leading-"=" AI values are written as real formulas (MD §5.3).
    cell.value = toExcelCellValue(value) as any;
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}