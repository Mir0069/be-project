import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import {
  generateProposalExcelLocally,
  invalidateTemplateBufferCache,
  setCachedTemplateBuffer,
} from '../../../../src/features/proposal/excel/graph.generator';
import { calculateFinalParameters } from '../../../../src/features/proposal/final-parameters.calculator';
import { isUnitQuantityOverrideKey } from '../../../../src/features/proposal/unit-pricing-lines';
import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { IProjectSchema } from '../../../../src/db/models/proposal.model';

const field = (value: unknown) => ({ value, status: 'APPROVED' }) as any;

const COSTS: Record<string, number> = {
  C9: 73.26,
  C10: 124.32,
  C38: 35.04,
  C41: 35.68,
  C54: 42.49,
  C58: 41,
  C61: 0.1,
};

// Mirrors GFS-2026-1095: unit A no-IGU on Series 1000, unit B with-IGU on Series 2000, unit C without dimensions.
const mixedUnitSchema = (): IProjectSchema => {
  const schema = createEmptySchema() as IProjectSchema;
  schema.stage_2.glass_type = field('GLASS_NO_IGU');
  schema.stage_3.decision.frame_type = field('SERIES_2000_PEDESTAL');
  schema.stage_4.crossbeam = field('I_BEAM_TB_2000');
  Object.assign(schema.units['A']!, {
    value_location: 'Main Level, Foyer',
    value_width_in: 96,
    value_length_in: 120,
    value_panel_count: 10,
    value_glass_type: 'GLASS_NO_IGU',
    value_frame_type: 'SERIES_1000_PEDESTAL',
    value_cross_beam: 'I_BEAM_TB',
  });
  Object.assign(schema.units['B']!, {
    value_location: 'Exterior deck skylights',
    value_width_in: 24,
    value_length_in: 48,
    value_panel_count: 3,
    value_glass_type: 'GLASS_WITH_IGU',
    value_frame_type: 'SERIES_2000_PEDESTAL',
    value_cross_beam: 'I_BEAM_TB',
  });
  Object.assign(schema.units['C']!, {
    value_location: 'Upper Floor Plan',
    value_glass_type: 'GLASS_WITH_IGU',
    value_frame_type: 'SERIES_2000_PEDESTAL',
    value_cross_beam: 'I_BEAM_TB',
  });
  return schema;
};

const fieldsOf = (result: ReturnType<typeof calculateFinalParameters>) =>
  result.categories.flatMap((category) => category.fields);

const visibleCells = (result: ReturnType<typeof calculateFinalParameters>, title: string) =>
  result.categories.find((category) => category.title === title)?.fields.map((item) => item.cell);

describe('Final Parameters per-unit pricing', () => {
  it('prices each unit with its own glass, frame and crossbeam', () => {
    const result = calculateFinalParameters(mixedUnitSchema(), COSTS);
    const byCell = (cell: string) => fieldsOf(result).find((item) => item.cell === cell);

    expect(visibleCells(result, 'Glass Types')).toEqual(['C9', 'C10']);
    expect(visibleCells(result, 'Framing')).toEqual(['C38', 'C41']);
    expect(visibleCells(result, 'Cross Beam')).toEqual(['C54', 'C58']);

    expect(byCell('C9')).toMatchObject({
      quantity: 80,
      amount: 5860.8,
      units: [{ unitKey: 'A', quantity: 80, amount: 5860.8, quantityOverridden: false }],
    });
    expect(byCell('C10')).toMatchObject({
      quantity: 8,
      amount: 994.56,
      units: [
        { unitKey: 'B', quantity: 8, amount: 994.56 },
        { unitKey: 'C', quantity: null, amount: null },
      ],
    });
    expect(byCell('C38')).toMatchObject({ quantity: 36, amount: 1261.44, units: [{ unitKey: 'A', quantity: 36 }] });
    expect(byCell('C41')).toMatchObject({ quantity: 12, amount: 428.16 });
    expect(byCell('C54')).toMatchObject({ quantity: 72, amount: 3059.28, units: [{ unitKey: 'A', quantity: 72 }] });
    expect(byCell('C58')).toMatchObject({ quantity: 4, amount: 164 });
    // Waste is 10% of framing + crossbeam: (1261.44 + 428.16 + 3059.28 + 164) × 0.1
    expect(byCell('C61')).toMatchObject({ amount: 491.29 });
  });

  it('applies a quantity edit to that unit\'s line only', () => {
    const schema = mixedUnitSchema();
    const result = calculateFinalParameters(schema, COSTS, { 'C10:B': 10 });
    const glassWithIgu = fieldsOf(result).find((item) => item.cell === 'C10');

    expect(glassWithIgu).toMatchObject({
      quantity: 10,
      amount: 1243.2,
      units: [
        { unitKey: 'B', quantity: 10, amount: 1243.2, quantityOverridden: true },
        { unitKey: 'C', quantity: null, quantityOverridden: false },
      ],
    });
    expect(fieldsOf(result).find((item) => item.cell === 'C9')?.amount).toBe(5860.8);
  });

  it('keeps an older product-level quantity override as a single line', () => {
    const result = calculateFinalParameters(mixedUnitSchema(), COSTS, { C9: 95 });
    const glassNoIgu = fieldsOf(result).find((item) => item.cell === 'C9');

    expect(glassNoIgu).toMatchObject({ quantity: 95, amount: 6959.7 });
    expect(glassNoIgu?.units).toBeUndefined();
    expect(fieldsOf(result).find((item) => item.cell === 'C10')?.units).toHaveLength(2);
  });

  it('keeps project-level pricing when no unit has take-off dimensions', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type = field('GLASS_NO_IGU');
    schema.stage_5.calculated.total_sqft = field(50);
    schema.units['A']!.value_location = 'Roof';

    const result = calculateFinalParameters(schema, COSTS);
    const glass = fieldsOf(result).find((item) => item.cell === 'C9');

    expect(glass).toMatchObject({ quantity: 50, amount: 3663 });
    expect(glass?.units).toBeUndefined();
  });

  it('reads each unit\'s own take-off row even when an earlier unit has no dimensions', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.units['A']!.value_location = 'Roof';
    Object.assign(schema.units['B']!, { value_width_in: 24, value_length_in: 48 });
    schema.stage_6 = { status: 'READY_FOR_EXCEL', cells: { K115: 5, K116: 2 } };

    expect(calculateFinalParameters(schema, COSTS).metrics.rafterLf).toBe(4);
  });

  it('falls back to the Stage 6 crossbeam flag in the unit\'s own column', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_3.decision.frame_type = field('SERIES_2000_PEDESTAL');
    Object.assign(schema.units['A']!, { value_width_in: 96, value_length_in: 84, value_panel_count: 2 });
    schema.stage_6 = { status: 'READY_FOR_EXCEL', cells: { D58: 'y' } };

    const result = calculateFinalParameters(schema, COSTS);

    expect(visibleCells(result, 'Cross Beam')).toEqual(['C58']);
    expect(fieldsOf(result).find((item) => item.cell === 'C58')).toMatchObject({ quantity: 8, amount: 328 });
  });
});

describe('isUnitQuantityOverrideKey', () => {
  it('accepts a glass, frame or crossbeam cell with a unit letter A-J', () => {
    expect(['C10:B', 'C38:A', 'C58:J'].every(isUnitQuantityOverrideKey)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(['C10', 'C10:K', 'C10:b', 'C62:A', 'C99:A', 'C10:A:B', ':A'].some(isUnitQuantityOverrideKey)).toBe(false);
  });
});

describe('Pricing Worksheet matches Final Parameters per unit', () => {
  const UNIT_BLOCKS = [
    { flag: 'D', qty: 'E', amount: 'F', takeoffRow: 115, unit: 'A' },
    { flag: 'G', qty: 'H', amount: 'I', takeoffRow: 116, unit: 'B' },
    { flag: 'J', qty: 'K', amount: 'L', takeoffRow: 117, unit: 'C' },
  ];
  const PRODUCT_ROWS = [
    { row: 9, label: 'Glass - no IGU', takeoff: 'H' },
    { row: 10, label: 'Glass - with IGU', takeoff: 'H' },
    { row: 38, label: 'Series 1000 Pedestal thermally broken ', takeoff: 'I' },
    { row: 41, label: 'Series 2000 Pedestal', takeoff: 'I' },
    { row: 54, label: 'Series 1000 I - Beam thermally broken', takeoff: 'N' },
    { row: 58, label: 'Series 2000 I beam thermally broken', takeoff: 'N' },
  ];

  // Same product and take-off formulas as the production Pricing Worksheet, for units A-C.
  const buildTemplate = async (): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pricing Worksheet');
    for (const { row, label, takeoff } of PRODUCT_ROWS) {
      sheet.getCell(`B${row}`).value = label;
      sheet.getCell(`C${row}`).value = COSTS[`C${row}`]!;
      for (const block of UNIT_BLOCKS) {
        const source = `$${takeoff}$${block.takeoffRow}`;
        sheet.getCell(`${block.qty}${row}`).value = {
          formula: takeoff === 'N'
            ? `ROUND(IF(${block.flag}${row}="y",${source},0)/12, 2)`
            : `IF(${block.flag}${row}="y", ROUND(${source}, 2), 0)`,
        } as any;
        sheet.getCell(`${block.amount}${row}`).value = { formula: `ROUND(${block.qty}${row}*$C${row}, 2)` } as any;
      }
    }
    for (const [address, label] of Object.entries({ B84: 'Sub Total', B92: 'TOTAL', B95: 'FINAL PRICE', B96: 'Unit Cost - $ per Sq. Ft', B113: 'Inches', B114: 'Location', D114: 'Unit' })) {
      sheet.getCell(address).value = label;
    }
    for (const { takeoffRow: r, unit } of UNIT_BLOCKS) {
      sheet.getCell(`D${r}`).value = unit;
      sheet.getCell(`H${r}`).value = { formula: `ROUND(SUM(E${r}*F${r})/144, 2)` } as any;
      sheet.getCell(`I${r}`).value = { formula: `ROUND(SUM((E${r}*2)+(F${r}*2))/ 12, 2)` } as any;
      sheet.getCell(`N${r}`).value = { formula: `ROUND((K${r}*E${r})+(L${r}*F${r}), 2)` } as any;
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };

  // Evaluates the generated sheet's formulas the way Excel would.
  const evaluate = async (buffer: Buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Pricing Worksheet')!;
    const data: (string | number | null)[][] = [];
    for (let r = 1; r <= 125; r++) {
      const row: (string | number | null)[] = [];
      for (let c = 1; c <= 34; c++) {
        const value = sheet.getCell(r, c).value as any;
        if (value && typeof value === 'object' && 'formula' in value) row.push(`=${value.formula}`);
        else row.push(typeof value === 'number' || typeof value === 'string' ? value : null);
      }
      data.push(row);
    }
    const hf = HyperFormula.buildFromSheets({ 'Pricing Worksheet': data }, { licenseKey: 'gpl-v3' });
    const sheetId = hf.getSheetId('Pricing Worksheet')!;
    const read = (address: string) => {
      const match = /^([A-Z]+)(\d+)$/.exec(address)!;
      const col = match[1]!.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      return hf.getCellValue({ sheet: sheetId, row: Number(match[2]) - 1, col });
    };
    return { sheet, read };
  };

  afterAll(() => invalidateTemplateBufferCache());

  const expectWorkbookToMatch = async (quantityOverrides: Record<string, number>) => {
    const schema = mixedUnitSchema();
    const calculation = calculateFinalParameters(schema, COSTS, quantityOverrides);
    setCachedTemplateBuffer(await buildTemplate());
    const { sheet, read } = await evaluate(await generateProposalExcelLocally(schema, 'GFS-TEST', 'Estimator', calculation));

    const productFields = fieldsOf(calculation).filter((item) => item.units);
    expect(productFields.map((item) => item.cell)).toEqual(['C9', 'C10', 'C38', 'C41', 'C54', 'C58']);
    for (const item of productFields) {
      const row = item.cell.slice(1);
      for (const line of item.units!) {
        const block = UNIT_BLOCKS.find((candidate) => candidate.unit === line.unitKey)!;
        expect(sheet.getCell(`${block.flag}${row}`).value).toBe('y');
        expect(read(`${block.amount}${row}`)).toBe(line.amount ?? 0);
      }
    }
    // Unit A is not flagged on unit B's glass row, and vice versa.
    expect(sheet.getCell('G9').value).toBeNull();
    expect(sheet.getCell('D10').value).toBeNull();
  };

  it('stamps each unit\'s own product rows and prices them the same as the screen', async () => {
    await expectWorkbookToMatch({});
  });

  it('writes a per-unit quantity edit into that unit\'s quantity cell', async () => {
    await expectWorkbookToMatch({ 'C10:B': 10 });
  });
});
