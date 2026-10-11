import ExcelJS from 'exceljs';
import { IProjectSchema } from '@db/models/proposal.model';
import { extractPricingSnapshot, PricingSnapshot } from './pricing-snapshot';
import {
  matchCrossbeamKey,
  matchGlassTypeKey,
  matchFrameTypeKey,
} from './graph.generator';
import type { FieldChange } from '@db/models/pending-change-approval.model';
import { unitManHoursCell, unitPackagingCell, UNIT_SELECTION_COLUMNS } from '../unit-derived-values';

export interface ParsedUnitData {
  unitKey: string; // 'A' .. 'J'
  location?: string | null;
  widthIn?: number | null;
  lengthIn?: number | null;
  panelCount?: number | null;
  numUnits?: number | null;
  verticalRafterCount?: number | null;
  horizontalRafterCount?: number | null;
  drawingNumber?: string | null;
  manHours?: number | null;
  packaging?: number | null;
  glassType?: string | null;
  frameType?: string | null;
}

export interface ParsedProposalData {
  stage1: {
    projectName?: string | null;
    projectAddress?: string | null;
    contactName?: string | null;
    contactAddress?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    projectType?: string | null;
    architect?: string | null;
    homeowner?: string | null;
    drafterDesigner?: string | null;
    personQuoting?: string | null;
    personChecked?: string | null;
  };
  units: Record<string, ParsedUnitData>;
  glassType?: string | null;
  frameType?: string | null;
  crossbeam?: string | null;
  stage5Addons: {
    duty?: 'y' | 'n' | null;
    seededOrganic?: 'y' | 'n' | null;
    heatSoakTesting?: 'y' | 'n' | null;
    nanodot?: 'y' | 'n' | null;
    sentryGlass?: 'y' | 'n' | null;
    kryptonGas?: 'y' | 'n' | null;
    backpaint?: 'y' | 'n' | null;
    customShape?: 'y' | 'n' | null;
    threeMTape?: 'y' | 'n' | null;
  };
  optionalAddOnStatuses?: Record<string, 'ACCEPTED' | 'NOT_SELECTED'>;
  additionalChargeSelections?: Record<string, 'Y' | 'N'>;
  costOverrides: Record<string, number>;
  pricingSnapshot?: PricingSnapshot | null;
}

const GLASS_ROW_MAP: Record<number, string> = {
  9: 'GLASS_NO_IGU',
  10: 'GLASS_WITH_IGU',
  11: 'GLASS_2_0',
  12: 'STAIR_TREAD',
  13: 'NON_WALKABLE',
  14: 'EGR',
};

const FRAME_ROW_MAP: Record<number, string> = {
  38: 'SERIES_1000_PEDESTAL',
  39: 'SERIES_1000_RECESSED',
  40: 'PERIMETER_NON_TB',
  41: 'SERIES_2000_PEDESTAL',
  42: 'SERIES_2000_RECESSED',
  43: 'SERIES_2000_WITH_PLATE',
  44: 'SERIES_2000_NON_WALKABLE',
  45: 'SERIES_3000',
  46: 'DECK_PERIMETER',
  47: 'ECONOFRAME',
  48: 'ROUND_FRAME_42',
  49: 'HORIZONTAL_CAP_SERIES_1000',
  50: 'VERTICAL_CAP_SERIES_1000',
};

const CROSSBEAM_ROW_MAP: Record<number, string> = {
  53: 'SERIES_1000_T_SECTION_TB',
  54: 'SERIES_1000_I_BEAM_TB',
  55: 'SERIES_1000_T_SECTION',
  56: 'SERIES_1000_I_BEAM',
  57: 'SERIES_2000_T_SECTION_TB',
  58: 'SERIES_2000_I_BEAM_TB',
  59: 'ECONOFRAME_2_5',
  60: 'ECONOFRAME_3_5',
};

function getCellValue(worksheet: ExcelJS.Worksheet, address: string): any {
  const cell = worksheet.getCell(address);
  const val = cell.value;
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && 'result' in val) {
    return (val as any).result ?? null;
  }
  return val;
}

function isFormulaValue(val: unknown): boolean {
  return typeof val === 'object' && val !== null && 'formula' in val;
}

function findRowByPattern(
  worksheet: ExcelJS.Worksheet,
  pattern: RegExp,
  startRow = 1,
  endRow = 150
): number | null {
  for (let r = startRow; r <= Math.min(endRow, worksheet.rowCount); r++) {
    const val = worksheet.getCell(`B${r}`).value;
    const text = typeof val === 'object' && val && 'richText' in val
      ? (val as any).richText.map((t: any) => t.text).join('')
      : String(val ?? '');
    if (pattern.test(text)) return r;
  }
  return null;
}

function getStringValue(worksheet: ExcelJS.Worksheet, address: string): string | null {
  const v = getCellValue(worksheet, address);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function getNumericValue(worksheet: ExcelJS.Worksheet, address: string): number | null {
  const v = getCellValue(worksheet, address);
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function isYes(val: any): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1';
}

export class ExcelIngestionService {
  /**
   * Parses an Excel proposal/pricing worksheet from a buffer or loaded workbook.
   */
  public async parseProposalExcel(bufferOrWorkbook: Buffer | ExcelJS.Workbook): Promise<ParsedProposalData> {
    let workbook: ExcelJS.Workbook;
    if (bufferOrWorkbook instanceof ExcelJS.Workbook) {
      workbook = bufferOrWorkbook;
    } else {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bufferOrWorkbook as any);
    }

    const worksheet =
      workbook.getWorksheet('Pricing Worksheet') ??
      workbook.worksheets.find((ws) => ws.name.toLowerCase().includes('pricing')) ??
      workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('Workbook contains no worksheets');
    }

    // 1. Stage 1 — Headers
    const stage1 = {
      projectName: getStringValue(worksheet, 'C2'),
      projectAddress: getStringValue(worksheet, 'F2'),
      contactName: getStringValue(worksheet, 'C3'),
      contactAddress: getStringValue(worksheet, 'F3'),
      contactPhone: getStringValue(worksheet, 'I3'),
      contactEmail: getStringValue(worksheet, 'L3'),
      projectType: getStringValue(worksheet, 'C4'),
      architect: getStringValue(worksheet, 'F4'),
      homeowner: getStringValue(worksheet, 'I4'),
      drafterDesigner: getStringValue(worksheet, 'L4'),
      personQuoting: getStringValue(worksheet, 'L2'),
      personChecked: getStringValue(worksheet, 'P2'),
    };

    // 2. Unit Takeoff — Rows 115 to 124 (Units A to J)
    const units: Record<string, ParsedUnitData> = {};
    let activeUnitsCount = 0;

    for (let i = 0; i < 10; i++) {
      const unitKey = String.fromCharCode(65 + i); // 'A'..'J'
      const row = 115 + i;

      const location = getStringValue(worksheet, `C${row}`);
      const widthIn = getNumericValue(worksheet, `E${row}`);
      const lengthIn = getNumericValue(worksheet, `F${row}`);
      const panelCount = getNumericValue(worksheet, `G${row}`);
      const numUnits = getNumericValue(worksheet, `J${row}`);
      const verticalRafterCount = getNumericValue(worksheet, `K${row}`);
      const horizontalRafterCount = getNumericValue(worksheet, `L${row}`);
      const drawingNumber = getStringValue(worksheet, `M${row}`);

      const manHoursAddress = unitManHoursCell(unitKey);
      let manHours: number | null = null;
      if (manHoursAddress) {
        const mhCell = worksheet.getCell(manHoursAddress);
        if (!isFormulaValue(mhCell.value)) {
          const mh = getNumericValue(worksheet, manHoursAddress);
          if (mh !== null && mh >= 0) manHours = mh;
        }
      }

      const packagingAddress = unitPackagingCell(unitKey);
      let packaging: number | null = null;
      if (packagingAddress) {
        const pkgCell = worksheet.getCell(packagingAddress);
        if (!isFormulaValue(pkgCell.value)) {
          const pkg = getNumericValue(worksheet, packagingAddress);
          if (pkg !== null && pkg >= 0) packaging = pkg;
        }
      }

      const selCol = UNIT_SELECTION_COLUMNS[i];
      let unitGlassType: string | null = null;
      let unitFrameType: string | null = null;
      if (selCol) {
        for (let r = 8; r <= 15; r++) {
          if (isYes(getCellValue(worksheet, `${selCol}${r}`))) {
            const rowLabel = worksheet.getCell(`B${r}`).value;
            const matched = rowLabel ? matchGlassTypeKey(rowLabel) : null;
            unitGlassType = matched ?? GLASS_ROW_MAP[r] ?? null;
            break;
          }
        }
        for (let r = 35; r <= 52; r++) {
          if (isYes(getCellValue(worksheet, `${selCol}${r}`))) {
            const rowLabel = worksheet.getCell(`B${r}`).value;
            const matched = rowLabel ? matchFrameTypeKey(rowLabel) : null;
            unitFrameType = matched ?? FRAME_ROW_MAP[r] ?? null;
            break;
          }
        }
      }

      const hasData =
        widthIn !== null ||
        lengthIn !== null ||
        panelCount !== null ||
        manHours !== null ||
        packaging !== null ||
        unitGlassType !== null ||
        unitFrameType !== null ||
        (location !== null && location.toLowerCase() !== 'unit ' + unitKey.toLowerCase());

      if (hasData) {
        activeUnitsCount++;
        units[unitKey] = {
          unitKey,
          location,
          widthIn,
          lengthIn,
          panelCount: panelCount !== null ? Math.round(panelCount) : null,
          numUnits: numUnits !== null ? Math.round(numUnits) : 1,
          verticalRafterCount: verticalRafterCount !== null ? Math.round(verticalRafterCount) : null,
          horizontalRafterCount: horizontalRafterCount !== null ? Math.round(horizontalRafterCount) : null,
          drawingNumber,
          manHours,
          packaging,
          glassType: unitGlassType,
          frameType: unitFrameType,
        };
      }
    }

    // 3. Glass Type & Frame Type — Project-level (Defaults from Column D / Unit A)
    let glassType: string | null = units['A']?.glassType ?? null;
    if (!glassType) {
      for (let r = 8; r <= 15; r++) {
        if (isYes(getCellValue(worksheet, `D${r}`))) {
          const rowLabel = worksheet.getCell(`B${r}`).value;
          const matched = rowLabel ? matchGlassTypeKey(rowLabel) : null;
          glassType = matched ?? GLASS_ROW_MAP[r] ?? null;
          break;
        }
      }
    }

    let frameType: string | null = units['A']?.frameType ?? null;
    if (!frameType) {
      for (let r = 35; r <= 52; r++) {
        if (isYes(getCellValue(worksheet, `D${r}`))) {
          const rowLabel = worksheet.getCell(`B${r}`).value;
          const matched = rowLabel ? matchFrameTypeKey(rowLabel) : null;
          frameType = matched ?? FRAME_ROW_MAP[r] ?? null;
          break;
        }
      }
    }

    // 4. Crossbeam — Rows 50 to 65, Column D ('y')
    let crossbeam: string | null = null;
    for (let r = 50; r <= 65; r++) {
      if (isYes(getCellValue(worksheet, `D${r}`))) {
        const rowLabel = worksheet.getCell(`B${r}`).value;
        const matched = rowLabel ? matchCrossbeamKey(rowLabel) : null;
        crossbeam = matched ?? CROSSBEAM_ROW_MAP[r] ?? null;
        break;
      }
    }

    // 4. Addons — Stage 5 & Options (Resolve dynamically by label, falling back to legacy rows)
    const sentryRow = findRowByPattern(worksheet, /Sentry Glass/i, 15, 25);
    const kryptonRow = findRowByPattern(worksheet, /Krypton/i, 15, 25);
    const backpaintRow = findRowByPattern(worksheet, /Backpaint/i, 15, 25);
    const customShapeRow = findRowByPattern(worksheet, /^Custom$/i, 15, 25);
    const threeMTapeRow = findRowByPattern(worksheet, /3m\s*tape|tape/i, 65, 72);
    const dutyRow = findRowByPattern(worksheet, /^Duty$/i, 80, 95);
    const seededOrganicRow = findRowByPattern(worksheet, /Seeded Organic/i, 95, 115);
    const heatSoakRow = findRowByPattern(worksheet, /Heat Soak/i, 95, 115);
    const nanodotRow = findRowByPattern(worksheet, /Nano\s*Dot/i, 95, 115);

    const stage5Addons = {
      duty: isYes(getCellValue(worksheet, dutyRow ? `D${dutyRow}` : 'D90')) ? ('y' as const) : ('n' as const),
      seededOrganic: isYes(getCellValue(worksheet, seededOrganicRow ? `D${seededOrganicRow}` : 'D107')) ? ('y' as const) : ('n' as const),
      heatSoakTesting: isYes(getCellValue(worksheet, heatSoakRow ? `D${heatSoakRow}` : 'D109')) ? ('y' as const) : ('n' as const),
      nanodot: isYes(getCellValue(worksheet, nanodotRow ? `D${nanodotRow}` : 'D110')) ? ('y' as const) : ('n' as const),
      sentryGlass: isYes(getCellValue(worksheet, sentryRow ? `D${sentryRow}` : 'D16')) ? ('y' as const) : ('n' as const),
      kryptonGas: isYes(getCellValue(worksheet, kryptonRow ? `D${kryptonRow}` : 'D17')) ? ('y' as const) : ('n' as const),
      backpaint: isYes(getCellValue(worksheet, backpaintRow ? `D${backpaintRow}` : 'D20')) ? ('y' as const) : ('n' as const),
      customShape: isYes(getCellValue(worksheet, customShapeRow ? `D${customShapeRow}` : 'D21')) ? ('y' as const) : ('n' as const),
      threeMTape: isYes(getCellValue(worksheet, threeMTapeRow ? `D${threeMTapeRow}` : 'D69')) ? ('y' as const) : ('n' as const),
    };

    // Optional Add-on Acceptance (Rows 107, 109, 110)
    const optionalAddOnStatuses: Record<string, 'ACCEPTED' | 'NOT_SELECTED'> = {
      C107: stage5Addons.seededOrganic === 'y' ? 'ACCEPTED' : 'NOT_SELECTED',
      C109: stage5Addons.heatSoakTesting === 'y' ? 'ACCEPTED' : 'NOT_SELECTED',
      C110: stage5Addons.nanodot === 'y' ? 'ACCEPTED' : 'NOT_SELECTED',
    };

    // 5. Additional Charges Selection — Rows 75 to 82, 85, 91, Column D ('y')
    // Note: Row 69 (3M Tape) is captured as a Stage 5 Addon (stage5Addons.threeMTape)
    const additionalChargeRows = [75, 76, 77, 78, 79, 80, 81, 82, 85, 91];
    const additionalChargeSelections: Record<string, 'Y' | 'N'> = {};
    for (const r of additionalChargeRows) {
      const dVal = getCellValue(worksheet, `D${r}`);
      additionalChargeSelections[`C${r}`] = isYes(dVal) ? 'Y' : 'N';
    }
    if (stage5Addons.threeMTape) {
      additionalChargeSelections['C69'] = stage5Addons.threeMTape === 'y' ? 'Y' : 'N';
    }

    // 6. Cost Overrides / Charges — Literal numbers in Column F (Amount) or Column E (Quantity), excluding formulas
    const costOverrides: Record<string, number> = {};
    const checkChargeRows = [64, 68, 75, 76, 77, 78, 79, 80, 81, 82, 85, 91];
    for (const r of checkChargeRows) {
      const fCell = worksheet.getCell(`F${r}`);
      if (!isFormulaValue(fCell.value)) {
        const amt = getNumericValue(worksheet, `F${r}`);
        if (amt !== null && amt > 0) {
          costOverrides[`F${r}`] = amt;
        }
      }
      const eCell = worksheet.getCell(`E${r}`);
      if (!isFormulaValue(eCell.value)) {
        const qty = getNumericValue(worksheet, `E${r}`);
        if (qty !== null && qty > 0) {
          costOverrides[`E${r}`] = qty;
        }
      }
    }
    // Check F69 only if formula was replaced by a literal override (E69 has template default 12)
    const f69Cell = worksheet.getCell('F69');
    if (!isFormulaValue(f69Cell.value)) {
      const amt = getNumericValue(worksheet, 'F69');
      if (amt !== null && amt > 0) {
        costOverrides['F69'] = amt;
      }
    }

    // 7. Pricing Snapshot — Subtotal, Total, Final Price
    let pricingSnapshot: PricingSnapshot | null = null;
    try {
      pricingSnapshot = await extractPricingSnapshot(workbook, activeUnitsCount || 1);
    } catch (err) {
      console.warn('[ExcelIngestion] Failed to extract pricing snapshot:', err);
    }

    return {
      stage1,
      units,
      glassType,
      frameType,
      crossbeam,
      stage5Addons,
      optionalAddOnStatuses,
      additionalChargeSelections,
      costOverrides,
      pricingSnapshot,
    };
  }

  /**
   * Compares parsed Excel data against the current project schema to produce a clean list of FieldChange items.
   */
  public diffWithCurrentSchema(currentSchema: IProjectSchema, parsedData: ParsedProposalData): FieldChange[] {
    const changes: FieldChange[] = [];

    // 1. Stage 1 Header Diff
    const headerMappings: Array<{
      key: keyof ParsedProposalData['stage1'];
      path: string;
      label: string;
    }> = [
      { key: 'projectName', path: 'stage_1.project_name', label: 'Project Name' },
      { key: 'projectAddress', path: 'stage_1.project_address', label: 'Project Address' },
      { key: 'contactName', path: 'stage_1.contact_name', label: 'Contact Name' },
      { key: 'contactAddress', path: 'stage_1.contact_address', label: 'Contact Address' },
      { key: 'contactPhone', path: 'stage_1.contact_phone', label: 'Contact Phone' },
      { key: 'contactEmail', path: 'stage_1.contact_email', label: 'Contact Email' },
      { key: 'projectType', path: 'stage_1.project_type', label: 'Project Type' },
      { key: 'architect', path: 'stage_1.architect', label: 'Architect' },
      { key: 'homeowner', path: 'stage_1.homeowner', label: 'Homeowner' },
      { key: 'drafterDesigner', path: 'stage_1.drafter_designer', label: 'Drafter / Designer' },
      { key: 'personQuoting', path: 'stage_1.person_quoting', label: 'Person Quoting' },
      { key: 'personChecked', path: 'stage_1.person_checked', label: 'Person Checked' },
    ];

    for (const { key, path, label } of headerMappings) {
      const newVal = parsedData.stage1[key];
      if (newVal === null || newVal === undefined) continue;

      const oldVal = (currentSchema.stage_1 as any)?.[key.replace(/([A-Z])/g, '_$1').toLowerCase()]?.value ?? null;
      if (oldVal !== newVal && (oldVal || newVal)) {
        changes.push({
          fieldPath: path,
          fieldName: label,
          fieldType: 'text',
          previousValue: oldVal,
          newValue: newVal,
          aiReasoning: `Updated from Dropbox Excel: ${label} changed from "${oldVal ?? ''}" to "${newVal}"`,
        });
      }
    }

    // 2. Units Takeoff Diff
    for (let i = 0; i < 10; i++) {
      const unitKey = String.fromCharCode(65 + i);
      const parsedUnit = parsedData.units[unitKey];
      const existingUnit = currentSchema.units?.[unitKey];

      if (!parsedUnit && !existingUnit) continue;

      const unitFields: Array<{
        key: keyof ParsedUnitData;
        field: string;
        label: string;
        type: string;
      }> = [
        { key: 'widthIn', field: 'value_width_in', label: `Unit ${unitKey} Width`, type: 'number' },
        { key: 'lengthIn', field: 'value_length_in', label: `Unit ${unitKey} Length`, type: 'number' },
        { key: 'panelCount', field: 'value_panel_count', label: `Unit ${unitKey} Panels`, type: 'integer' },
        { key: 'numUnits', field: 'value_num_units', label: `Unit ${unitKey} Count`, type: 'integer' },
        { key: 'verticalRafterCount', field: 'value_vertical_rafter_count', label: `Unit ${unitKey} Vert Rafters`, type: 'integer' },
        { key: 'horizontalRafterCount', field: 'value_horizontal_rafter_count', label: `Unit ${unitKey} Horiz Rafters`, type: 'integer' },
        { key: 'drawingNumber', field: 'value_drawing_number', label: `Unit ${unitKey} Drawing #`, type: 'text' },
        { key: 'location', field: 'value_location', label: `Unit ${unitKey} Location`, type: 'text' },
        { key: 'manHours', field: 'value_man_hours', label: `Unit ${unitKey} Man Hours`, type: 'number' },
        { key: 'packaging', field: 'value_packaging', label: `Unit ${unitKey} Packaging`, type: 'number' },
      ];

      for (const { key, field, label, type } of unitFields) {
        const newVal = parsedUnit ? parsedUnit[key] : null;
        const oldVal = existingUnit ? (existingUnit as any)[field] ?? null : null;

        const isZeroEquiv = (key === 'manHours' || key === 'packaging') && (oldVal ?? 0) === 0 && (newVal ?? 0) === 0;

        if (!isZeroEquiv && newVal !== null && newVal !== undefined && newVal !== oldVal) {
          changes.push({
            fieldPath: `units.${unitKey}.${field}`,
            fieldName: label,
            fieldType: type,
            previousValue: oldVal,
            newValue: newVal,
            aiReasoning: `Updated from Dropbox Excel: ${label} changed from ${oldVal ?? 'none'} to ${newVal}`,
          });
        }
      }

      if (parsedUnit?.glassType) {
        const oldUnitGlass = existingUnit ? (existingUnit as any).value_glass_type ?? null : null;
        const projectGlassRaw = (currentSchema.stage_2 as any)?.glass_type;
        const projectGlass = typeof projectGlassRaw === 'object' && projectGlassRaw !== null ? projectGlassRaw.value : projectGlassRaw;
        if (oldUnitGlass !== null && oldUnitGlass !== parsedUnit.glassType) {
          changes.push({
            fieldPath: `units.${unitKey}.value_glass_type`,
            fieldName: `Unit ${unitKey} Glass Type`,
            fieldType: 'select',
            previousValue: oldUnitGlass,
            newValue: parsedUnit.glassType,
            aiReasoning: `Updated from Dropbox Excel: Unit ${unitKey} glass type changed from ${oldUnitGlass} to ${parsedUnit.glassType}`,
          });
        } else if (oldUnitGlass === null && projectGlass && parsedUnit.glassType !== projectGlass && unitKey !== 'A') {
          changes.push({
            fieldPath: `units.${unitKey}.value_glass_type`,
            fieldName: `Unit ${unitKey} Glass Type`,
            fieldType: 'select',
            previousValue: projectGlass,
            newValue: parsedUnit.glassType,
            aiReasoning: `Updated from Dropbox Excel: Unit ${unitKey} glass type overridden to ${parsedUnit.glassType}`,
          });
        }
      }

      if (parsedUnit?.frameType) {
        const oldUnitFrame = existingUnit ? (existingUnit as any).value_frame_type ?? null : null;
        const projectFrameRaw = (currentSchema.stage_3?.decision as any)?.frame_type;
        const projectFrame = typeof projectFrameRaw === 'object' && projectFrameRaw !== null ? projectFrameRaw.value : projectFrameRaw;
        if (oldUnitFrame !== null && oldUnitFrame !== parsedUnit.frameType) {
          changes.push({
            fieldPath: `units.${unitKey}.value_frame_type`,
            fieldName: `Unit ${unitKey} Frame Type`,
            fieldType: 'select',
            previousValue: oldUnitFrame,
            newValue: parsedUnit.frameType,
            aiReasoning: `Updated from Dropbox Excel: Unit ${unitKey} frame type changed from ${oldUnitFrame} to ${parsedUnit.frameType}`,
          });
        } else if (oldUnitFrame === null && projectFrame && parsedUnit.frameType !== projectFrame && unitKey !== 'A') {
          changes.push({
            fieldPath: `units.${unitKey}.value_frame_type`,
            fieldName: `Unit ${unitKey} Frame Type`,
            fieldType: 'select',
            previousValue: projectFrame,
            newValue: parsedUnit.frameType,
            aiReasoning: `Updated from Dropbox Excel: Unit ${unitKey} frame type overridden to ${parsedUnit.frameType}`,
          });
        }
      }
    }

    // 3. Glass Type Diff (Stage 2)
    if (parsedData.glassType) {
      const oldRaw = (currentSchema.stage_2 as any)?.glass_type;
      const oldGlass = typeof oldRaw === 'object' && oldRaw !== null ? oldRaw.value : oldRaw;
      if (oldGlass && oldGlass !== parsedData.glassType) {
        changes.push({
          fieldPath: 'stage_2.glass_type',
          fieldName: 'Glass Type',
          fieldType: 'select',
          previousValue: oldGlass,
          newValue: parsedData.glassType,
          aiReasoning: `Updated from Dropbox Excel: Glass type changed from ${oldGlass} to ${parsedData.glassType}`,
        });
      }
    }

    // 4. Frame Type Diff (Stage 3)
    if (parsedData.frameType) {
      const oldRaw = (currentSchema.stage_3?.decision as any)?.frame_type;
      const oldFrame = typeof oldRaw === 'object' && oldRaw !== null ? oldRaw.value : oldRaw;
      if (oldFrame && oldFrame !== parsedData.frameType) {
        changes.push({
          fieldPath: 'stage_3.decision.frame_type',
          fieldName: 'Frame Type',
          fieldType: 'select',
          previousValue: oldFrame,
          newValue: parsedData.frameType,
          aiReasoning: `Updated from Dropbox Excel: Frame type changed from ${oldFrame} to ${parsedData.frameType}`,
        });
      }
    }

    // 5. Crossbeam Diff
    if (parsedData.crossbeam) {
      const oldCrossbeam = currentSchema.stage_4?.crossbeam?.value ?? null;
      if (oldCrossbeam !== parsedData.crossbeam) {
        changes.push({
          fieldPath: 'stage_4.crossbeam',
          fieldName: 'Crossbeam Series',
          fieldType: 'select',
          previousValue: oldCrossbeam,
          newValue: parsedData.crossbeam,
          aiReasoning: `Updated from Dropbox Excel: Crossbeam changed from ${oldCrossbeam ?? 'none'} to ${parsedData.crossbeam}`,
        });
      }
    }

    // 4. Stage 5 Addons Diff
    const addonKeys: Array<{
      key: keyof ParsedProposalData['stage5Addons'];
      path: string;
      label: string;
      schemaKey: string;
    }> = [
      { key: 'duty', path: 'stage_5.addons.duty', label: 'Duty', schemaKey: 'duty' },
      { key: 'nanodot', path: 'stage_5.addons.nanodot', label: 'NanoDot', schemaKey: 'nanodot' },
      { key: 'seededOrganic', path: 'stage_5.addons.seeded_organic', label: 'Seeded Organic', schemaKey: 'seeded_organic' },
      { key: 'heatSoakTesting', path: 'stage_5.addons.heat_soak_testing', label: 'Heat Soak Testing', schemaKey: 'heat_soak_testing' },
      { key: 'sentryGlass', path: 'stage_5.addons.sentry_glass', label: 'Sentry Glass', schemaKey: 'sentry_glass' },
      { key: 'kryptonGas', path: 'stage_5.addons.krypton_gas', label: 'Krypton Gas', schemaKey: 'krypton_gas' },
      { key: 'backpaint', path: 'stage_5.addons.backpaint', label: 'Backpaint', schemaKey: 'backpaint' },
      { key: 'customShape', path: 'stage_5.addons.custom_shape', label: 'Custom Shape', schemaKey: 'custom_shape' },
      { key: 'threeMTape', path: 'stage_5.addons.three_m_tape', label: '3M Tape', schemaKey: 'three_m_tape' },
    ];

    for (const { key, path, label, schemaKey } of addonKeys) {
      const newVal = parsedData.stage5Addons[key];
      const oldRaw = (currentSchema.stage_5?.addons as any)?.[schemaKey];
      const oldVal = typeof oldRaw === 'object' && oldRaw !== null ? oldRaw.value : oldRaw;
      const normalizedOld = (oldVal === 'y' || oldVal === 'Y' || oldVal === true) ? 'y' : 'n';
      const normalizedNew = newVal === 'y' ? 'y' : 'n';

      if (normalizedOld !== normalizedNew) {
        changes.push({
          fieldPath: path,
          fieldName: label,
          fieldType: 'yn',
          previousValue: oldVal ?? 'n',
          newValue: normalizedNew,
          aiReasoning: `Updated from Dropbox Excel: Addon ${label} changed from ${oldVal ?? 'n'} to ${normalizedNew}`,
        });
      }
    }

    // 5. Optional Add-on Acceptance Diff (rows 107, 109, 110)
    const existingOptionalStatuses = currentSchema.stage_7?.optional_add_on_statuses ?? {};
    for (const [cell, status] of Object.entries(parsedData.optionalAddOnStatuses ?? {})) {
      const oldRaw = existingOptionalStatuses[cell];
      const oldIsAccepted = oldRaw === 'ACCEPTED';
      const newIsAccepted = status === 'ACCEPTED';
      if (oldIsAccepted !== newIsAccepted) {
        const oldStatusDisplay = oldRaw ?? 'NOT_SELECTED';
        changes.push({
          fieldPath: `stage_7.optional_add_on_statuses.${cell}`,
          fieldName: `Optional Add-On (${cell}) Status`,
          fieldType: 'select',
          previousValue: oldStatusDisplay,
          newValue: status,
          aiReasoning: `Updated from Dropbox Excel: Optional add-on ${cell} status changed from ${oldStatusDisplay} to ${status}`,
        });
      }
    }

    // 6. Additional Charge Selections Diff (rows 75-82, 85, 91)
    // Note: C69 (3M tape) is diffed above under Stage 5 addons (three_m_tape)
    const existingSelections = currentSchema.stage_7?.additional_charge_selections ?? {};
    for (const [cell, sel] of Object.entries(parsedData.additionalChargeSelections ?? {})) {
      if (cell === 'C69') continue;
      const oldSel = existingSelections[cell] ?? 'N';
      if (oldSel !== sel) {
        changes.push({
          fieldPath: `stage_7.additional_charge_selections.${cell}`,
          fieldName: `Additional Charge Selection (${cell})`,
          fieldType: 'select',
          previousValue: oldSel,
          newValue: sel,
          aiReasoning: `Updated from Dropbox Excel: Additional charge ${cell} selection changed from ${oldSel} to ${sel}`,
        });
      }
    }

    // 6. Cost Overrides Diff
    const existingOverrides = currentSchema.stage_7?.cost_overrides ?? {};
    for (const [cell, cost] of Object.entries(parsedData.costOverrides)) {
      const oldCost = existingOverrides[cell];
      if (oldCost !== cost) {
        changes.push({
          fieldPath: `stage_7.cost_overrides.${cell}`,
          fieldName: `Cost Override (${cell})`,
          fieldType: 'number',
          previousValue: oldCost ?? null,
          newValue: cost,
          aiReasoning: `Updated from Dropbox Excel: Override for cell ${cell} changed from ${oldCost ?? 0} to ${cost}`,
        });
      }
    }

    // 6. Final Pricing Snapshot Diff
    if (parsedData.pricingSnapshot && parsedData.pricingSnapshot.final_price > 0) {
      const oldPrice = currentSchema.stage_7?.computed_snapshot?.final_price
        ?? currentSchema.stage_7?.computed_snapshot?.grand_total
        ?? null;
      const newPrice = parsedData.pricingSnapshot.final_price;
      if (oldPrice !== null && Math.abs(oldPrice - newPrice) > 0.05) {
        changes.push({
          fieldPath: 'stage_7.computed_snapshot.final_price',
          fieldName: 'Final Proposal Price',
          fieldType: 'currency',
          previousValue: oldPrice,
          newValue: newPrice,
          aiReasoning: `Calculated Final Price in Excel sheet is $${newPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (was $${(oldPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
        });
      }
    }

    return changes;
  }

  /**
   * Applies the parsed Excel data to a clone of the project schema, returning
   * the updated schema, changed field paths, and the new calculated final price.
   */
  public applyParsedDataToSchema(
    currentSchema: IProjectSchema,
    parsedData: ParsedProposalData,
  ): {
    nextSchema: IProjectSchema;
    changedFieldPaths: string[];
    newFinalPrice: number | null;
  } {
    const nextSchema = structuredClone(currentSchema) as IProjectSchema;
    const changedFieldPaths: string[] = [];

    // Helper to safely set stage 1 field
    const setStage1Field = (field: string, val: string | null | undefined) => {
      if (val === null || val === undefined) return;
      if (!nextSchema.stage_1) (nextSchema as any).stage_1 = {};
      const s1 = nextSchema.stage_1 as any;
      if (!s1[field]) s1[field] = { value: null };
      if (s1[field].value !== val) {
        s1[field].value = val;
        s1[field].citation = { source: 'DROPBOX_EXCEL_IMPORT', text: val };
        changedFieldPaths.push(`stage_1.${field}`);
      }
    };

    setStage1Field('project_name', parsedData.stage1.projectName);
    setStage1Field('project_address', parsedData.stage1.projectAddress);
    setStage1Field('contact_name', parsedData.stage1.contactName);
    setStage1Field('contact_address', parsedData.stage1.contactAddress);
    setStage1Field('contact_phone', parsedData.stage1.contactPhone);
    setStage1Field('contact_email', parsedData.stage1.contactEmail);
    setStage1Field('project_type', parsedData.stage1.projectType);
    setStage1Field('architect', parsedData.stage1.architect);
    setStage1Field('homeowner', parsedData.stage1.homeowner);
    setStage1Field('drafter_designer', parsedData.stage1.drafterDesigner);
    setStage1Field('person_quoting', parsedData.stage1.personQuoting);
    setStage1Field('person_checked', parsedData.stage1.personChecked);

    // Apply Units
    if (!nextSchema.units) nextSchema.units = {};
    for (const [unitKey, parsedUnit] of Object.entries(parsedData.units)) {
      if (!nextSchema.units[unitKey]) {
        nextSchema.units[unitKey] = {
          value_width_in: null,
          value_length_in: null,
          value_panel_count: null,
          value_num_units: 1,
          value_drawing_number: null,
          value_location: null,
          value_glass_thickness: null,
          value_rafter_count: null,
          value_vertical_rafter_count: null,
          value_horizontal_rafter_count: null,
        } as any;
      }
      const unit = nextSchema.units[unitKey] as any;

      const updateProp = (prop: string, val: any) => {
        if (val !== null && val !== undefined && unit[prop] !== val) {
          unit[prop] = val;
          changedFieldPaths.push(`units.${unitKey}.${prop}`);
        }
      };

      updateProp('value_width_in', parsedUnit.widthIn);
      updateProp('value_length_in', parsedUnit.lengthIn);
      updateProp('value_panel_count', parsedUnit.panelCount);
      updateProp('value_num_units', parsedUnit.numUnits);
      updateProp('value_vertical_rafter_count', parsedUnit.verticalRafterCount);
      updateProp('value_horizontal_rafter_count', parsedUnit.horizontalRafterCount);
      updateProp('value_drawing_number', parsedUnit.drawingNumber);
      updateProp('value_location', parsedUnit.location);
      updateProp('value_man_hours', parsedUnit.manHours);
      updateProp('value_packaging', parsedUnit.packaging);

      if (parsedUnit.glassType) {
        const projectGlassRaw = (nextSchema.stage_2 as any)?.glass_type;
        const currentProjectGlass = typeof projectGlassRaw === 'object' && projectGlassRaw !== null ? projectGlassRaw.value : projectGlassRaw;
        if ((unit as any).value_glass_type != null || (parsedUnit.glassType !== currentProjectGlass && unitKey !== 'A')) {
          updateProp('value_glass_type', parsedUnit.glassType);
        }
      }
      if (parsedUnit.frameType) {
        const projectFrameRaw = (nextSchema.stage_3?.decision as any)?.frame_type;
        const currentProjectFrame = typeof projectFrameRaw === 'object' && projectFrameRaw !== null ? projectFrameRaw.value : projectFrameRaw;
        if ((unit as any).value_frame_type != null || (parsedUnit.frameType !== currentProjectFrame && unitKey !== 'A')) {
          updateProp('value_frame_type', parsedUnit.frameType);
        }
      }
    }

    // Glass Type (Stage 2)
    if (parsedData.glassType) {
      if (!nextSchema.stage_2) (nextSchema as any).stage_2 = {};
      const existing = (nextSchema.stage_2 as any).glass_type;
      if (typeof existing === 'object' && existing !== null) {
        if (existing.value !== parsedData.glassType) {
          existing.value = parsedData.glassType;
          existing.status = 'APPROVED';
          changedFieldPaths.push('stage_2.glass_type');
        }
      } else if (existing !== parsedData.glassType) {
        (nextSchema.stage_2 as any).glass_type = { value: parsedData.glassType, status: 'APPROVED' };
        changedFieldPaths.push('stage_2.glass_type');
      }
    }

    // Frame Type (Stage 3)
    if (parsedData.frameType) {
      if (!nextSchema.stage_3) (nextSchema as any).stage_3 = {};
      if (!nextSchema.stage_3.decision) (nextSchema.stage_3 as any).decision = {};
      const existing = (nextSchema.stage_3.decision as any).frame_type;
      if (typeof existing === 'object' && existing !== null) {
        if (existing.value !== parsedData.frameType) {
          existing.value = parsedData.frameType;
          existing.status = 'APPROVED';
          changedFieldPaths.push('stage_3.decision.frame_type');
        }
      } else if (existing !== parsedData.frameType) {
        (nextSchema.stage_3.decision as any).frame_type = { value: parsedData.frameType, status: 'APPROVED' };
        changedFieldPaths.push('stage_3.decision.frame_type');
      }
    }

    // Crossbeam (Stage 4)
    if (parsedData.crossbeam) {
      if (!nextSchema.stage_4) (nextSchema as any).stage_4 = {};
      const existing = (nextSchema.stage_4 as any).crossbeam;
      if (typeof existing === 'object' && existing !== null) {
        if (existing.value !== parsedData.crossbeam) {
          existing.value = parsedData.crossbeam;
          existing.status = 'APPROVED';
          changedFieldPaths.push('stage_4.crossbeam');
        }
      } else if (existing !== parsedData.crossbeam) {
        (nextSchema.stage_4 as any).crossbeam = { value: parsedData.crossbeam, status: 'APPROVED' };
        changedFieldPaths.push('stage_4.crossbeam');
      }
    }

    // Stage 5 Addons
    if (!nextSchema.stage_5) (nextSchema as any).stage_5 = { addons: {} };
    if (!nextSchema.stage_5.addons) nextSchema.stage_5.addons = {} as any;
    const addons = nextSchema.stage_5.addons as any;

    const updateAddon = (key: string, val: 'y' | 'n' | null | undefined) => {
      if (!val) return;
      const existing = addons[key];
      const existingVal = typeof existing === 'object' && existing !== null ? existing.value : existing;
      if (existingVal !== val) {
        if (typeof existing === 'object' && existing !== null) {
          existing.value = val;
          existing.status = 'APPROVED';
        } else {
          addons[key] = { value: val, status: 'APPROVED' };
        }
        changedFieldPaths.push(`stage_5.addons.${key}`);
      }
    };
    updateAddon('duty', parsedData.stage5Addons.duty);
    updateAddon('nanodot', parsedData.stage5Addons.nanodot);
    updateAddon('seeded_organic', parsedData.stage5Addons.seededOrganic);
    updateAddon('heat_soak_testing', parsedData.stage5Addons.heatSoakTesting);
    updateAddon('sentry_glass', parsedData.stage5Addons.sentryGlass);
    updateAddon('krypton_gas', parsedData.stage5Addons.kryptonGas);
    updateAddon('backpaint', parsedData.stage5Addons.backpaint);
    updateAddon('custom_shape', parsedData.stage5Addons.customShape);
    updateAddon('three_m_tape', parsedData.stage5Addons.threeMTape);

    // Stage 7 Cost Overrides & Selections
    if (!nextSchema.stage_7) {
      nextSchema.stage_7 = { status: 'READY', cost_overrides: {} } as any;
    }
    const stage7 = nextSchema.stage_7 as NonNullable<IProjectSchema['stage_7']>;

    // Stage 7 Optional Add-on Statuses
    if (parsedData.optionalAddOnStatuses && Object.keys(parsedData.optionalAddOnStatuses).length > 0) {
      if (!stage7.optional_add_on_statuses) {
        stage7.optional_add_on_statuses = {};
      }
      for (const [cell, status] of Object.entries(parsedData.optionalAddOnStatuses)) {
        const oldRaw = stage7.optional_add_on_statuses[cell];
        const oldIsAccepted = oldRaw === 'ACCEPTED';
        const newIsAccepted = status === 'ACCEPTED';
        if (oldIsAccepted !== newIsAccepted) {
          stage7.optional_add_on_statuses[cell] = status as any;
          changedFieldPaths.push(`stage_7.optional_add_on_statuses.${cell}`);
        }
      }
    }

    // Stage 7 Additional Charge Selections
    if (parsedData.additionalChargeSelections && Object.keys(parsedData.additionalChargeSelections).length > 0) {
      if (!stage7.additional_charge_selections) {
        stage7.additional_charge_selections = {};
      }
      for (const [cell, sel] of Object.entries(parsedData.additionalChargeSelections)) {
        if (stage7.additional_charge_selections[cell] !== sel) {
          stage7.additional_charge_selections[cell] = sel;
          changedFieldPaths.push(`stage_7.additional_charge_selections.${cell}`);
        }
      }
    }

    if (!stage7.cost_overrides) {
      stage7.cost_overrides = {};
    }
    for (const [cell, cost] of Object.entries(parsedData.costOverrides)) {
      if (stage7.cost_overrides[cell] !== cost) {
        stage7.cost_overrides[cell] = cost;
        changedFieldPaths.push(`stage_7.cost_overrides.${cell}`);
      }
    }

    // Pricing Snapshot
    let newFinalPrice: number | null = null;
    if (parsedData.pricingSnapshot && parsedData.pricingSnapshot.final_price > 0) {
      newFinalPrice = parsedData.pricingSnapshot.final_price;
      stage7.computed_snapshot = {
        subtotal: parsedData.pricingSnapshot.subtotal,
        total: parsedData.pricingSnapshot.total,
        final_price: newFinalPrice,
      };
      stage7.updated_at = new Date();
      changedFieldPaths.push('stage_7.computed_snapshot');
    }

    return { nextSchema, changedFieldPaths, newFinalPrice };
  }
}

export const excelIngestionService = new ExcelIngestionService();
