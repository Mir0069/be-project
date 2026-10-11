import axios from 'axios';
import AdmZip from 'adm-zip';
import { HyperFormula } from 'hyperformula';
import { StatusCodes } from 'http-status-codes';
import { IProjectSchema } from '@db/models/proposal.model';
import { ExcelTemplateModel } from '@db/models/excel-template.model';
import { getFieldDefinition } from '@features/proposal/schema-registry';
import type {
  FinalParameterCalculation,
  ResolvedFinalParameterCategory,
  ResolvedFinalParameterField,
} from '@features/proposal/final-parameters.calculator';
import {
  getOptionalAddOnStatuses,
  type OptionalAddOnCell,
} from '@features/proposal/final-parameters.calculator';
import { normalizePhoneValue } from '@shared/utils/phone-values';
import { env } from '@config/env';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import { findLabelRow } from './pricing-snapshot';
import { UNIT_KEYS, resolveUnitDescription, resolveUnitManHours, resolveUnitPackaging } from '../unit-derived-values';
import {
  hasRealUnitData,
  matchFrameTypeKey,
  matchGlassTypeKey,
  resolveUnitProducts,
} from '../unit-pricing-products';

// Kept exported from here so existing imports of these helpers keep working.
export { hasRealUnitData, matchCrossbeamKey, matchFrameTypeKey, matchGlassTypeKey } from '../unit-pricing-products';

import ExcelJS from 'exceljs';

let cachedGraphToken: { token: string; expiresAt: number } | null = null;

const PRICING_SHEET_SKIP_CELLS = new Set(['I2']);
// K2 is the Proposal sheet's own Proposal# formula cell (reads from
// 'Pricing Worksheet'!I2). C2/F2/C3/I3/C4/F4/L2/L3 are NOT part of the
// Proposal sheet's real content at all — they are the Pricing Worksheet's
// header input cells (project name/address/type/architect/contact/phone/
// email/quoted-by). The Proposal sheet's own header block reads those same
// values via K2-K11 formulas that point at 'Pricing Worksheet', not at these
// local addresses. When the AI-generated stage_6_proposal.cells payload
// mistakenly reuses the Pricing Worksheet's header addresses, these plain
// (non-formula) Proposal-sheet cells silently accept the write and render as
// duplicate/garbled header text sitting behind the logo. Block them here so
// that garbage can never land on the Proposal sheet again.
// D2/D3/D4 must be blocked too: the Proposal sheet template merges C2:D2,
// C3:D3 and C4:D4, so ExcelJS resolves a write to the D-column partner onto
// the same shared merged cell as C2/C3/C4 — blocking only the C-column
// address left the merge partner as an open backdoor for the same leak.
const PROPOSAL_SHEET_SKIP_CELLS = new Set([
  'K2', 'C2', 'D2', 'F2', 'C3', 'D3', 'I3', 'C4', 'D4', 'F4', 'L2', 'L3',
  // Orphaned entries found sitting in schema.stage_6_proposal.cells with no
  // legitimate meaning on the Proposal sheet at all (confirmed the pristine
  // template has nothing at these addresses) — every regeneration replayed
  // them back onto the sheet, and since the next extraction read them right
  // back off the now-polluted sheet, they never aged out on their own.
  'D20', 'D41', 'D90', 'C139',
]);

/**
 * True for ANY column of an addon section's header row OR its 10 unit rows
 * (one row above each base in `addonSectionBases`, through base+9) — not
 * just the header's label column or the unit rows' $ column. Confirmed
 * against a real workbook that a whole row, not just one column of it, can
 * carry stale leftover data from an older template revision where that row
 * number meant something else entirely: "A-201 / 20 / 30 / 1 / 1 / 0 / 0"
 * bled through next to a header label in columns C-K, and a stray "y"/"Y"
 * clobbered the static "add" label in column D of two addon unit rows.
 */
export function isAddonSectionRowAddress(address: string, addonSectionBases: number[]): boolean {
  const row = Number(/^[A-Z]+(\d+)$/.exec(address)?.[1]);
  return addonSectionBases.some((base) => row >= base - 1 && row <= base + 9);
}
const UNIT_SELECTION_COLUMNS = ['D', 'G', 'J', 'M', 'P', 'S', 'V', 'Y', 'AB', 'AE'] as const;
const UNIT_QUANTITY_COLUMNS = ['E', 'H', 'K', 'N', 'Q', 'T', 'W', 'Z', 'AC', 'AF'] as const;
const UNIT_AMOUNT_COLUMNS = ['F', 'I', 'L', 'O', 'R', 'U', 'X', 'AA', 'AD', 'AG'] as const;
const DIRECT_QUANTITY_ROWS = new Set([
  'C64', 'C68',
  'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82', 'C85',
]);
const DIRECT_AMOUNT_ROWS = new Set(['C68', 'C75', 'C81']);

export function isExcelGraphConfigured(): boolean {
  const { tenantId, clientId, clientSecret } = env.excelGraph;
  return Boolean(tenantId && clientId && clientSecret);
}

const graphUserRoot = (): string =>
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.excelGraph.testUserId)}`;

const assertExcelGraphConfigured = (): void => {
  if (!isExcelGraphConfigured()) {
    throw new AppError(
      'Excel export is not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET.',
      StatusCodes.SERVICE_UNAVAILABLE,
      true,
      { code: ErrorCode.SERVICE_UNAVAILABLE },
    );
  }
};

async function getGraphToken(): Promise<string> {
  assertExcelGraphConfigured();

  if (cachedGraphToken && Date.now() < cachedGraphToken.expiresAt) {
    return cachedGraphToken.token;
  }

  const url = `https://login.microsoftonline.com/${env.excelGraph.tenantId}/oauth2/v2.0/token`;

  const data = new URLSearchParams({
    client_id: env.excelGraph.clientId,
    client_secret: env.excelGraph.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  let response;
  try {
    response = await axios.post(url, data.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  } catch (error: any) {
    throw new AppError(
      'Microsoft Graph authentication failed for Excel export.',
      StatusCodes.BAD_GATEWAY,
      true,
      {
        code: ErrorCode.SERVICE_UNAVAILABLE,
        details: { status: error?.response?.status ?? null },
      },
    );
  }

  if (!response.data?.access_token) {
    throw new AppError(
      'Microsoft Graph did not return an access token for Excel export.',
      StatusCodes.BAD_GATEWAY,
      true,
      { code: ErrorCode.SERVICE_UNAVAILABLE },
    );
  }

  const expiresIn = response.data.expires_in || 3600;
  cachedGraphToken = {
    token: response.data.access_token,
    expiresAt: Date.now() + Math.max(0, (expiresIn - 60) * 1000),
  };

  return cachedGraphToken.token;
}

export const parseParameterValue = (raw: any): number | string | null => {
  if (raw === null || raw === undefined) return null;
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
 * Trigger characters ("y"/"Y") pass through untouched; only a leading "="
 * takes the formula path. Sparse maps are honored by callers (only keys
 * present are written; template defaults elsewhere are left alone).
 */
export const toExcelCellValue = (raw: unknown): string | number | null | { formula: string } => {
  if (typeof raw === 'string' && raw.startsWith('=')) {
    return { formula: raw.slice(1) };
  }
  return parseParameterValue(raw);
};

// Upper row bound when harvesting computed values from the Proposal sheet.
// The proposal content lives well above this; skipping the tail keeps the
// extraction fast and avoids picking up stray template artifacts.
const PROPOSAL_SHEET_MAX_ROW = 200;

/**
 * Reads the CALCULATED workbook (post-Graph) and harvests every non-empty
 * literal / cached-formula-result value on the Proposal sheet. Used to
 * back-fill stage_6_proposal.cells so Edit Draft shows what was actually
 * generated. Formula cells contribute their cached result; K2 is skipped.
 */
export async function extractComputedProposalCells(
  workbookOrBuffer: ExcelJS.Workbook | Buffer,
  targetSheet: string,
): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  try {
    let wb: ExcelJS.Workbook;
    if (workbookOrBuffer instanceof ExcelJS.Workbook) {
      wb = workbookOrBuffer;
    } else {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(workbookOrBuffer as any);
    }
    const ws = wb.getWorksheet(targetSheet);
    if (!ws) return out;

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > PROPOSAL_SHEET_MAX_ROW) return;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const address = cell.address;
        if (!address || PROPOSAL_SHEET_SKIP_CELLS.has(address)) return;

        let value: unknown = cell.value;
        if (value && typeof value === 'object') {
          const v = value as any;
          if ('result' in v) value = v.result ?? null;
          else if ('richText' in v && Array.isArray(v.richText)) {
            value = v.richText.map((r: any) => r?.text ?? '').join('');
          } else if ('text' in v) value = v.text;
          else if (value instanceof Date) value = value.toISOString().slice(0, 10);
          else value = null;
        }

        if (typeof value === 'number') {
          if (Number.isFinite(value)) out[address] = value;
          return;
        }
        if (typeof value === 'boolean') return;
        if (typeof value !== 'string') return;
        const str = value.trim();
        if (str === '') return;
        // Unit grid (rows 23-32) ships a literal "Description" placeholder in
        // the merged J:K description cell for every row — static template
        // boilerplate, not data. J is the merge's real (master) address;
        // ExcelJS's row.eachCell still reports K separately (mirroring the
        // same value), so both must be excluded or harvesting either one
        // makes Edit Draft render the label as a populated value.
        if (/^[JK](2[3-9]|3[0-2])$/.test(address) && str === 'Description') return;
        out[address] = str;
      });
    });
  } catch (err) {
    console.error('[Graph Generator] Failed to extract computed proposal cells:', err);
  }
  return out;
}

let cachedTemplateBuffer: Buffer | null = null;

export function invalidateTemplateBufferCache(): void {
  cachedTemplateBuffer = null;
}

export function setCachedTemplateBuffer(buffer: Buffer | null): void {
  cachedTemplateBuffer = buffer;
}

export async function loadTemplateBuffer(): Promise<Buffer> {
  if (cachedTemplateBuffer) {
    return Buffer.from(cachedTemplateBuffer);
  }
  const templateDoc = await ExcelTemplateModel.findOne({ isActive: true }).lean();
  if (!templateDoc || !templateDoc.fileBuffer) {
    throw new AppError(
      'No active Excel template is configured for Excel export.',
      StatusCodes.SERVICE_UNAVAILABLE,
      true,
      { code: ErrorCode.NO_EXCEL_TEMPLATE },
    );
  }
  const rawData = (templateDoc.fileBuffer as any)?.buffer || templateDoc.fileBuffer;
  cachedTemplateBuffer = Buffer.isBuffer(rawData)
    ? rawData
    : Buffer.from(rawData);
  return Buffer.from(cachedTemplateBuffer);
}

// Manual take-off fields whose values are entered by the estimator in the
// Parameters (Stage 4) page and must always win over any AI-generated cell.
const MANUAL_TAKEOFF_FIELDS = [
  {
    path: 'stage_4.takeoff.packaging',
    excelCell: 'E73',
    value: (s: IProjectSchema) => s.stage_4?.takeoff?.packaging?.value ?? null,
  },
] as const;

// Manual project header fields entered in Stage 1 that must be stamped into Excel.
// Ingestion round-trips all 12 header cells (C2/F2/C3/F3/I3/L3/C4/F4/I4/L4/L2/P2),
// so generation must stamp the same full set — otherwise a pure Stage-1 AI push
// never reaches the workbook.
const MANUAL_HEADER_FIELDS = [
  { path: 'stage_1.project_name', value: (s: IProjectSchema) => s.stage_1?.project_name?.value ?? null },
  { path: 'stage_1.project_address', value: (s: IProjectSchema) => s.stage_1?.project_address?.value ?? null },
  { path: 'stage_1.contact_name', value: (s: IProjectSchema) => s.stage_1?.contact_name?.value ?? null },
  { path: 'stage_1.contact_address', value: (s: IProjectSchema) => s.stage_1?.contact_address?.value ?? null },
  { path: 'stage_1.contact_phone', value: (s: IProjectSchema) => normalizePhoneValue(s.stage_1?.contact_phone?.value) },
  { path: 'stage_1.contact_email', value: (s: IProjectSchema) => s.stage_1?.contact_email?.value ?? null },
  { path: 'stage_1.project_type', value: (s: IProjectSchema) => s.stage_1?.project_type?.value ?? null },
  { path: 'stage_1.architect', value: (s: IProjectSchema) => s.stage_1?.architect?.value ?? null },
  { path: 'stage_1.homeowner', value: (s: IProjectSchema) => s.stage_1?.homeowner?.value ?? null },
  { path: 'stage_1.drafter_designer', value: (s: IProjectSchema) => s.stage_1?.drafter_designer?.value ?? null },
  { path: 'stage_1.person_quoting', value: (s: IProjectSchema) => s.stage_1?.person_quoting?.value ?? null },
  { path: 'stage_1.person_checked', value: (s: IProjectSchema) => s.stage_1?.person_checked?.value ?? null },
] as const;

/**
 * Approved per-unit take-off data (width/length/panel count/unit count and
 * vertical/horizontal crossbeam counts) for the Pricing Worksheet's Take-Off
 * Sheet rows (115-124, Unit A-J), keyed by each unit's own excel_*_cell addresses.
 * Crossbeam quantity (N115 = K115*E115 + L115*F115) depends on the
 * vertical/horizontal counts specifically — unlike Perimeter rows, a "y"
 * flag alone isn't enough, so this must always reflect estimator-approved
 * data rather than whatever the AI extraction guessed.
 */
/**
 * True if a seeded unit slot (schema-registry.ts pre-seeds A-J for every
 * project) has ever actually been given real take-off data. value_num_units
 * defaults to 1 for every seeded unit, so it alone can't be used as the
 * signal — without this check every unused unit slot would look "real".
 */
export function buildPricingWorksheetUnitCells(schema: IProjectSchema): Record<string, string | number> {
  const cells: Record<string, string | number> = {};

  for (const [unitKey, unit] of Object.entries(schema.units ?? {})) {
    if (!unit) continue;
    if (!hasRealUnitData(unit)) continue;

    const unitIndex = /^[A-J]$/i.test(unitKey) ? unitKey.toUpperCase().charCodeAt(0) - 65 : -1;
    if (unitIndex < 0) continue;
    const officialRow = 115 + unitIndex;

    // Write strictly to canonical takeoff rows (115-124). We deliberately do NOT use
    // unit.excel_*_cell here because legacy projects may contain stale 'E113' values
    // that would overwrite the template's row 113-114 header text.
    if (unit.value_width_in != null) cells[`E${officialRow}`] = unit.value_width_in;
    if (unit.value_length_in != null) cells[`F${officialRow}`] = unit.value_length_in;
    if (unit.value_panel_count != null) cells[`G${officialRow}`] = unit.value_panel_count;
    if (unit.value_num_units != null) cells[`J${officialRow}`] = unit.value_num_units;
    const vertRafters = unit.value_vertical_rafter_count ?? schema.stage_6?.cells?.[`K${officialRow}`] ?? (unit.value_panel_count && unit.value_panel_count > 1 ? unit.value_panel_count - 1 : null);
    if (vertRafters != null) cells[`K${officialRow}`] = vertRafters;
    const horizRafters = unit.value_horizontal_rafter_count ?? schema.stage_6?.cells?.[`L${officialRow}`] ?? null;
    if (horizRafters != null) cells[`L${officialRow}`] = horizRafters;
  }

  return cells;
}

const resolvedFields = (calculation?: FinalParameterCalculation): ResolvedFinalParameterField[] =>
  calculation?.categories.flatMap((category: ResolvedFinalParameterCategory) => category.fields) ?? [];

const normalizeSelection = (value: unknown): 'Y' | 'N' =>
  String(value ?? '').trim().toUpperCase() === 'Y' ? 'Y' : 'N';

/**
 * Applies the backend-resolved Stage 7 controls to the workbook's existing
 * unit-column layout. The workbook keeps its formulas and presentation; only
 * the current estimator inputs and the few template rows without formulas are
 * stamped here.
 */
const buildResolvedPricingCells = (
  schema: IProjectSchema,
  calculation?: FinalParameterCalculation,
): Record<string, string | number> => {
  const cells: Record<string, string | number> = {};
  const fields = resolvedFields(calculation);
  const fieldsByCell = new Map(fields.map((field) => [field.cell, field]));

  if (schema.stage_7?.additional_charge_selections) {
    for (const [costCell, selection] of Object.entries(schema.stage_7.additional_charge_selections)) {
      const row = /^C(\d+)$/.exec(costCell)?.[1];
      if (!row) continue;
      for (const column of UNIT_SELECTION_COLUMNS) {
        cells[`${column}${row}`] = normalizeSelection(selection);
      }
    }
  }

  // Stamp any selections resolved by calculation (ensures all Y/N selections match UI 100%)
  for (const field of fields) {
    if (field.selection) {
      const row = /^C(\d+)$/.exec(field.cell)?.[1];
      if (row) {
        for (const column of UNIT_SELECTION_COLUMNS) {
          cells[`${column}${row}`] = normalizeSelection(field.selection);
        }
      }
    }
  }

  // Glass/frame/crossbeam 'y' flags are set per unit by applyPricingWorksheetSelections.
  // An estimator's per-unit quantity replaces that unit's formula quantity on the product row.
  for (const field of fields) {
    const row = field.cell.slice(1);
    for (const line of field.units ?? []) {
      const unitIndex = (UNIT_KEYS as readonly string[]).indexOf(line.unitKey);
      if (!line.quantityOverridden || line.quantity === null || unitIndex < 0) continue;
      cells[`${UNIT_QUANTITY_COLUMNS[unitIndex]}${row}`] = line.quantity;
    }
  }

  // Stage 5 options (Sentry Glass, Krypton, Backpaint, Custom Shape)
  const optionMap: Record<string, string> = {
    C16: 'sentry_glass',
    C17: 'krypton_gas',
    C20: 'backpaint',
    C21: 'custom_shape',
  };
  for (const [cellKey, addonKey] of Object.entries(optionMap)) {
    const addon = (schema.stage_5?.addons as any)?.[addonKey];
    const isSelected = addon === 'y' || addon === 'Y' || addon === true;
    if (isSelected) {
      const row = cellKey.slice(1);
      for (const column of UNIT_SELECTION_COLUMNS) {
        cells[`${column}${row}`] = 'y';
      }
    }
  }

  // Project-level charge quantities live in the first unit block. The other
  // blocks must be zeroed so a stale template value cannot duplicate the charge.
  for (const costCell of DIRECT_QUANTITY_ROWS) {
    const field = fieldsByCell.get(costCell);
    if (!field) continue;
    const row = costCell.slice(1);
    const quantity = field.quantity ?? 0;
    cells[`E${row}`] = quantity;
    for (const column of UNIT_QUANTITY_COLUMNS.slice(1)) {
      cells[`${column}${row}`] = 0;
    }
  }

  // Row 71 (Shop Fabrication Man Hours): Distribute per-unit hours into unit quantity columns (E71 for Unit A, H71 for Unit B, etc.)
  const manHoursRow = '71';
  const unitsMap = schema.units ?? {};
  const activeUnitKeys = Object.keys(unitsMap).filter((k) => /^[A-J]$/i.test(k) && hasRealUnitData(unitsMap[k]));
  let totalDistributedHours = 0;
  if (activeUnitKeys.length > 0) {
    for (let i = 0; i < UNIT_QUANTITY_COLUMNS.length; i++) {
      const col = UNIT_QUANTITY_COLUMNS[i];
      const unitKey = String.fromCharCode(65 + i);
      // Unit's own hours, else the row-71 hours AI Stage 6 computed for it —
      // never a blind 0 over hours the AI actually priced.
      const unitHours = resolveUnitManHours(schema, unitKey);
      if (unitHours != null && unitHours > 0) {
        cells[`${col}${manHoursRow}`] = unitHours;
        totalDistributedHours += unitHours;
      } else if (activeUnitKeys.includes(unitKey)) {
        cells[`${col}${manHoursRow}`] = 0;
      }
    }
  }
  // If units did not have individual man hours set, fallback to the calculation total or stage_5 value on Unit A
  if (totalDistributedHours === 0) {
    const fallbackHours = calculation?.metrics?.totalManHours ?? schema.stage_5?.calculated?.total_man_hours?.value ?? null;
    if (fallbackHours != null && Number.isFinite(Number(fallbackHours)) && Number(fallbackHours) > 0) {
      cells[`E${manHoursRow}`] = Number(fallbackHours);
    }
  }

 // Row 73 (Packaging): distribute per-unit packaging into unit quantity columns (E73 = Unit A, H73 = Unit B, ...)
  const packagingRow = '73';
  let totalDistributedPackaging = 0;
  if (activeUnitKeys.length > 0) {
    for (let i = 0; i < UNIT_QUANTITY_COLUMNS.length; i++) {
      const col = UNIT_QUANTITY_COLUMNS[i];
      const unitKey = String.fromCharCode(65 + i);
      const unitPackaging = resolveUnitPackaging(schema, unitKey);
      if (unitPackaging != null && unitPackaging > 0) {
        cells[`${col}${packagingRow}`] = unitPackaging;
        totalDistributedPackaging += unitPackaging;
      } else if (activeUnitKeys.includes(unitKey)) {
        cells[`${col}${packagingRow}`] = 0;
      }
    }
  }
  if (totalDistributedPackaging === 0) {
    const fallbackPackaging = calculation?.metrics?.totalPackaging ?? schema.stage_5?.calculated?.total_packaging?.value ?? null;
    if (fallbackPackaging != null && Number.isFinite(Number(fallbackPackaging)) && Number(fallbackPackaging) > 0) {
      cells[`E${packagingRow}`] = Number(fallbackPackaging);
    }
  }

  // Custom gasket, Engineering, and Custom Upcharge do not have a usable
  // quantity/amount formula in the supplied template. Stamp their resolved
  // amount directly so the Excel total remains identical to the backend
  // contract.
  for (const costCell of DIRECT_AMOUNT_ROWS) {
    const field = fieldsByCell.get(costCell);
    if (!field) continue;
    cells[`F${costCell.slice(1)}`] = field.amount ?? 0;
  }

  return cells;
};

export function buildMergedCells(
  schema: IProjectSchema,
  calculation?: FinalParameterCalculation,
): Record<string, string | number> {
  const merged: Record<string, string | number> = { ...schema.stage_6?.cells };

  if (schema.stage_7?.cost_overrides) {
    for (const [cell, cost] of Object.entries(schema.stage_7.cost_overrides)) {
      merged[cell] = cost;
    }
  }

  for (const { path, value } of MANUAL_HEADER_FIELDS) {
    const raw = value(schema);
    if (raw === null || raw === undefined) continue;
    const excelCell = getFieldDefinition(path)?.excelCell;
    if (!excelCell) continue;
    merged[excelCell] = raw;
  }

  for (const { path, excelCell: manualExcelCell, value } of MANUAL_TAKEOFF_FIELDS) {
    const raw = value(schema);
    if (raw === null || raw === undefined) continue;
    const excelCell = manualExcelCell ?? getFieldDefinition(path)?.excelCell;
    if (!excelCell) continue;
    merged[excelCell] = raw;
  }

  // Approved unit take-off data always wins over AI-extracted stage_6 cells.
  for (const [cell, value] of Object.entries(buildPricingWorksheetUnitCells(schema))) {
    merged[cell] = value;
  }

  for (const [cell, value] of Object.entries(buildResolvedPricingCells(schema, calculation))) {
    merged[cell] = value;
  }

  return merged;
}

const isDescriptionPlaceholder = (address: string, value: unknown): boolean =>
  /^[JK](2[3-9]|3[0-2])$/.test(address) && value === 'Description';

const clearDescriptionPlaceholders = (worksheet: ExcelJS.Worksheet): void => {
  for (let row = 23; row <= 32; row++) {
    const cell = worksheet.getCell(`K${row}`);
    if (cell.value === 'Description') cell.value = null;
  }
};

/** Build the complete non-editable Proposal unit display from approved data. */
export function buildProposalUnitCells(schema: IProjectSchema): Record<string, string | number> {
  const cells: Record<string, string | number> = {};

  for (const [unitId, unit] of Object.entries(schema.units ?? {})) {
    if (!/^[A-J]$/.test(unitId) || !unit) continue;

    const row = 23 + unitId.charCodeAt(0) - 'A'.charCodeAt(0);
    const citation = unit.extracted_citation as unknown;
    const citationFileName =
      typeof citation === 'string'
        ? citation
        : citation && typeof citation === 'object' && 'pdf_name' in citation
          ? String((citation as { pdf_name?: unknown }).pdf_name ?? '')
          : '';
    const drawingNumber = (citationFileName || unit.value_drawing_number || (unit as unknown as Record<string, unknown>)['value_drawing_no']) as string | null | undefined;
    const width = unit.value_width_in;
    const length = unit.value_length_in;

    if (!hasRealUnitData(unit)) continue;

    cells[`B${row}`] = unitId;
    // Always written, blank when unknown: the template's own C/E cells are
    // formulas onto the Pricing Worksheet take-off, which evaluate to 0 for a
    // missing drawing/location and printed "0" in the proposal.
    cells[`C${row}`] = drawingNumber || '';
    cells[`E${row}`] = unit.value_location || '';
    if (width !== null && width !== undefined) cells[`F${row}`] = width;
    if (length !== null && length !== undefined) cells[`H${row}`] = length;
    if (width !== null && width !== undefined && length !== null && length !== undefined) {
      cells[`G${row}`] = 'x';
    }
    // Written here rather than left to the stage_6_proposal.cells pass so it
    // still lands when the template's J cell is formula-backed (that pass
    // skips those) and so the unit's current description — AI Stage 5 or the
    // estimator's Edit Draft wording — always wins over a stale cell.
    const description = resolveUnitDescription(schema, unitId);
    if (description) cells[`J${row}`] = description;
  }

  return cells;
}

/**
 * Dynamically detects the starting row for Unit A in the Take Off Sheet.
 * In canonical production templates, Unit A is row 115.
 * In some fixtures or older templates, Unit A may be row 113.
 */
export const findTakeoffStartRow = (worksheet: ExcelJS.Worksheet): number => {
  // Canonical production template: Unit A is on row 115 (table header on row 114)
  if (String(worksheet.getCell('D115').value ?? '').trim().toUpperCase() === 'A') {
    return 115;
  }
  // Fixture template fallback where Unit A is on row 113 and row 114 is not 'Unit'
  if (
    String(worksheet.getCell('D113').value ?? '').trim().toUpperCase() === 'A' &&
    String(worksheet.getCell('D114').value ?? '').trim().toUpperCase() !== 'UNIT'
  ) {
    return 113;
  }
  for (let r = 110; r <= 130; r++) {
    if (String(worksheet.getCell(`D${r}`).value ?? '').trim().toUpperCase() === 'A') {
      return r;
    }
  }
  return 115;
};

/**
 * Hides the unit-grid rows (Proposal sheet 23-32, Pricing Worksheet take-off
 * 115-124) for units A-J that have no real take-off data. The template ships
 * hardcoded placeholder unit letters/formulas for all 10 slots regardless of
 * how many units a project actually has, so without this the Proposal sheet
 * shows phantom rows for units that were never populated.
 */
export function hideEmptyUnitRows(
  proposalSheet: ExcelJS.Worksheet | undefined,
  pricingSheet: ExcelJS.Worksheet | undefined,
  schema: IProjectSchema,
): void {
  const takeoffStartRow = pricingSheet
    ? findTakeoffStartRow(pricingSheet)
    : 115;

  for (let i = 0; i < 10; i++) {
    const unitId = String.fromCharCode('A'.charCodeAt(0) + i);
    if (hasRealUnitData(schema.units?.[unitId])) continue;

    if (proposalSheet) {
      const row = proposalSheet.getRow(23 + i);
      row.hidden = true;
    }
    if (pricingSheet) {
      const takeoffRow = takeoffStartRow + i;
      pricingSheet.getRow(takeoffRow).hidden = true;
    }
  }
}

// The three glazing "Glass Make-up" blocks are static boilerplate baked
// directly into the Proposal sheet template — B35-B40 (no IGU / PVB
// interlayer, no air spacer), B42-B51 (10mm air spacer, DG Structural
// interlayer), and B53-B62 ("Series 2000", 20mm air spacer). Only one
// applies to a given quote; the template ships all three unconditionally,
// so without this every proposal shows all three makeups at once regardless
// of what was actually quoted.
type GlazingBlockKey = 'GLASS_NO_IGU' | 'GLASS_WITH_IGU' | 'GLASS_2_0';
const GLAZING_BLOCK_ROWS: Record<GlazingBlockKey, [number, number]> = {
  GLASS_NO_IGU: [35, 40],
  GLASS_WITH_IGU: [42, 51],
  GLASS_2_0: [53, 62],
};

/**
 * Any Series 2000 frame (frame_type starting with SERIES_2000, e.g.
 * SERIES_2000_PEDESTAL/RECESSED/WITH_PLATE/NON_WALKABLE) always uses the
 * Series 2000 glazing block regardless of glass_type — confirmed against a
 * real quote (182 Robinson Street) where frame_type=SERIES_2000_PEDESTAL but
 * glass_type=GLASS_WITH_IGU, and the Series 2000 (20mm air spacer) block is
 * the one that actually applies. For every other frame, glass_type's
 * NO_IGU/WITH_IGU distinction is the correct signal. If neither field maps
 * to a known block, all three are left untouched — fail open rather than guess.
 *
 * Multi-unit: per-unit value_frame_type/value_glass_type win over the global
 * decision when present. When real units resolve to different blocks, null is
 * returned so all blocks stay visible instead of stamping one unit's makeup
 * onto the whole quote.
 */
const blockForUnit = (frameType: unknown, glassType: unknown): GlazingBlockKey | null => {
  if (typeof frameType === 'string' && frameType.startsWith('SERIES_2000')) {
    return 'GLASS_2_0';
  }
  if (typeof glassType === 'string' && (glassType as string) in GLAZING_BLOCK_ROWS) {
    return glassType as GlazingBlockKey;
  }
  return null;
};

const resolveGlazingBlock = (schema: IProjectSchema): GlazingBlockKey | null => {
  const realUnits = Object.values(schema.units ?? {}).filter(hasRealUnitData);
  const perUnitBlocks = realUnits.map((unit) =>
    blockForUnit(unit.value_frame_type, unit.value_glass_type),
  ).filter((block): block is GlazingBlockKey => block !== null);
  if (perUnitBlocks.length > 0) {
    return new Set(perUnitBlocks).size === 1 ? perUnitBlocks[0]! : null;
  }
  return blockForUnit(
    schema.stage_3?.decision?.frame_type?.value,
    schema.stage_2?.glass_type?.value,
  );
};

/** Keeps only the glazing "Glass Make-up" block that applies to this quote and clears + hides the other two. */
export function applySelectedGlazingBlock(
  proposalSheet: ExcelJS.Worksheet | undefined,
  schema: IProjectSchema,
): void {
  if (!proposalSheet) return;

  const selected = resolveGlazingBlock(schema);
  if (!selected) return;

  for (const [key, [startRow, endRow]] of Object.entries(GLAZING_BLOCK_ROWS)) {
    if (key === selected) continue;
    for (let row = startRow; row <= endRow; row++) {
      const sheetRow = proposalSheet.getRow(row);
      sheetRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.value = null;
      });
      sheetRow.hidden = true;
    }
  }
}

// The per-unit "Optional Add-ons" sections (Seeded Organic anti-slip texture,
// NanoDot anti-slip texture, Heat Soak Testing) each list a row per unit
// A-J, same as the main unit grid, but hideEmptyUnitRows never reaches these
// — they sit much further down the Proposal sheet. Their row numbers are NOT
// stable across template revisions — a "Frame/Options" block was inserted
// above them at some point, shifting every base row down by 5 (confirmed
// against a real project's live template vs. an older reference export) —
// so the section header text is located dynamically rather than assuming a
// fixed offset, mirroring how the frontend locates the unit grid by its own
// "Unit" header cell instead of a hardcoded row/column.
const ADDON_SECTION_HEADER_PATTERNS = [/seeded organic/i, /nanodot/i, /heat soak testing/i];

export const findAddonSectionUnitRowBases = (proposalSheet: ExcelJS.Worksheet): number[] => {
  const bases: number[] = [];
  for (const pattern of ADDON_SECTION_HEADER_PATTERNS) {
    let headerRow = -1;
    proposalSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (headerRow !== -1) return;
      const label = row.getCell('B').value;
      const text = typeof label === 'string' ? label : '';
      if (pattern.test(text)) headerRow = rowNumber;
    });
    if (headerRow !== -1) bases.push(headerRow + 1);
  }
  return bases;
};

/**
 * Clears + hides the addon-section unit rows for units A-J that have no real
 * take-off data. Values are cleared (not just hidden) so that clients which
 * parse the raw workbook cells directly — e.g. the frontend's in-app
 * read-only preview, which does not honor Excel's row-hidden attribute —
 * don't still show the phantom "Unit B/$0/Initial here..." placeholder rows.
 *
 * `addonSectionBases` must be resolved via findAddonSectionUnitRowBases
 * BEFORE schema.stage_6_proposal.cells is written onto this sheet — those
 * cell addresses come from an earlier generation and can misalign once the
 * template's row layout shifts, silently overwriting a section header (e.g.
 * "Add - NanoDot...") with unrelated leftover data, which would make a
 * lookup performed after that point fail to find the section at all.
 */
export function hideEmptyAddonUnitRows(
  proposalSheet: ExcelJS.Worksheet | undefined,
  schema: IProjectSchema,
  addonSectionBases: number[],
): void {
  if (!proposalSheet) return;

  for (let i = 0; i < 10; i++) {
    const unitId = String.fromCharCode('A'.charCodeAt(0) + i);
    if (hasRealUnitData(schema.units?.[unitId])) continue;

    for (const base of addonSectionBases) {
      const row = proposalSheet.getRow(base + i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.value = null;
      });
      row.hidden = true;
    }
  }
}

const ONES_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

/** Spells out small integers (0-20) the way the proposal boilerplate does, e.g. "fourteen (14)". */
const spellOutCount = (n: number): string => {
  const word = Number.isInteger(n) && n >= 0 && n < ONES_WORDS.length ? ONES_WORDS[n] : String(n);
  return `${word} (${n})`;
};

/**
 * Formats a decimal inch measurement as a mixed-number fraction matching the
 * proposal boilerplate's convention (e.g. 88.333... -> `88-1/3"`,
 * 216.75 -> `216-3/4"`). Falls back to a 2-decimal display if no simple
 * fraction (denominators up to 32) is a close enough match.
 */
export function formatInchesAsFraction(value: number): string {
  const whole = Math.trunc(value);
  const frac = Math.abs(value - whole);

  if (frac < 1e-6) return `${whole}"`;

  const denominators = [2, 3, 4, 6, 8, 12, 16, 32];
  const tolerance = 0.01;
  let best: { num: number; den: number; error: number } | null = null;

  for (const den of denominators) {
    const num = Math.round(frac * den);
    if (num === 0 || num === den) continue;
    const error = Math.abs(frac - num / den);
    if (error <= tolerance && (!best || error < best.error)) {
      const divisor = gcd(num, den);
      best = { num: num / divisor, den: den / divisor, error };
    }
  }

  if (!best) return `${value.toFixed(2)}"`;
  return whole > 0 ? `${whole}-${best.num}/${best.den}"` : `${best.num}/${best.den}"`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Auto-builds the Proposal sheet's B14 intro paragraph from the template's
 * "Proposal Descriptions" reference sheet, keyed by stage_3.decision.proposal_number
 * (1-15, matching that sheet's rows 4-18 1:1), with the paragraph's (X) quantity,
 * XX" x XX" dimension, and glass-panel-count placeholders substituted from the
 * approved unit data. Placeholders this schema has no backing data for (e.g. the
 * Deck template's railing linear footage) are intentionally left as-is rather
 * than guessed.
 */
export function buildProposalIntroParagraph(
  workbook: ExcelJS.Workbook,
  schema: IProjectSchema,
): string | null {
  const proposalNumber = schema.stage_3?.decision?.proposal_number?.value;
  if (proposalNumber == null || !Number.isInteger(proposalNumber)) return null;

  const descriptionsSheet = workbook.getWorksheet('Proposal Descriptions');
  if (!descriptionsSheet) return null;

  const templateRow = proposalNumber + 3;
  const rawCell = descriptionsSheet.getCell(`B${templateRow}`).value;
  const template = typeof rawCell === 'string' ? rawCell : null;
  if (!template) return null;

  const realUnits = Object.values(schema.units ?? {}).filter(hasRealUnitData);
  if (realUnits.length === 0) return template;

  let result = template;

  const totalQty = realUnits.reduce((sum, unit) => sum + (unit.value_num_units ?? 1), 0);
  result = result.replace(/\(X\)/, `(${totalQty} Qty.)`);

  const primaryUnit = realUnits[0]!;
  const distinctDims = new Set(
    realUnits
      .filter((unit) => unit.value_width_in != null && unit.value_length_in != null)
      .map((unit) => `${unit.value_width_in}x${unit.value_length_in}`),
  );
  if (distinctDims.size > 1) {
    // Mixed-unit quote: Unit A's dims would misdescribe the other units.
    result = result.replace(/XX["']?\s*x\s*XX["']?/i, 'various sizes');
  } else if (primaryUnit.value_width_in != null && primaryUnit.value_length_in != null) {
    const dims = `${formatInchesAsFraction(primaryUnit.value_width_in)} x ${formatInchesAsFraction(primaryUnit.value_length_in)}`;
    result = result.replace(/XX["']?\s*x\s*XX["']?/i, dims);
  }

  const totalPanels = realUnits.reduce((sum, unit) => sum + (unit.value_panel_count ?? 0), 0);
  if (totalPanels > 0) {
    result = result.replace(/\(?\bxx\)?\s+(?=(?:equally sized\s+)?(?:walkable\s+)?glass panels)/i, `${spellOutCount(totalPanels)} `);
  }

  return result;
}

const isFormulaBackedCell = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  return 'formula' in value || 'sharedFormula' in value;
};

const stampResolvedSummaryResult = (
  worksheet: ExcelJS.Worksheet,
  address: string,
  result: number,
): void => {
  const cell = worksheet.getCell(address);
  const current = cell.value;
  if (current && typeof current === 'object' && 'formula' in current) {
    cell.value = { ...(current as unknown as Record<string, unknown>), result } as any;
    return;
  }
  cell.value = result;
};

function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuotes) {
      current += ch;
      if (ch === quoteChar) inQuotes = false;
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) args.push(current.trim());
  return args;
}

export function wrapFormulaWithRound(formula: string): string {
  const trimmed = formula.trim().replace(/^=/, '');
  if (trimmed.toLowerCase().startsWith('round(')) {
    return trimmed;
  }
  const ifMatch = /^IF\((.*)\)$/is.exec(trimmed);
  if (ifMatch && ifMatch[1]) {
    const args = splitTopLevelArgs(ifMatch[1]);
    if (args.length === 3) {
      const [cond, thenExpr, elseExpr] = args;
      if (thenExpr && elseExpr) {
        if (thenExpr.toLowerCase().startsWith('round(')) {
          return `IF(${cond}, ${thenExpr}, ${elseExpr})`;
        }
        return `IF(${cond}, ROUND(${thenExpr}, 2), ${elseExpr})`;
      }
    }
  }
  return `ROUND(${trimmed}, 2)`;
}

export function wrapCellFormulaWithRound(cell: ExcelJS.Cell): void {
  const val = cell.value;
  if (!val || typeof val !== 'object' || !('formula' in val)) {
    return;
  }
  const rawFormula = String((val as { formula: string }).formula).trim();
  if (!rawFormula) return;
  const wrapped = wrapFormulaWithRound(rawFormula);
  cell.value = { ...(val as unknown as Record<string, unknown>), formula: wrapped } as any;
}

const applyResolvedSummaryResults = (
  worksheet: ExcelJS.Worksheet,
  schema: IProjectSchema,
  calculation?: FinalParameterCalculation,
): void => {
  if (!calculation) return;
  const sqftRow = findLabelRow(worksheet, 'Total Sq. Footage of job') ?? 98;
  stampResolvedSummaryResult(worksheet, `C${sqftRow}`, calculation.metrics.totalSqft);
  const totalWeight = Number(schema.stage_5?.calculated?.total_weight?.value);
  if (Number.isFinite(totalWeight)) {
    const weightRow = findLabelRow(worksheet, 'Total weight of all units') ?? (sqftRow + 7);
    stampResolvedSummaryResult(worksheet, `C${weightRow}`, totalWeight);
  }
};

export function findRowByLabelPattern(
  sheet: ExcelJS.Worksheet,
  pattern: RegExp,
  minRow = 8,
  maxRow = 115,
): number | null {
  for (let r = minRow; r <= maxRow && r <= sheet.rowCount; r++) {
    const val = sheet.getCell(`B${r}`).value;
    if (typeof val === 'string' && pattern.test(val.trim())) {
      return r;
    }
  }
  return null;
}

export const GLASS_TYPE_DEFINITIONS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'GLASS_NO_IGU', pattern: /Glass.*no IGU/i },
  { key: 'GLASS_WITH_IGU', pattern: /Glass.*with IGU/i },
  { key: 'GLASS_2_0', pattern: /Glass 2\.0/i },
  { key: 'STAIR_TREAD', pattern: /Stair/i },
  { key: 'NON_WALKABLE', pattern: /Non-Walkable/i },
  { key: 'EGR', pattern: /\bEGR\b/i },
];

export const FRAME_TYPE_DEFINITIONS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'SERIES_1000_PEDESTAL', pattern: /Series 1000 Pedestal/i },
  { key: 'SERIES_1000_RECESSED', pattern: /Series 1000 Recessed/i },
  { key: 'PERIMETER_NON_TB', pattern: /Perimeter non/i },
  { key: 'SERIES_2000_PEDESTAL', pattern: /Series 2000 Pedestal/i },
  { key: 'SERIES_2000_RECESSED', pattern: /Series 2000 Recessed/i },
  { key: 'SERIES_2000_WITH_PLATE', pattern: /Series 2000 with plate/i },
  { key: 'SERIES_2000_NON_WALKABLE', pattern: /Series 2000 non-walkable/i },
  { key: 'SERIES_3000', pattern: /Series 3000/i },
  { key: 'DECK_PERIMETER', pattern: /Deck perimeter/i },
  { key: 'ECONOFRAME', pattern: /Econoframe.*lengths/i },
  { key: 'ROUND_FRAME_42', pattern: /Round Frame 42/i },
  { key: 'HORIZONTAL_CAP_SERIES_1000', pattern: /Horizontal cap/i },
  { key: 'VERTICAL_CAP_SERIES_1000', pattern: /Vertical cap/i },
];

export const CROSSBEAM_DEFINITIONS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'SERIES_1000_T_SECTION_TB', pattern: /Series 1000 T.*thermally broken/i },
  { key: 'SERIES_1000_I_BEAM_TB', pattern: /Series 1000 I.*thermally broken/i },
  { key: 'SERIES_1000_T_SECTION', pattern: /Series 1000 T.*Section(?!\s*thermally)/i },
  { key: 'SERIES_1000_I_BEAM', pattern: /Series 1000 I.*Beam(?!\s*thermally)/i },
  { key: 'SERIES_2000_T_SECTION_TB', pattern: /Series 2000 T section/i },
  { key: 'SERIES_2000_I_BEAM_TB', pattern: /Series 2000 I beam/i },
  { key: 'ECONOFRAME_2_5', pattern: /Econoframe 2\.5/i },
  { key: 'ECONOFRAME_3_0', pattern: /Econoframe 3/i },
];

export const OPTION_DEFINITIONS: Array<{ addonKey: string; pattern: RegExp }> = [
  { addonKey: 'sentry_glass', pattern: /Sentry Glass/i },
  { addonKey: 'krypton_gas', pattern: /Krypton Gas/i },
  { addonKey: 'backpaint', pattern: /Backpaint/i },
  { addonKey: 'custom_shape', pattern: /^Custom$/i },
];

export const OPTIONAL_ADDON_DEFINITIONS: Array<{ cellKey: string; addonKey: string; pattern: RegExp }> = [
  { cellKey: 'C107', addonKey: 'seeded_organic', pattern: /Seeded Organic/i },
  { cellKey: 'C109', addonKey: 'heat_soak_testing', pattern: /Heat Soak/i },
  { cellKey: 'C110', addonKey: 'nanodot', pattern: /Nano Dot|NanoDot/i },
];

export function applyPricingWorksheetSelections(
  sheet: ExcelJS.Worksheet,
  schema: IProjectSchema,
  _calculation?: FinalParameterCalculation,
): void {
  const activeUnitKeys = Object.keys(schema.units ?? {}).filter(
    (k) => /^[A-J]$/i.test(k) && hasRealUnitData(schema.units?.[k])
  );
  const effectiveActiveUnitKeys = activeUnitKeys.length > 0 ? activeUnitKeys : ['A'];

  const glassRowByKey = new Map<string, number>();
  for (const item of GLASS_TYPE_DEFINITIONS) {
    const r = findRowByLabelPattern(sheet, item.pattern, 8, 15);
    if (r) glassRowByKey.set(item.key, r);
  }

  const frameRowByKey = new Map<string, number>();
  for (const item of FRAME_TYPE_DEFINITIONS) {
    const r = findRowByLabelPattern(sheet, item.pattern, 35, 52);
    if (r) frameRowByKey.set(item.key, r);
  }

  const crossbeamRowByKey = new Map<string, number>();
  for (const item of CROSSBEAM_DEFINITIONS) {
    const r = findRowByLabelPattern(sheet, item.pattern, 50, 62);
    if (r) crossbeamRowByKey.set(item.key, r);
  }

  const optionRowByKey = new Map<string, number>();
  for (const item of OPTION_DEFINITIONS) {
    const r = findRowByLabelPattern(sheet, item.pattern, 15, 25);
    if (r) optionRowByKey.set(item.addonKey, r);
  }

  const optionalAddonRowByKey = new Map<string, number>();
  for (const item of OPTIONAL_ADDON_DEFINITIONS) {
    const r = findRowByLabelPattern(sheet, item.pattern, 95, 112);
    if (r) optionalAddonRowByKey.set(item.cellKey, r);
  }

  const optionalStatuses = getOptionalAddOnStatuses(schema);

  for (const unitKey of effectiveActiveUnitKeys) {
    const idx = unitKey.toUpperCase().charCodeAt(0) - 65;
    if (idx < 0 || idx >= UNIT_SELECTION_COLUMNS.length) continue;
    const col = UNIT_SELECTION_COLUMNS[idx]!;
    const products = resolveUnitProducts(schema, unitKey);

    // 1. Glass Type (a unit with no glass anywhere keeps the template default)
    const targetGlassKey = products.glass ?? matchGlassTypeKey(null);
    for (const [key, row] of glassRowByKey) {
      sheet.getCell(`${col}${row}`).value = (key === targetGlassKey) ? 'y' : null;
    }

    // 2. Frame Type
    const targetFrameKey = products.frame ?? matchFrameTypeKey(null);
    for (const [key, row] of frameRowByKey) {
      sheet.getCell(`${col}${row}`).value = (key === targetFrameKey) ? 'y' : null;
    }

    // 3. Cross Beam
    const targetCrossbeamKey = products.crossbeam;
    for (const [key, row] of crossbeamRowByKey) {
      sheet.getCell(`${col}${row}`).value = (targetCrossbeamKey && key === targetCrossbeamKey) ? 'y' : null;
    }

    // 4. Options
    for (const [addonKey, row] of optionRowByKey) {
      const addonVal = (schema.stage_5?.addons as any)?.[addonKey];
      const isSelected = addonVal === 'y' || addonVal === 'Y' || addonVal === true;
      sheet.getCell(`${col}${row}`).value = isSelected ? 'y' : null;
    }

    // 5. Duty (typically row 85..95)
    const dutyRow = findRowByLabelPattern(sheet, /^Duty$/i, 80, 95);
    if (dutyRow) {
      const dutyRaw = (schema.stage_5?.addons as any)?.duty;
      const dutyVal = dutyRaw?.value ?? dutyRaw;   // handles object or plain string
      const isDuty = String(dutyVal).toLowerCase() === 'y' || dutyVal === true;
      const dutyFormula = String((sheet.getCell(`F${dutyRow}`).value as any)?.formula ?? '');
      const triggerChar = dutyFormula.includes('"Y"') ? 'Y' : 'y';
      sheet.getCell(`D${dutyRow}`).value = isDuty ? triggerChar : null;
    }

    // 5. Optional Add-ons (Add Alternates)
    for (const [cellKey, row] of optionalAddonRowByKey) {
      const status = optionalStatuses[cellKey as OptionalAddOnCell];
      const isAccepted = status === 'ACCEPTED';
      const formulaVal = sheet.getCell(`E${row}`).value;
      const formulaStr = typeof formulaVal === 'object' && formulaVal && 'formula' in formulaVal
        ? String((formulaVal as { formula: string }).formula)
        : '';
      const triggerChar = formulaStr.includes('"Y"') ? 'Y' : 'y';
      sheet.getCell(`${col}${row}`).value = isAccepted ? triggerChar : null;
    }
  }
}

/**
 * Enforces 2-decimal rounding (`ROUND(..., 2)`) across all takeoff metrics,
 * unit price line items, and compounding percentage adjustments in the
 * Pricing Worksheet. Preserves the template's existing formula graph by
 * wrapping cell formulas in-place rather than hardcoding static row numbers.
 */
export function applyWorksheetPrecisionFormulas(
  sheet: ExcelJS.Worksheet,
  schema?: IProjectSchema,
): void {
  const finalPriceRow = findLabelRow(sheet, 'FINAL PRICE') ?? 95;
  const takeoffStartRow = findTakeoffStartRow(sheet);
  const takeoffEndRow = takeoffStartRow + 9;
  const takeoffTotalsRow = takeoffStartRow + 10;

  // 1. Takeoff Rows: SqFt (H), Perimeter LF (I), and Crossbeam length (N)
  for (let r = takeoffStartRow; r <= takeoffEndRow; r++) {
    const hCell = sheet.getCell(`H${r}`);
    if (isFormulaBackedCell(hCell.value)) {
      wrapCellFormulaWithRound(hCell);
    } else {
      hCell.value = { formula: `ROUND(SUM(E${r}*F${r})/144, 2)` } as any;
    }

    const iCell = sheet.getCell(`I${r}`);
    if (isFormulaBackedCell(iCell.value)) {
      wrapCellFormulaWithRound(iCell);
    } else {
      iCell.value = { formula: `ROUND(SUM((E${r}*2)+(F${r}*2))/12, 2)` } as any;
    }

    const nCell = sheet.getCell(`N${r}`);
    if (isFormulaBackedCell(nCell.value)) {
      wrapCellFormulaWithRound(nCell);
    } else {
      nCell.value = { formula: `ROUND((K${r}*E${r})+(L${r}*F${r}), 2)` } as any;
    }
  }

  // Row totals for takeoff
  const totH = sheet.getCell(`H${takeoffTotalsRow}`);
  if (isFormulaBackedCell(totH.value)) {
    wrapCellFormulaWithRound(totH);
  } else {
    totH.value = { formula: `ROUND(SUM(H${takeoffStartRow}:H${takeoffEndRow}), 2)` } as any;
  }

  const totI = sheet.getCell(`I${takeoffTotalsRow}`);
  if (isFormulaBackedCell(totI.value)) {
    wrapCellFormulaWithRound(totI);
  } else {
    totI.value = { formula: `ROUND(SUM(I${takeoffStartRow}:I${takeoffEndRow}), 2)` } as any;
  }

  const totN = sheet.getCell(`N${takeoffTotalsRow}`);
  if (isFormulaBackedCell(totN.value)) {
    wrapCellFormulaWithRound(totN);
  } else {
    totN.value = { formula: `ROUND(SUM(N${takeoffStartRow}:N${takeoffEndRow}), 2)` } as any;
  }

  // 2. Wrap all formula cells in amount columns (F, I, L, O, R, U, X, AA, AD, AG) up to takeoffStartRow
  for (const col of UNIT_AMOUNT_COLUMNS) {
    for (let r = 9; r < takeoffStartRow; r++) {
      wrapCellFormulaWithRound(sheet.getCell(`${col}${r}`));
    }
  }

  // 3. Wrap quantity derivation formulas in quantity columns (E, H, K, N, Q, T, W, Z, AC, AF) up to takeoffStartRow
  for (const col of UNIT_QUANTITY_COLUMNS) {
    for (let r = 9; r < takeoffStartRow; r++) {
      wrapCellFormulaWithRound(sheet.getCell(`${col}${r}`));
    }
  }

  // 4. Wrap row totals across units in Column AH up to takeoffStartRow
  for (let r = 9; r < takeoffStartRow; r++) {
    wrapCellFormulaWithRound(sheet.getCell(`AH${r}`));
  }

  // 5. Multiplied Unit Total on finalPriceRow (only when value_num_units > 1)
  if (schema?.units) {
    for (let idx = 0; idx < UNIT_AMOUNT_COLUMNS.length; idx++) {
      const col = UNIT_AMOUNT_COLUMNS[idx]!;
      const qtyCol = UNIT_QUANTITY_COLUMNS[idx]!;
      const unitLetter = String.fromCharCode(65 + idx);
      const unit = schema.units[unitLetter];
      const numUnits = unit?.value_num_units ?? 1;
      const takeoffRow = takeoffStartRow + idx;

      if (numUnits > 1) {
        sheet.getCell(`${qtyCol}${finalPriceRow}`).value = {
          formula: `IF($J$${takeoffRow}>1, ROUND(${col}${finalPriceRow}*$J$${takeoffRow}, 2), "")`,
        } as any;
      }
    }
  }
}

/**
 * Protects against Excel #DIV/0! errors on Cost/sqft and Glass/panel rows
 * when a unit has zero dimensions or is unpopulated. Also zeroes out inactive unit
 * prices and totals so phantom template numbers do not corrupt workbook sums.
 */
const sanitizeUnitFormulasAndInactiveUnits = (
  sheet: ExcelJS.Worksheet,
  schema: IProjectSchema,
): void => {
  const activeUnitKeys = new Set(
    Object.entries(schema.units ?? {})
      .filter(([_, unit]) => unit && hasRealUnitData(unit))
      .map(([id]) => id.toUpperCase()),
  );

  const finalPriceRow = findLabelRow(sheet, 'FINAL PRICE') ?? 95;
  const totalRow = findLabelRow(sheet, 'TOTAL') ?? (finalPriceRow - 3);
  const costPerSqftRow = findLabelRow(sheet, 'Unit Cost - $ per Sq. Ft') ?? (finalPriceRow + 1);
  const glassWeightRow = findLabelRow(sheet, 'Each Glass Panel - lbs.') ?? (costPerSqftRow + 5);
  const takeoffStartRow = findTakeoffStartRow(sheet);

  for (let i = 0; i < 10; i++) {
    const unitLetter = String.fromCharCode(65 + i);
    const takeoffRow = takeoffStartRow + i;
    const priceCol = UNIT_AMOUNT_COLUMNS[i]!;
    const glassWeightCol = UNIT_QUANTITY_COLUMNS[i]!;
    const isActive = activeUnitKeys.has(unitLetter);

    if (!isActive) {
      // Inactive unit: clear line items, prices and unit totals to prevent phantom quantities and #DIV/0!
      // Line items run through row 110 (Nano Dot). Rows 111-114 are 'Total of adds' and Take Off Sheet headers;
      // they MUST NEVER be wiped by unit clearing.
      const selCol = UNIT_SELECTION_COLUMNS[i]!;
      const qtyCol = UNIT_QUANTITY_COLUMNS[i]!;
      const maxPricingLineRow = Math.min(110, takeoffStartRow - 1);
      for (let r = 9; r <= maxPricingLineRow; r++) {
        sheet.getCell(`${selCol}${r}`).value = null;
        sheet.getCell(`${qtyCol}${r}`).value = null;
        sheet.getCell(`${priceCol}${r}`).value = null;
      }
      sheet.getCell(`${priceCol}${finalPriceRow}`).value = 0;
      sheet.getCell(`${priceCol}${costPerSqftRow}`).value = 0;
      sheet.getCell(`${priceCol}${totalRow}`).value = 0;
      sheet.getCell(`${glassWeightCol}${glassWeightRow}`).value = 0;
    } else {
      // Active unit: protect against division by zero in Cost/sqft and Glass panel lbs
      sheet.getCell(`${priceCol}${costPerSqftRow}`).value = {
        formula: `IF(H${takeoffRow}>0, ROUND(${priceCol}${finalPriceRow}/H${takeoffRow}, 2), 0)`,
      } as any;

      sheet.getCell(`${glassWeightCol}${glassWeightRow}`).value = {
        formula: `IF(G${takeoffRow}>0, ROUND(${glassWeightCol}${glassWeightRow - 1}/G${takeoffRow}, 2), 0)`,
      } as any;
    }
  }
};

/**
 * Generates a downloadable workbook without Microsoft Graph. Excel will
 * recalculate the formulas when the file is opened because calcProperties are
 * set below. This is intentionally used only as a development fallback; the
 * Graph path remains authoritative for calculated snapshots in production.
 */
export async function generateProposalExcelLocally(
  schema: IProjectSchema,
  quoteNumber: string,
  estimatorName?: string,
  calculation?: FinalParameterCalculation,
): Promise<Buffer> {
  const templateBuffer = await loadTemplateBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as any);
  (workbook as any).calcProperties = {
    calcMode: 'auto',
    fullCalcOnLoad: true,
  };

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Template does not contain any worksheets');
  }

  const takeoffStartRow = findTakeoffStartRow(sheet);
  for (const [address, value] of Object.entries(buildMergedCells(schema, calculation))) {
    if (value === null || value === undefined || PRICING_SHEET_SKIP_CELLS.has(address)) continue;
    if (takeoffStartRow === 115 && /^[A-Z]+(111|112|113|114)$/.test(address)) continue;
    sheet.getCell(address).value = toExcelCellValue(value) as any;
  }

  if (takeoffStartRow === 115) {
    // Clear any numbers or formulas that may have corrupted row 113 headers in older passes
    for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'M', 'N', 'O']) {
      const c = sheet.getCell(`${col}113`);
      if (typeof c.value === 'number' || (c.value && typeof c.value === 'object' && ('formula' in c.value || 'result' in c.value))) {
        c.value = null;
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    const unitLetter = String.fromCharCode(65 + i);
    const unit = schema.units?.[unitLetter];
    if (!unit || !hasRealUnitData(unit)) continue;
    const r = takeoffStartRow + i;
    if (unit.value_width_in != null) sheet.getCell(`E${r}`).value = unit.value_width_in;
    if (unit.value_length_in != null) sheet.getCell(`F${r}`).value = unit.value_length_in;
    if (unit.value_panel_count != null) sheet.getCell(`G${r}`).value = unit.value_panel_count;
    if (unit.value_num_units != null) sheet.getCell(`J${r}`).value = unit.value_num_units;
    const vertRafters = unit.value_vertical_rafter_count ?? schema.stage_6?.cells?.[`K${r}`] ?? (unit.value_panel_count && unit.value_panel_count > 1 ? unit.value_panel_count - 1 : null);
    if (vertRafters != null) sheet.getCell(`K${r}`).value = vertRafters;
    const horizRafters = unit.value_horizontal_rafter_count ?? schema.stage_6?.cells?.[`L${r}`] ?? null;
    if (horizRafters != null) sheet.getCell(`L${r}`).value = horizRafters;
  }

  applyResolvedSummaryResults(sheet, schema, calculation);
  applyPricingWorksheetSelections(sheet, schema, calculation);
  applyWorksheetPrecisionFormulas(sheet, schema);
  sanitizeUnitFormulasAndInactiveUnits(sheet, schema);
  sheet.getCell('I2').value = quoteNumber;
  const personQuoting = schema.stage_1?.person_quoting?.value || estimatorName;
  if (personQuoting) {
    sheet.getCell('L2').value = personQuoting;
  }
  const phoneCell = sheet.getCell('I3');
  phoneCell.alignment = { ...(phoneCell.alignment ?? {}), wrapText: true, vertical: 'top' };

  if (schema.stage_6_proposal?.cells) {
    const proposalSheet = workbook.getWorksheet(schema.stage_6_proposal.target_sheet);
    if (proposalSheet) {
      // Locate the addon-section header rows before any cell writes below can
      // clobber their label text with stale schema.stage_6_proposal.cells
      // entries (a real failure mode: those addresses are captured by an
      // earlier generation and can misalign once the template's row layout
      // shifts, silently overwriting a section header like "Add - NanoDot..."
      // with unrelated leftover data).
      const addonSectionBases = findAddonSectionUnitRowBases(proposalSheet);
      // The addon section header rows ("Add - Seeded Organic...",
      // "Add - NanoDot...", "Heat Soak Testing") are static template
      // content, one row above each base, at a row position that shifts
      // between template revisions — block the generic schema.cells write
      // loop below from touching ANY column of that row, same as
      // PROPOSAL_SHEET_SKIP_CELLS does for the header block, so a stale
      // AI/schema cell captured under an old template's row numbering can
      // never clobber it.
      clearDescriptionPlaceholders(proposalSheet);
      for (const [address, value] of Object.entries(schema.stage_6_proposal.cells)) {
        if (
          value === null ||
          value === undefined ||
          PROPOSAL_SHEET_SKIP_CELLS.has(address) ||
          isAddonSectionRowAddress(address, addonSectionBases) ||
          isDescriptionPlaceholder(address, value) ||
          isFormulaBackedCell(proposalSheet.getCell(address).value)
        ) {
          continue;
        }
        proposalSheet.getCell(address).value = toExcelCellValue(value) as any;
      }

      // Proposal unit display values come from the approved schema, not formula
      // cache results. Description cells remain estimator-editable.
      for (const [address, value] of Object.entries(buildProposalUnitCells(schema))) {
        proposalSheet.getCell(address).value = toExcelCellValue(value) as any;
      }

      const userSuppliedDescription = schema.stage_6_proposal.cells['B14'];
      const hasUserSuppliedDescription =
        userSuppliedDescription !== null && userSuppliedDescription !== undefined && userSuppliedDescription !== '';
      const introParagraph = buildProposalIntroParagraph(workbook, schema);
      if (
        !hasUserSuppliedDescription &&
        introParagraph &&
        !isFormulaBackedCell(proposalSheet.getCell('B14').value)
      ) {
        proposalSheet.getCell('B14').value = introParagraph;
      }

      hideEmptyUnitRows(proposalSheet, sheet, schema);
      applySelectedGlazingBlock(proposalSheet, schema);
      hideEmptyAddonUnitRows(proposalSheet, schema, addonSectionBases);
    }
  }

  const localBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return bakeComputedProposalValues(localBuffer, schema.stage_6_proposal?.target_sheet || 'Proposal', calculation?.finalPrice);
}

export async function generateProposalExcelWithFallback(
  schema: IProjectSchema,
  quoteNumber: string,
  estimatorName?: string,
  calculation?: FinalParameterCalculation,
): Promise<{ buffer: Buffer; calculatedByGraph: boolean }> {
  if (!isExcelGraphConfigured()) {
    if (env.app.nodeEnv === 'production') {
      assertExcelGraphConfigured();
    }

    console.warn('[Graph Generator] Excel Graph credentials are missing; using local workbook fallback.');
    return {
      buffer: await generateProposalExcelLocally(schema, quoteNumber, estimatorName, calculation),
      calculatedByGraph: false,
    };
  }

  try {
    return {
      buffer: await generateProposalExcel(schema, quoteNumber, estimatorName, calculation),
      calculatedByGraph: true,
    };
  } catch (error) {
    if (env.app.nodeEnv === 'production') throw error;

    console.warn(
      '[Graph Generator] Excel Graph generation failed in development; using local workbook fallback:',
      error instanceof Error ? error.message : error,
    );
    return {
      buffer: await generateProposalExcelLocally(schema, quoteNumber, estimatorName, calculation),
      calculatedByGraph: false,
    };
  }
}

export async function generateProposalExcel(
  schema: IProjectSchema,
  quoteNumber: string,
  estimatorName?: string,
  calculation?: FinalParameterCalculation,
): Promise<Buffer> {
  const templateBuffer = await loadTemplateBuffer();
  const projectId = (schema as any)._id?.toString() || 'unknown';
  
  // Fetch the token dynamically
const token = await getGraphToken();
  const tempFileName = `gfs-temp-proposal-${projectId}-${Date.now()}.xlsx`;
  
  console.log(`[Graph Generator] Step 1/6: Applying ${Object.keys(schema.stage_6?.cells || {}).length} cell updates locally via ExcelJS...`);
  
  // PRE-FILL CELLS LOCALLY TO AVOID SLOW GRAPH API BATCH UPDATES
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as any);
  (workbook as any).calcProperties = {
    calcMode: 'auto',
    fullCalcOnLoad: true,
  };


  // Two DIFFERENT cells on two DIFFERENT sheets, which happen to share an
  // address string — a single shared SKIP_CELLS was the actual bug, not the
  // cell reference itself:
  //
  //   Pricing Worksheet!I2  — the real Quote # VALUE cell (label is in H2,
  //     same pairing as H3 "Contact phone" -> I3 value). This was previously
  //     completely unguarded, so the AI's (currently wrong) value landed
  //     here freely.
  //
  //
  // Net effect once I2 is stamped below: Proposal!K2's formula picks up the
  // correct value automatically on the next Graph "calculate" pass — no
  // direct write to Proposal!K2 is needed or wanted.
  const sheet = workbook.worksheets[0]; // Pricing Worksheet
  if (sheet) {
    const takeoffStartRow = findTakeoffStartRow(sheet);
    const mergedCells = buildMergedCells(schema, calculation);

    for (const [address, value] of Object.entries(mergedCells)) {
      if (PRICING_SHEET_SKIP_CELLS.has(address)) continue;
      if (takeoffStartRow === 115 && /^[A-Z]+(111|112|113|114)$/.test(address)) continue;
      if (value !== null && value !== undefined) {
        const cell = sheet.getCell(address);
        cell.value = toExcelCellValue(value) as any;
      }
    }

    if (takeoffStartRow === 115) {
      // Clear any numbers or formulas that may have corrupted row 113 headers in older passes
      for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'M', 'N', 'O']) {
        const c = sheet.getCell(`${col}113`);
        if (typeof c.value === 'number' || (c.value && typeof c.value === 'object' && ('formula' in c.value || 'result' in c.value))) {
          c.value = null;
        }
      }
    }
    for (let i = 0; i < 10; i++) {
      const unitLetter = String.fromCharCode(65 + i);
      const unit = schema.units?.[unitLetter];
      if (!unit || !hasRealUnitData(unit)) continue;
      const r = takeoffStartRow + i;
      if (unit.value_width_in != null) sheet.getCell(`E${r}`).value = unit.value_width_in;
      if (unit.value_length_in != null) sheet.getCell(`F${r}`).value = unit.value_length_in;
      if (unit.value_panel_count != null) sheet.getCell(`G${r}`).value = unit.value_panel_count;
      if (unit.value_num_units != null) sheet.getCell(`J${r}`).value = unit.value_num_units;
      const vertRafters = unit.value_vertical_rafter_count ?? schema.stage_6?.cells?.[`K${r}`] ?? (unit.value_panel_count && unit.value_panel_count > 1 ? unit.value_panel_count - 1 : null);
      if (vertRafters != null) sheet.getCell(`K${r}`).value = vertRafters;
      const horizRafters = unit.value_horizontal_rafter_count ?? schema.stage_6?.cells?.[`L${r}`] ?? null;
      if (horizRafters != null) sheet.getCell(`L${r}`).value = horizRafters;
    }

    applyResolvedSummaryResults(sheet, schema, calculation);
    applyPricingWorksheetSelections(sheet, schema, calculation);
    applyWorksheetPrecisionFormulas(sheet, schema);
    sanitizeUnitFormulasAndInactiveUnits(sheet, schema);

    // Authoritative write: always stamp the convention-computed quote number,
    // regardless of anything the AI sent for I2. This is intentionally the
    // LAST write to this sheet before serialization so nothing above can
    // clobber it.
    console.log('calling generateProposalExcel with quoteNumber:', quoteNumber, typeof quoteNumber);
    sheet.getCell('I2').value = quoteNumber;
    const personQuoting = schema.stage_1?.person_quoting?.value || estimatorName;
    if (personQuoting) {
      sheet.getCell('L2').value = personQuoting;
    }
    const phoneCell = sheet.getCell('I3');
    phoneCell.alignment = { ...(phoneCell.alignment ?? {}), wrapText: true, vertical: 'top' };
  }

  // Write the Proposal sheet, keyed by whatever sheet name the AI reports
  // as its target. This never touches the Pricing Worksheet cells above —
  // it's a second, independent write pass into a different tab of the
  // same workbook, so both sheets get calculated together in the single
  // Graph pass below.
  if (schema.stage_6_proposal?.cells) {
    const proposalSheet = workbook.getWorksheet(schema.stage_6_proposal.target_sheet);
    if (!proposalSheet) {
      console.warn(
        `[Graph Generator] Sheet "${schema.stage_6_proposal.target_sheet}" not found in template — skipping proposal cell writes.`
      );
    } else {
      // See the matching comment in generateProposalExcelLocally: locate the
      // addon-section header rows before any cell writes below can clobber
      // their label text with stale schema.stage_6_proposal.cells entries.
      const addonSectionBases = findAddonSectionUnitRowBases(proposalSheet);
      clearDescriptionPlaceholders(proposalSheet);
      let writtenCount = 0;
      let skippedFormulaCount = 0;
      for (const [address, value] of Object.entries(schema.stage_6_proposal.cells)) {

        if (PROPOSAL_SHEET_SKIP_CELLS.has(address)) continue;
        if (isAddonSectionRowAddress(address, addonSectionBases)) continue;

        if (value === null || value === undefined) continue;
        if (isDescriptionPlaceholder(address, value)) continue;

        // Preserve formula-backed non-unit Proposal fields. Unit display cells
        // are written from the approved schema below so downloads and browser
        // previews do not depend on formula cache results.
        const current = proposalSheet.getCell(address).value;
        const isFormulaBacked =
          !!current &&
          typeof current === 'object' &&
          ('formula' in current || 'sharedFormula' in current);
        if (isFormulaBacked) {
          skippedFormulaCount++;
          continue;
        }

        const cell = proposalSheet.getCell(address);
        cell.value = toExcelCellValue(value) as any;
        writtenCount++;
      }
      for (const [address, value] of Object.entries(buildProposalUnitCells(schema))) {
        proposalSheet.getCell(address).value = toExcelCellValue(value) as any;
        writtenCount++;
      }

      const userSuppliedDescription = schema.stage_6_proposal.cells['B14'];
      const hasUserSuppliedDescription =
        userSuppliedDescription !== null && userSuppliedDescription !== undefined && userSuppliedDescription !== '';
      const introParagraph = buildProposalIntroParagraph(workbook, schema);
      if (
        !hasUserSuppliedDescription &&
        introParagraph &&
        !isFormulaBackedCell(proposalSheet.getCell('B14').value)
      ) {
        proposalSheet.getCell('B14').value = introParagraph;
        writtenCount++;
      }

      hideEmptyUnitRows(proposalSheet, sheet, schema);
      applySelectedGlazingBlock(proposalSheet, schema);
      hideEmptyAddonUnitRows(proposalSheet, schema, addonSectionBases);

      console.log(
        `[Graph Generator] Applied ${writtenCount} cell updates to "${schema.stage_6_proposal.target_sheet}" sheet.` +
          (skippedFormulaCount
            ? ` Skipped ${skippedFormulaCount} formula-backed cell(s) to preserve template links.`
            : '')
      );
    }
  }

  const rawPrefilled = await workbook.xlsx.writeBuffer();
  const prefilledBuffer = Buffer.isBuffer(rawPrefilled) ? rawPrefilled : Buffer.from(rawPrefilled);

  console.log(`[Graph Generator] Step 2/6: Uploading pre-filled Excel template to Microsoft Graph: ${tempFileName}...`);
  const userRoot = graphUserRoot();
  const uploadUrl = `${userRoot}/drive/root:/${tempFileName}:/content`;

  let uploadRes;
  try {
    uploadRes = await axios.put(uploadUrl, prefilledBuffer, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    });
  } catch (err: any) {
    const status = err.response?.status;
    const headers = err.response?.headers;
    const data = err.response?.data;
    const reqId = headers ? (headers['client-request-id'] || headers['request-id']) : 'unknown';
    
    console.error(`[Graph API Error] Upload failed with status ${status}`);
    console.error(`[Graph API Error] Request ID: ${reqId}`);
    console.error(`[Graph API Error] Details:`, JSON.stringify(data, null, 2));
    
    throw new Error(`Graph API Upload Error [${status}]: ${JSON.stringify(data)}. RequestID: ${reqId}. Verify token roles and drive existence.`);
  }

  const driveItemId = uploadRes.data.id;
  let sessionId = '';
  
  try {
    // 1.5 Create Workbook Session to prevent throttling
    console.log(`[Graph Generator] Step 2/6: Creating Workbook Session for item ${driveItemId}...`);
    const sessionRes = await axios.post(`${userRoot}/drive/items/${driveItemId}/workbook/createSession`,
      { persistChanges: true },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    sessionId = sessionRes.data.id;

    try {
      // We skip manual Graph API batch updates because ExcelJS pre-filled the workbook!
      console.log(`[Graph Generator] Step 3/6: Forcing Microsoft Graph to calculate formulas...`);
      await axios.post(`${userRoot}/drive/items/${driveItemId}/workbook/application/calculate`,
        { calculationType: 'full' }, 
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'workbook-session-id': sessionId
          }
        }
      );
      console.log(`[Graph Generator] Graph API calculation triggered successfully.`);
    } finally {
      if (sessionId) {
        console.log(`[Graph Generator] Step 4/6: Closing workbook session to flush calculated changes & release lock...`);
        try {
          await axios.post(`${userRoot}/drive/items/${driveItemId}/workbook/closeSession`, {}, {
            headers: {
              Authorization: `Bearer ${token}`,
              'workbook-session-id': sessionId
            }
          });
          
          console.log(`[Graph Generator] Workbook session closed successfully.`);
        } catch (err) {
          console.error('[Graph Generator] Failed to close workbook session:', err);
        }
      }
    }

    // 4. Download computed workbook with fast retry if locked
    console.log(`[Graph Generator] Step 5/6: Downloading computed workbook from Microsoft Graph...`);
    let downloadRes;
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        downloadRes = await axios.get(`${userRoot}/drive/items/${driveItemId}/content`, {
          headers: {
            Authorization: `Bearer ${token}`
          },
          responseType: 'arraybuffer'
        });
        break;
      } catch (downloadErr: any) {
        const status = downloadErr?.response?.status;
        if ((status === 423 || status === 409 || status === 429) && attempt < maxRetries) {
          const delay = attempt * 200;
          console.warn(`[Graph Generator] Download attempt ${attempt} returned status ${status}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw downloadErr;
        }
      }
    }

    if (!downloadRes) {
      throw new Error(`Failed to download calculated workbook from Microsoft Graph for item ${driveItemId}`);
    }

    const graphBuffer = Buffer.from(downloadRes.data);
    return await bakeComputedProposalValues(graphBuffer, schema.stage_6_proposal?.target_sheet || 'Proposal', calculation?.finalPrice);
  } finally {
    // 5. Cleanup temp file
    console.log(`[Graph Generator] Step 6/6: Cleaning up temp file ${driveItemId} from Microsoft Graph...`);
    try {
      await axios.delete(`${userRoot}/drive/items/${driveItemId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch (err) {
      console.error('Failed to cleanup temp file from OneDrive', err);
    }
  }
}

// Mirrors the frontend's PROPOSAL_HEADER_FIELDS (Proposal.tsx) — the
// Proposal sheet's own header block, each cell a plain formula pointing at
// a literal value on 'Pricing Worksheet'.
const PROPOSAL_HEADER_ADDRESSES = ['K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11'];

// The "Base Pricing" table's per-unit $ column (J80 = Unit A ... J89 = Unit
// J) plus its Total (J90 = SUM(J80:J89)).
const BASE_PRICING_ADDRESSES = [
  ...Array.from({ length: 10 }, (_, i) => `J${80 + i}`),
  'J90',
];

const SINGLE_CROSS_SHEET_REF = /^'?([^'!]+)'?!(\$?[A-Z]+\$?\d+)$/;
const SAME_SHEET_SUM_RANGE = /^SUM\((\$?)([A-Z]+)(\$?)(\d+):\$?[A-Z]+\$?(\d+)\)$/i;
const CROSS_SHEET_REF_GLOBAL = /'([^']+)'!(\$?[A-Z]+\$?\d+)/g;
const SAFE_ARITHMETIC_EXPRESSION = /^[\d+\-*/(). ]+$/;

/**
 * Resolves a formula cell to a plain value without any Excel calculation
 * engine — Microsoft Graph's `workbook/application/calculate` endpoint was
 * tried here first and confirmed, against a real project (182 Robinson
 * Street), to NOT reliably populate cross-sheet references even after a
 * successful "full" recalculation call (self-contained formulas like
 * TODAY() got a cached result; `'Pricing Worksheet'!C2` did not), so instead
 * of depending on that, walk the already-loaded workbook directly:
 *
 * 1. Cached result already present -> use it.
 * 2. Formula is nothing but a single cross-sheet cell reference (the K2-K11
 *    header block) -> follow it and return whatever that cell holds
 *    (string/number/date), recursively in case the target is itself such a
 *    reference.
 * 3. Formula is `SUM(range)` over a same-sheet range (the Base Pricing
 *    Total) -> resolve each cell in the range (recursively) and sum them.
 * 4. Formula is an arithmetic expression mixing one or more cross-sheet
 *    references (Base Pricing's per-unit `'Pricing Worksheet'!F95*'Pricing
 *    Worksheet'!J115`) -> substitute each reference with its resolved
 *    numeric value and evaluate the resulting expression.
 * 5. Anything else -> return the formula unchanged (same-sheet formulas we
 *    don't specifically handle don't break when other sheets are removed).
 */
export function resolveFormulaCellValue(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  value: unknown,
  depth = 0,
): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as any;
  if (!('formula' in v) && !('sharedFormula' in v)) return value;
  if ('result' in v && v.result !== undefined && v.result !== null) return v.result;
  if (depth >= 8) return null;

  const formula = typeof v.formula === 'string' ? v.formula.trim() : null;
  if (!formula) return null;

  const singleRef = SINGLE_CROSS_SHEET_REF.exec(formula);
  if (singleRef) {
    const [, refSheetName, refAddress] = singleRef;
    const refSheet = workbook.getWorksheet(refSheetName!);
    if (!refSheet) return null;
    const refCellValue = refSheet.getCell(refAddress!.replace(/\$/g, '')).value;
    return resolveFormulaCellValue(workbook, refSheet, refCellValue, depth + 1) ?? refCellValue ?? null;
  }

  const sumMatch = SAME_SHEET_SUM_RANGE.exec(formula);
  if (sumMatch) {
    const [, , col, , startRowStr, endRowStr] = sumMatch;
    const startRow = Number(startRowStr);
    const endRow = Number(endRowStr);
    let sum = 0;
    for (let r = startRow; r <= endRow; r++) {
      const resolved = resolveFormulaCellValue(workbook, sheet, sheet.getCell(`${col}${r}`).value, depth + 1);
      if (typeof resolved === 'number') sum += resolved;
    }
    return sum;
  }

  let sawCrossSheetRef = false;
  let unresolved = false;
  const substituted = formula.replace(CROSS_SHEET_REF_GLOBAL, (_match: string, refSheetName: string, refAddress: string) => {
    sawCrossSheetRef = true;
    const refSheet = workbook.getWorksheet(refSheetName);
    if (!refSheet) {
      unresolved = true;
      return '0';
    }
    const refValue = resolveFormulaCellValue(
      workbook,
      refSheet,
      refSheet.getCell(refAddress.replace(/\$/g, '')).value,
      depth + 1,
    );
    if (typeof refValue !== 'number') {
      unresolved = true;
      return '0';
    }
    return String(refValue);
  });

  if (!sawCrossSheetRef) return value; // pure same-sheet formula — safe to leave untouched

  // We KNOW this formula points at another sheet, which is about to be
  // deleted — it can never be left in place even if we can't fully resolve
  // it (e.g. a per-unit rate formula for an empty unit that is itself
  // unresolvable). Confirmed against a real workbook: a formula referencing
  // a since-deleted sheet makes Microsoft Graph's PDF export outright
  // reject the file (406 OfficeConversion_ContentNotSupported) rather than
  // just rendering it blank, so this must fall back to null, never `value`.
  if (unresolved || !SAFE_ARITHMETIC_EXPRESSION.test(substituted)) {
    return null;
  }

  try {
    // eslint-disable-next-line no-new-func
    const evaluated = Function(`"use strict"; return (${substituted});`)();
    return typeof evaluated === 'number' && Number.isFinite(evaluated) ? evaluated : null;
  } catch {
    return null;
  }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Locates a sheet's XML part inside a raw xlsx ZIP via workbook.xml + its
 * relationships, by sheet NAME (not index — index/order can't be trusted
 * once other sheets have been added/removed).
 */
function findSheetXmlPath(zip: AdmZip, sheetName: string): string {
  const workbookXml = zip.getEntry('xl/workbook.xml')?.getData().toString('utf-8');
  if (!workbookXml) throw new Error('xl/workbook.xml not found in workbook');
  const sheetTag = new RegExp(`<sheet[^>]*name="${escapeRegExp(sheetName)}"[^>]*/>`).exec(workbookXml)?.[0];
  if (!sheetTag) throw new Error(`Sheet "${sheetName}" not found in workbook.xml`);
  const rid = /r:id="([^"]+)"/.exec(sheetTag)?.[1];
  if (!rid) throw new Error(`Sheet "${sheetName}" has no r:id in workbook.xml`);
  const relsXml = zip.getEntry('xl/_rels/workbook.xml.rels')?.getData().toString('utf-8');
  if (!relsXml) throw new Error('xl/_rels/workbook.xml.rels not found');
  const target = new RegExp(`Id="${escapeRegExp(rid)}"[^>]*Target="([^"]+)"`).exec(relsXml)?.[1];
  if (!target) throw new Error(`Relationship target for sheet "${sheetName}" not found`);
  return `xl/${target}`;
}

/** Extracts one `<c r="ADDRESS" ...>...</c>` (or self-closing) element from raw sheet XML. */
function extractCellXml(
  sheetXml: string,
  address: string,
): { full: string; index: number; attrs: string; inner: string | null } | null {
  const re = new RegExp(`<c r="${escapeRegExp(address)}"([^>]*?)(?:/>|>([\\s\\S]*?)<\\/c>)`);
  const match = re.exec(sheetXml);
  if (!match) return null;
  return { full: match[0], index: match.index, attrs: match[1]!, inner: match[2] ?? null };
}

const XML_ENTITIES: Record<string, string> = { apos: "'", quot: '"', amp: '&', lt: '<', gt: '>' };
const decodeXmlEntities = (s: string): string => s.replace(/&(apos|quot|amp|lt|gt);/g, (_m, name) => XML_ENTITIES[name]!);

/** Reads a cell's `<f>...</f>` formula text (decoded) directly from raw sheet XML, or null if it has none. */
function extractRawFormula(sheetXml: string, address: string): string | null {
  const cell = extractCellXml(sheetXml, address);
  if (!cell?.inner) return null;
  const fMatch = /<f[^>]*>([\s\S]*?)<\/f>/.exec(cell.inner);
  return fMatch ? decodeXmlEntities(fMatch[1]!) : null;
}

/**
 * Strips a cell's `<f>...</f>` formula element in the raw sheet XML while
 * keeping its already-cached `<v>` value and style untouched — a no-op if
 * the cell has no formula (e.g. an addon row cleared for a unit with no
 * real data). Fallback for when a fresh HyperFormula-computed value isn't
 * available (see computeFreshCrossSheetValues below).
 */
export function stripFormulaKeepingCachedValue(sheetXml: string, address: string): string {
  const cell = extractCellXml(sheetXml, address);
  if (!cell?.inner) return sheetXml;
  const strippedInner = cell.inner.replace(/<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/, '');
  if (strippedInner === cell.inner) return sheetXml;
  const replacement = `<c r="${address}"${cell.attrs}>${strippedInner}</c>`;
  return sheetXml.slice(0, cell.index) + replacement + sheetXml.slice(cell.index + cell.full.length);
}

/** Replaces a cell with a plain literal number, dropping any formula entirely. */
function setCellLiteralValue(sheetXml: string, address: string, value: number): string {
  const cell = extractCellXml(sheetXml, address);
  if (!cell) return sheetXml;
  const replacement = `<c r="${address}"${cell.attrs}><v>${value}</v></c>`;
  return sheetXml.slice(0, cell.index) + replacement + sheetXml.slice(cell.index + cell.full.length);
}

/**
 * Updates (or adds) a cell's cached `<v>` result while leaving its `<f>`
 * formula tag untouched — a no-op if the cell has no formula at all. Unlike
 * setCellLiteralValue/stripFormulaKeepingCachedValue (which the disposable
 * PDF-export path uses, since it deletes the sheets those formulas point
 * at), this is for the CANONICAL persisted workbook: the live formula must
 * stay so real Excel/Sheets keep recalculating it normally — only the
 * cached value non-Excel readers (the in-app preview) see needs fixing.
 */
export function setCachedValueKeepingFormula(sheetXml: string, address: string, value: number): string {
  const cell = extractCellXml(sheetXml, address);
  if (!cell?.inner) return sheetXml;
  const formulaMatch = /<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/.exec(cell.inner);
  if (!formulaMatch) return sheetXml;
  const newInner = /<v>[\s\S]*?<\/v>/.test(cell.inner)
    ? cell.inner.replace(/<v>[\s\S]*?<\/v>/, `<v>${value}</v>`)
    : cell.inner.replace(formulaMatch[0], `${formulaMatch[0]}<v>${value}</v>`);
  const replacement = `<c r="${address}"${cell.attrs}>${newInner}</c>`;
  return sheetXml.slice(0, cell.index) + replacement + sheetXml.slice(cell.index + cell.full.length);
}

const escapeXmlText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * String twin of setCachedValueKeepingFormula: rewrites a formula cell's cached
 * `<v>` as text (t="str") while keeping its `<f>` — including a shared-formula
 * clone's `<f t="shared" si=".."/>`, which ExcelJS cannot write safely.
 * No-op for a cell without a formula.
 */
export function setCachedStringKeepingFormula(sheetXml: string, address: string, value: string): string {
  const cell = extractCellXml(sheetXml, address);
  if (!cell?.inner) return sheetXml;
  const formulaMatch = /<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/.exec(cell.inner);
  if (!formulaMatch) return sheetXml;
  const attrs = / t="[^"]*"/.test(cell.attrs) ? cell.attrs.replace(/ t="[^"]*"/, ' t="str"') : `${cell.attrs} t="str"`;
  const replacement = `<c r="${address}"${attrs}>${formulaMatch[0]}<v>${escapeXmlText(value)}</v></c>`;
  return sheetXml.slice(0, cell.index) + replacement + sheetXml.slice(cell.index + cell.full.length);
}

function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function parseCellAddress(address: string): { col: number; row: number } {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(address);
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  return { col: columnLetterToIndex(match[1]!), row: Number(match[2]) - 1 };
}

function indexToColumnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Shifts every non-absolute ($-free) column/row reference in a formula by the given deltas. */
export function shiftFormulaReferences(formula: string, rowDelta: number, colDelta: number): string {
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/g, (_m, colAbs, col, rowAbs, row) => {
    const newCol = colAbs ? col : indexToColumnLetter(columnLetterToIndex(col) + colDelta);
    const newRow = rowAbs ? row : String(Number(row) + rowDelta);
    return `${colAbs}${newCol}${rowAbs}${newRow}`;
  });
}

/**
 * Reconstructs the effective formula text for a cell, expanding an Excel
 * "shared formula" clone (`{ sharedFormula: 'masterAddress' }`, no formula
 * text of its own) by shifting the master's formula relative to the
 * distance between the two cells — ExcelJS's own getter does NOT do this
 * expansion for every clone (confirmed: some clones come back with a full,
 * if occasionally wrong, reconstructed formula; others come back as a bare
 * `{ sharedFormula: 'F109' }` with nothing else), so this must be done
 * explicitly before formulas are handed to HyperFormula.
 */
export function resolveEffectiveFormula(sheet: ExcelJS.Worksheet, address: string, cellValue: any): string | null {
  if (typeof cellValue?.formula === 'string') return cellValue.formula;
  const masterAddress = typeof cellValue?.sharedFormula === 'string' ? cellValue.sharedFormula : null;
  if (!masterAddress) return null;
  const masterValue = sheet.getCell(masterAddress).value as any;
  if (typeof masterValue?.formula !== 'string') return null;
  const clone = parseCellAddress(address);
  const master = parseCellAddress(masterAddress);
  return shiftFormulaReferences(masterValue.formula, clone.row - master.row, clone.col - master.col);
}

const SHEET_REF_NAMES = /'([^']+)'!|\b([A-Za-z_][A-Za-z0-9_.]*)!/g;

/** Every sheet name a formula references ('Quoted Name'!A1 or Plain!A1). */
const referencedSheetNames = (formula: string): string[] =>
  [...formula.matchAll(SHEET_REF_NAMES)].map((m) => (m[1] ?? m[2])!).filter(Boolean);

/**
 * Freshly evaluates cells with HyperFormula, loading the sheets they live on
 * plus every sheet those sheets' formulas reference (transitively — the
 * Pricing Worksheet pulls glass and weight rates from 'Bonnell - Glass
 * Pricing' / 'Weights - Descriptions'). Used where the workbook's own cached
 * results cannot be trusted: Graph's calculate does not reliably refresh them
 * and the local path never calculates, so they can still hold the
 * template's sample numbers. Grids are trimmed to each sheet's used range —
 * sheets report 1000 rows, and loading those empty grids for all 13 template
 * sheets took ~2 minutes versus ~70ms for the three that matter.
 * Keys are `${sheet}!${address}`; non-numeric results are omitted.
 */
function computeFreshWorkbookValues(
  helperWorkbook: ExcelJS.Workbook,
  refs: Array<{ sheet: string; address: string }>,
): Record<string, number> {
  if (refs.length === 0) return {};

  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  const queue = [...new Set(refs.map((ref) => ref.sheet))];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (name in sheets) continue;
    const sheet = helperWorkbook.getWorksheet(name);
    if (!sheet) continue;

    let lastRow = 0;
    let lastCol = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        lastRow = Math.max(lastRow, rowNumber);
        lastCol = Math.max(lastCol, colNumber);
      });
    });

    const data: (string | number | boolean | null)[][] = [];
    for (let r = 1; r <= lastRow; r++) {
      const row: (string | number | boolean | null)[] = [];
      for (let c = 1; c <= lastCol; c++) {
        const cell = sheet.getCell(r, c);
        const cellValue = cell.value as any;
        if (cellValue && typeof cellValue === 'object' && ('formula' in cellValue || 'sharedFormula' in cellValue)) {
          const formula = resolveEffectiveFormula(sheet, cell.address, cellValue);
          row.push(formula ? `=${formula}` : null);
          if (formula) for (const refName of referencedSheetNames(formula)) queue.push(refName);
        } else if (cellValue && typeof cellValue === 'object' && Array.isArray(cellValue.richText)) {
          row.push(cellValue.richText.map((run: any) => run?.text ?? '').join(''));
        } else if (cellValue instanceof Date) {
          row.push(null);
        } else if (typeof cellValue === 'number' || typeof cellValue === 'string' || typeof cellValue === 'boolean') {
          row.push(cellValue);
        } else {
          row.push(null);
        }
      }
      data.push(row);
    }
    sheets[name] = data;
  }

  const results: Record<string, number> = {};
  let hf: ReturnType<typeof HyperFormula.buildFromSheets> | undefined;
  try {
    hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
    for (const ref of refs) {
      const sheetId = hf.getSheetId(ref.sheet);
      if (sheetId === undefined) continue;
      const { col, row } = parseCellAddress(ref.address);
      const value = hf.getCellValue({ sheet: sheetId, row, col });
      if (typeof value === 'number' && Number.isFinite(value)) results[`${ref.sheet}!${ref.address}`] = value;
    }
  } catch (err) {
    console.error('[Graph Generator] HyperFormula workbook evaluation failed:', err);
  } finally {
    hf?.destroy();
  }
  return results;
}

/**
 * Fresh Base Pricing amounts (Proposal J80:J89 = 'Pricing Worksheet'!F95 *
 * 'Pricing Worksheet'!J115, ...; J90 = their sum). The cached F95/I95/L95...
 * results in the file are the template's sample prices (417.89 in every unit
 * column) whenever nothing recalculated them, so every unit printed the same
 * amount. Returns only addresses it could evaluate.
 */
function computeFreshBasePricing(
  workbook: ExcelJS.Workbook,
  proposalSheet: ExcelJS.Worksheet,
): Record<string, number> {
  const formulas: Record<string, string> = {};
  const refs: Array<{ sheet: string; address: string }> = [];
  for (let row = 80; row <= 89; row++) {
    const value = proposalSheet.getCell(`J${row}`).value as any;
    const formula = value && typeof value === 'object' && typeof value.formula === 'string' ? value.formula.trim() : null;
    if (!formula) continue;
    formulas[`J${row}`] = formula;
    for (const match of formula.matchAll(CROSS_SHEET_REF_GLOBAL)) {
      refs.push({ sheet: match[1]!, address: match[2]!.replace(/\$/g, '') });
    }
  }

  const fresh = computeFreshWorkbookValues(workbook, refs);
  const amounts: Record<string, number> = {};
  for (const [address, formula] of Object.entries(formulas)) {
    let unresolved = false;
    const substituted = formula.replace(CROSS_SHEET_REF_GLOBAL, (_m: string, sheet: string, ref: string) => {
      const key = `${sheet}!${ref.replace(/\$/g, '')}`;
      if (!(key in fresh)) {
        unresolved = true;
        return '0';
      }
      return `(${fresh[key]})`;
    });
    if (unresolved || !SAFE_ARITHMETIC_EXPRESSION.test(substituted)) continue;
    try {
      // eslint-disable-next-line no-new-func
      const evaluated = Function(`"use strict"; return (${substituted});`)();
      if (typeof evaluated === 'number' && Number.isFinite(evaluated)) {
        amounts[address] = Math.round(evaluated * 100) / 100;
      }
    } catch {
      // leave this row's cached value alone
    }
  }
  if (Object.keys(amounts).length > 0) {
    amounts['J90'] = Math.round(Object.values(amounts).reduce((sum, amount) => sum + amount, 0) * 100) / 100;
  }
  return amounts;
}

// Beyond this the workbook and the backend genuinely disagree about the
// price (not just rounding) and must not be papered over.
const BASE_PRICING_RECONCILE_TOLERANCE = 0.01;

/**
 * Makes the Base Pricing units add up to the approved Final Parameters price.
 *
 * The Pricing Worksheet rounds every line per unit (sqft to 2dp per unit,
 * then each line and each percentage row per unit), while the backend
 * calculator — whose total is what the estimator approves and what is
 * stored as the project's price — works on project totals. On multi-unit
 * jobs the two drift by a few dollars (e.g. 73.77 vs 73.78 sqft at $134.31,
 * compounded through overhead/profit/insurance/duty), so the PDF total
 * disagreed with the Grand Total on screen. The workbook's per-unit amounts
 * are kept as the split; they are scaled to the approved total and the
 * rounding remainder goes to the largest unit so the cents add up exactly.
 */
export function reconcileBasePricing(
  amounts: Record<string, number>,
  approvedFinalPrice: number | undefined,
): Record<string, number> {
  const unitAddresses = Object.keys(amounts).filter((address) => address !== 'J90' && amounts[address]! > 0);
  const workbookTotal = unitAddresses.reduce((sum, address) => sum + amounts[address]!, 0);
  if (
    approvedFinalPrice === undefined ||
    !Number.isFinite(approvedFinalPrice) ||
    approvedFinalPrice <= 0 ||
    workbookTotal <= 0
  ) {
    return amounts;
  }
  const drift = Math.abs(approvedFinalPrice - workbookTotal) / approvedFinalPrice;
  if (drift < 1e-9) return amounts;
  if (drift > BASE_PRICING_RECONCILE_TOLERANCE) {
    console.warn(
      `[Graph Generator] Base Pricing total ${workbookTotal.toFixed(2)} differs from the approved final price ` +
        `${approvedFinalPrice.toFixed(2)} by more than ${BASE_PRICING_RECONCILE_TOLERANCE * 100}% — leaving the ` +
        'workbook amounts as-is instead of masking a real pricing difference.',
    );
    return amounts;
  }

  const reconciled: Record<string, number> = { ...amounts };
  const targetCents = Math.round(approvedFinalPrice * 100);
  let allocatedCents = 0;
  for (const address of unitAddresses) {
    const cents = Math.round((amounts[address]! / workbookTotal) * targetCents);
    reconciled[address] = cents / 100;
    allocatedCents += cents;
  }
  const largest = unitAddresses.reduce((a, b) => (amounts[a]! >= amounts[b]! ? a : b));
  reconciled[largest] = (Math.round(reconciled[largest]! * 100) + (targetCents - allocatedCents)) / 100;
  reconciled['J90'] = targetCents / 100;
  return reconciled;
}

/**
 * Computes the TRUE, current value for each of `addresses` that holds a
 * simple single-cell cross-sheet reference (the shape of Proposal's addon
 * $ cells, e.g. `'Pricing Worksheet'!F107`), using HyperFormula to actually
 * evaluate the referenced sheet locally rather than trusting whatever's
 * cached in the file.
 *
 * This exists because the persisted xlsx's cached values for these cells
 * are frequently stale: confirmed against a real project (182 Robinson
 * Street) where the addon was switched from not-selected to selected, and
 * even the newest regeneration's cached value stayed at 0 — while opening
 * the same file in a real spreadsheet app (which always recalculates on
 * open) correctly showed the non-zero price. Microsoft Graph's
 * `workbook/application/calculate` endpoint doesn't reliably fix this
 * either (same unreliability already documented for the header cells), so
 * this bypasses both the file's cache and Graph's calculate entirely.
 */
async function computeFreshCrossSheetValues(
  xlsxBuffer: Buffer,
  sourceSheetName: string,
  addresses: string[],
): Promise<Record<string, number>> {
  const zip = new AdmZip(xlsxBuffer);
  const sourceSheetXml = zip.getEntry(findSheetXmlPath(zip, sourceSheetName))!.getData().toString('utf-8');

  const targets: Record<string, { sheet: string; address: string }> = {};
  for (const address of addresses) {
    const formula = extractRawFormula(sourceSheetXml, address);
    const match = formula ? SINGLE_CROSS_SHEET_REF.exec(formula) : null;
    if (match) targets[address] = { sheet: match[1]!, address: match[2]!.replace(/\$/g, '') };
  }
  if (Object.keys(targets).length === 0) return {};

  // Throwaway workbook, used purely to feed HyperFormula raw values/formulas
  // — never written back, so any ExcelJS quirks on read can't leak into
  // whatever gets uploaded to Graph.
  const helperWorkbook = new ExcelJS.Workbook();
  await helperWorkbook.xlsx.load(xlsxBuffer as any);

  const results: Record<string, number> = {};
  for (const refSheetName of [...new Set(Object.values(targets).map((t) => t.sheet))]) {
    const sheet = helperWorkbook.getWorksheet(refSheetName);
    if (!sheet) continue;

    const data: (string | number | null)[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row: (string | number | null)[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cellValue = sheet.getCell(r, c).value as any;
        if (cellValue && typeof cellValue === 'object') {
          const address = `${indexToColumnLetter(c - 1)}${r}`;
          const effectiveFormula = resolveEffectiveFormula(sheet, address, cellValue);
          row.push(effectiveFormula ? `=${effectiveFormula}` : null);
        } else if (typeof cellValue === 'number' || typeof cellValue === 'string') {
          row.push(cellValue);
        } else {
          row.push(null);
        }
      }
      data.push(row);
    }

    let hf: ReturnType<typeof HyperFormula.buildFromArray> | undefined;
    try {
      hf = HyperFormula.buildFromArray(data, { licenseKey: 'gpl-v3' });
      for (const [address, target] of Object.entries(targets)) {
        if (target.sheet !== refSheetName) continue;
        const { col, row } = parseCellAddress(target.address);
        const value = hf.getCellValue({ sheet: 0, row, col });
        if (typeof value === 'number' && Number.isFinite(value)) {
          results[address] = value;
        }
      }
    } catch (err) {
      console.error(`[Graph Generator] HyperFormula evaluation failed for sheet "${refSheetName}":`, err);
    } finally {
      hf?.destroy();
    }
  }

  return results;
}

/**
 * De-formula-izes the addon sections' per-unit $ columns (Seeded
 * Organic/NanoDot/Heat Soak Testing) directly in the raw xlsx ZIP, for the
 * reasons documented on stripFormulaKeepingCachedValue above. Operates on
 * the fully-trimmed buffer (single sheet, header/base-pricing already
 * resolved) right before it's uploaded for PDF conversion. Uses a freshly
 * HyperFormula-computed value where available, falling back to whatever
 * was cached in the file otherwise.
 */
export async function fixAddonFormulasInRawXml(
  originalXlsxBuffer: Buffer,
  trimmedBuffer: Buffer,
  sheetName: string,
  addonSectionBases: number[],
): Promise<Buffer> {
  const addresses = addonSectionBases.flatMap((base) => Array.from({ length: 10 }, (_, i) => `E${base + i}`));
  const freshValues = await computeFreshCrossSheetValues(originalXlsxBuffer, sheetName, addresses);

  const zip = new AdmZip(trimmedBuffer);
  const sheetPath = findSheetXmlPath(zip, sheetName);
  let sheetXml = zip.getEntry(sheetPath)!.getData().toString('utf-8');

  for (const address of addresses) {
    sheetXml = address in freshValues
      ? setCellLiteralValue(sheetXml, address, freshValues[address]!)
      : stripFormulaKeepingCachedValue(sheetXml, address);
  }

  zip.updateFile(sheetPath, Buffer.from(sheetXml, 'utf-8'));
  return zip.toBuffer();
}

/**
 * Bakes freshly-computed values into the header block, Base Pricing table,
 * and addon $ cells' cached formula results on the CANONICAL persisted
 * workbook — without removing the live formulas, unlike the disposable PDF
 * path's fixAddonFormulasInRawXml/resolveFormulaCellValue calls, which can
 * safely discard formulas because those sheets get deleted right after.
 *
 * This exists because Microsoft Graph's `workbook/application/calculate`
 * step is confirmed unreliable for these specific cross-sheet formulas
 * (sometimes leaves them with no cached result at all, or a stale one), and
 * `generateProposalExcelLocally` never calls Graph in the first place — so
 * without this, any tool that reads the file without its own calculation
 * engine (the in-app "Preview" button, which parses the raw bytes
 * client-side) shows 0/blank for cells that are actually correct. Real
 * Excel/Sheets already look fine because opening a file there always
 * recalculates live, independent of whatever is cached in the bytes.
 */
export async function bakeComputedProposalValues(
  buffer: Buffer,
  sheetName: string,
  approvedFinalPrice?: number,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const proposalSheet = workbook.getWorksheet(sheetName);
  if (!proposalSheet) return buffer;

  const addonSectionBases = findAddonSectionUnitRowBases(proposalSheet);

  // Phase 1 (ExcelJS, safe): header + Base Pricing. Only cells with their
  // own plain `formula` text are touched — shared-formula clones are left
  // alone here too, for the same reason convertProposalSheetToPdf avoids
  // them (ExcelJS's own getter can fabricate a wrong reconstruction for
  // those, and any read/write through its Cell API for such a cell risks
  // corrupting the file).
  for (const address of [...PROPOSAL_HEADER_ADDRESSES, ...BASE_PRICING_ADDRESSES]) {
    const cell = proposalSheet.getCell(address);
    const value = cell.value as any;
    if (!value || typeof value !== 'object' || typeof value.formula !== 'string') continue;
    const resolved = resolveFormulaCellValue(workbook, proposalSheet, value);
    if (resolved === value || resolved === null || resolved === undefined) continue;
    cell.value = { formula: value.formula, result: resolved } as any;
  }

  // Base Pricing repeats each unit's description (D80:H80 = J23 ... ). Rows
  // 80-87 are one shared formula whose cached result is still the template's
  // "Description" — Graph's PDF export prints cached results, so it must be
  // re-cached (raw XML, phase 2). Rows 88-89 are plain "Description" text and
  // are safe to write here.
  const baseDescriptions = readBasePricingDescriptions(proposalSheet);
  for (const [address, text] of Object.entries(baseDescriptions)) {
    const cell = proposalSheet.getCell(address);
    const value = cell.value as any;
    if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) continue;
    cell.value = text || null;
  }

  // Long drawing names / locations / descriptions wrap inside narrow columns,
  // but the template rows are a fixed 1-2 lines tall, so the PDF cut them off.
  autofitWrappedRows(proposalSheet, PROPOSAL_UNIT_GRID_COLUMNS, 23, 32);
  autofitWrappedRows(proposalSheet, BASE_PRICING_COLUMNS, 80, 89, baseDescriptions);

  // Per-unit Base Pricing amounts from a fresh evaluation, overriding cached
  // results that may still be the template's sample prices. J80:J90 are
  // plain (non-shared) formulas, so ExcelJS can write them safely; the PDF
  // export resolves these cells from exactly this cached result. Reads the
  // other sheets from this same load — nothing above has modified them.
  const freshBasePricing = reconcileBasePricing(computeFreshBasePricing(workbook, proposalSheet), approvedFinalPrice);
  for (const [address, amount] of Object.entries(freshBasePricing)) {
    const cell = proposalSheet.getCell(address);
    const value = cell.value as any;
    if (!value || typeof value !== 'object' || typeof value.formula !== 'string') continue;
    cell.value = { formula: value.formula, result: amount } as any;
  }

  const phase1Buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  // Phase 2 (raw XML, avoids the ExcelJS shared-formula corruption bug):
  // the addon sections' $ column and the Base Pricing description formulas.
  const addonAddresses = addonSectionBases.flatMap((base) => Array.from({ length: 10 }, (_, i) => `E${base + i}`));
  const freshAddonValues = await computeFreshCrossSheetValues(buffer, sheetName, addonAddresses);

  const zip = new AdmZip(phase1Buffer);
  const sheetPath = findSheetXmlPath(zip, sheetName);
  let sheetXml = zip.getEntry(sheetPath)!.getData().toString('utf-8');
  for (const [address, value] of Object.entries(freshAddonValues)) {
    sheetXml = setCachedValueKeepingFormula(sheetXml, address, value);
  }
  for (const [address, text] of Object.entries(baseDescriptions)) {
    // A single space, not '': ExcelJS drops an empty cached result on the
    // next load/save (the PDF export does one), and a formula with no cached
    // value re-evaluates to 0 for units that do not exist.
    sheetXml = setCachedStringKeepingFormula(sheetXml, address, text || ' ');
  }
  zip.updateFile(sheetPath, Buffer.from(sheetXml, 'utf-8'));
  return zip.toBuffer();
}

type WrappedColumn = { columns: string[]; wrap: boolean };

// Proposal unit grid: Drawing (C), Drawing Date (D), Location (E), and the
// merged J:K Description.
const PROPOSAL_UNIT_GRID_COLUMNS: WrappedColumn[] = [
  { columns: ['C'], wrap: true },
  { columns: ['D'], wrap: true },
  { columns: ['E'], wrap: true },
  { columns: ['J', 'K'], wrap: true },
];
// Base Pricing: merged D:H description.
const BASE_PRICING_COLUMNS: WrappedColumn[] = [{ columns: ['D', 'E', 'F', 'G', 'H'], wrap: true }];

/**
 * Description text Base Pricing row 80+i should show for unit i: whatever the
 * unit grid's J{23+i} now holds (the unit's own description, written by
 * buildProposalUnitCells), or blank — never the template's "Description"
 * placeholder, which printed on every row including units that do not exist.
 */
function readBasePricingDescriptions(proposalSheet: ExcelJS.Worksheet): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < 10; i++) {
    const raw = proposalSheet.getCell(`J${23 + i}`).value;
    const text = typeof raw === 'string' ? raw.trim() : '';
    out[`D${80 + i}`] = text && text.toLowerCase() !== 'description' ? text : '';
  }
  return out;
}

const PROPOSAL_LINE_HEIGHT_PT = 12.75; // one line of the 10pt proposal font

/** Greedy word-wrap line count for `text` in a box `charsPerLine` wide. */
export function estimateWrappedLines(text: string, charsPerLine: number): number {
  const width = Math.max(1, Math.floor(charsPerLine));
  let lines = 0;
  for (const paragraph of text.split(/\r?\n/)) {
    let current = 0;
    let paragraphLines = 1;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let remaining = word.length;
      if (current > 0 && current + 1 + remaining <= width) {
        current += 1 + remaining;
        continue;
      }
      if (current > 0) paragraphLines++;
      while (remaining > width) {
        paragraphLines++;
        remaining -= width;
      }
      current = remaining;
    }
    lines += paragraphLines;
  }
  return Math.max(1, lines);
}

/**
 * Grows (never shrinks) each row's height to fit its wrapped text. Excel
 * does not auto-fit rows with wrapped text inside merged cells, and Graph's
 * PDF export honours the template's stored heights, so without this a long
 * drawing file name printed as its first two lines only.
 */
function autofitWrappedRows(
  sheet: ExcelJS.Worksheet,
  groups: WrappedColumn[],
  firstRow: number,
  lastRow: number,
  // Text for cells ExcelJS cannot read as text (shared-formula clones), keyed
  // by the group's first-column address.
  textOverrides: Record<string, string> = {},
): void {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (row.hidden) continue;
    let lines = 1;
    for (const group of groups) {
      const address = `${group.columns[0]}${rowNumber}`;
      const raw = address in textOverrides ? textOverrides[address] : sheet.getCell(address).value;
      const text = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
      if (!text.trim()) continue;
      // Column width is measured in default-font "0" characters; the 10pt
      // italic proposal font fits slightly fewer, so keep a margin.
      const width = group.columns.reduce((sum, col) => sum + (sheet.getColumn(col).width ?? 8.43), 0);
      lines = Math.max(lines, estimateWrappedLines(text, width * 0.9));
    }
    const needed = lines * PROPOSAL_LINE_HEIGHT_PT;
    if (needed > (row.height ?? PROPOSAL_LINE_HEIGHT_PT)) row.height = needed;
  }
}

// Converts a single sheet of an already-finalized workbook into a PDF via
// Microsoft Graph's Excel-to-PDF export (Excel Online renders it, so the
// output matches a native Excel "Print" far more closely than an HTML/CSS or
// LibreOffice re-implementation). Every other sheet is dropped so the
// customer only ever receives the Proposal sheet, never the internal Pricing
// Worksheet/Transmittal/Invoice/etc. sheets that live in the same workbook —
// confirmed that hiding (rather than deleting) those sheets does NOT work:
// Graph's PDF export still rendered the hidden 'Pricing Worksheet' as page 1
// of the output regardless of its hidden state.
export async function convertProposalSheetToPdf(
  xlsxBuffer: Buffer,
  sheetName: string,
): Promise<Buffer> {
  assertExcelGraphConfigured();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer as any);

  const proposalSheet = workbook.getWorksheet(sheetName);
  if (!proposalSheet) {
    throw new AppError(
      `Cannot export PDF: sheet "${sheetName}" was not found in the generated workbook.`,
      StatusCodes.INTERNAL_SERVER_ERROR,
    );
  }

  // Column B labels are plain text, safe to read via ExcelJS — compute this
  // before any of the mutations below in case a later step's behavior ever
  // depends on read order.
  const addonSectionBases = findAddonSectionUnitRowBases(proposalSheet);

  // Resolve cross-sheet references to plain values BEFORE the other sheets
  // are deleted below, then delete them. Scoped to a curated list of known
  // addresses rather than a blanket sweep of every formula cell on the
  // sheet. Deliberately excludes the addon sections' per-unit $ column
  // (Seeded Organic/NanoDot/Heat Soak) from this ExcelJS-based pass — those
  // are handled afterward directly in the raw XML (stripAddonFormulasInRawXml
  // below), because ExcelJS's own getter fabricates a wrong "shared formula"
  // reconstruction for them and any read or write through its Cell API,
  // even a same-value no-op, corrupts the file enough that Microsoft
  // Graph's PDF export rejects it outright. Base Pricing's own per-unit $
  // column has no such issue.
  for (const address of [...PROPOSAL_HEADER_ADDRESSES, ...BASE_PRICING_ADDRESSES]) {
    const cell = proposalSheet.getCell(address);
    const value = cell.value as any;
    if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
      const resolved = resolveFormulaCellValue(workbook, proposalSheet, value);
      // Skip the reassignment entirely when nothing changed (a pure
      // same-sheet formula we deliberately leave alone) — even a same-value
      // `.value =` write can detach a cell from an Excel "shared formula"
      // group, so cells we're not actually resolving are left untouched.
      if (resolved !== value) {
        cell.value = resolved as any;
      }
    }
  }

  for (const ws of workbook.worksheets.filter((w) => w.name !== sheetName)) {
    workbook.removeWorksheet(ws.id);
  }

  const trimmedBuffer = await fixAddonFormulasInRawXml(
    xlsxBuffer,
    Buffer.from(await workbook.xlsx.writeBuffer()),
    sheetName,
    addonSectionBases,
  );

  const token = await getGraphToken();
  const userRoot = graphUserRoot();
  const tempFileName = `gfs-temp-proposal-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`;
  const uploadUrl = `${userRoot}/drive/root:/${tempFileName}:/content`;

  let uploadRes;
  try {
    uploadRes = await axios.put(uploadUrl, trimmedBuffer, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (err: any) {
    const status = err.response?.status;
    const data = err.response?.data;
    throw new Error(`Graph API Upload Error [${status}]: ${JSON.stringify(data)}`);
  }

  const driveItemId = uploadRes.data.id;

  try {
    const maxRetries = 5;
    let downloadRes;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        downloadRes = await axios.get(`${userRoot}/drive/items/${driveItemId}/content?format=pdf`, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
        });
        break;
      } catch (downloadErr: any) {
        const status = downloadErr?.response?.status;
        // 500/502/503/504 observed in practice: Excel Online's own PDF
        // export backend ("excelcs.officeapps.live.com") intermittently
        // times out under load — a transient service issue, not a payload
        // problem, and it resolves on retry.
        const isRetryable = [423, 409, 429, 500, 502, 503, 504].includes(status);
        if (isRetryable && attempt < maxRetries) {
          const delay = attempt * 500;
          console.warn(`[Graph Generator] PDF conversion attempt ${attempt} returned status ${status}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw downloadErr;
        }
      }
    }

    if (!downloadRes) {
      throw new Error(`Failed to convert workbook to PDF via Microsoft Graph for item ${driveItemId}`);
    }

    return Buffer.from(downloadRes.data);
  } finally {
    try {
      await axios.delete(`${userRoot}/drive/items/${driveItemId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Failed to cleanup temp PDF-conversion file from OneDrive', err);
    }
  }
}
