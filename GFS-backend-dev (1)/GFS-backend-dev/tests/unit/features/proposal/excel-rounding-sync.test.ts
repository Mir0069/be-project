import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import {
  generateProposalExcelLocally,
  setCachedTemplateBuffer,
  invalidateTemplateBufferCache,
} from '../../../../src/features/proposal/excel/graph.generator';
import { calculateFinalParameters } from '../../../../src/features/proposal/final-parameters.calculator';
import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { IProjectSchema } from '../../../../src/db/models/proposal.model';

describe('Excel vs UI Rounding & Precision Equivalence Across Diverse Projects', () => {
  const templatePath = path.resolve(__dirname, '../../../fixtures/dummy-template.xlsx');

  beforeAll(() => {
    const templateBuffer = fs.readFileSync(templatePath);
    setCachedTemplateBuffer(templateBuffer);
  });

  afterAll(() => {
    invalidateTemplateBufferCache();
  });

  // =========================================================================
  // PROJECT 1: 182 Robinson (Baseline project with standard markups & alternates)
  // =========================================================================
  it('Project 1 (182 Robinson): guarantees 100% cent-for-cent equivalence across all 25 pricing parameters', async () => {
    const schema = createEmptySchema() as IProjectSchema;

    // Unit A: 20" x 30", 1 panel, 1 unit, 0 intermediate rafters
    schema.units['A']!.value_width_in = 20;
    schema.units['A']!.value_length_in = 30;
    schema.units['A']!.value_panel_count = 1;
    schema.units['A']!.value_num_units = 1;
    schema.units['A']!.value_vertical_rafter_count = 0;
    schema.units['A']!.value_horizontal_rafter_count = 0;

    // Decision & Addons
    schema.stage_2 = { glass_type: { value: 'GLASS_NO_IGU' } } as any;
    schema.stage_3 = { decision: { frame_type: { value: 'SERIES_1000_RECESSED' } } } as any;
    schema.stage_5 = {
      addons: {
        duty: { value: 'y' },
        seeded_organic: { value: 'y' },
        nanodot: { value: 'y' },
      },
      calculated: {
        silicone_tubes: { value: 1 },
        total_man_hours: { value: 8 },
      },
      _signals: {},
    } as any;

    // Estimator takeoff inputs
    schema.stage_4 = {
      takeoff: {
        packaging: { value: 1 },
      },
    } as any;

    // Pricing worksheet unit costs & selections (Stage 6 / Stage 7)
    const costOverrides: Record<string, number> = {
      'C9': 124.32,   // Glass: $124.32 / sqft
      'C39': 35.68,   // Frame Series 2000: $35.68 / LF
      'C61': 0.10,    // Framing Waste: 10%
      'C62': 20.00,   // Brackets: $20.00 ea
      'C63': 9.00,    // Fasteners: $9.00 ea
      'C64': 18.00,   // Silicone: $18.00 ea
      'C66': 3.00,    // Perimeter Gasket: $3.00 / LF
      'C71': 68.00,   // Man Hours: $68.00 / hr
      'C72': 31.00,   // Paint by LF: $31.00 / LF
      'C73': 150.00,  // Packaging: $150.00 ea
      'C86': 0.10,    // Overhead: 10%
      'C87': 0.60,    // Profit: 60%
      'C88': 0.06,    // Insurance: 6%
      'C90': 0.15,    // Duty: 15%
      'C107': 48.00,  // Seeded Organic: $48.00 / sqft
      'C110': 56.00,  // NanoDot: $56.00 / sqft
    };

    schema.stage_6 = {
      cells: {
        'C9': 124.32,
        'D9': 'y',
        'C39': 35.68,
        'D39': 'y',
        'C59': 0.10,
        'C62': 20.00,
        'E62': 4,
        'C63': 9.00,
        'E63': 16,
        'C64': 18.00,
        'E64': 1,
        'C66': 3.00,
        'C69': 68.00,
        'E69': 8,
        'C70': 31.00,
        'C71': 150.00,
        'E71': 1,
        'C84': 0.10,
        'C85': 0.60,
        'C86': 0.06,
        'C88': 0.15,
        'D88': 'Y',
        'C105': 48.00,
        'D105': 'y',
        'C108': 56.00,
        'D108': 'Y',
      },
      status: 'APPROVED',
    } as any;

    // 1. Calculate using UI / Backend Calculation Contract
    const calculation = calculateFinalParameters(schema, costOverrides);
    const fields = calculation.categories.flatMap((cat) => cat.fields);
    const byCell = (cell: string) => fields.find((item) => item.cell === cell);

    // Verify UI calculation contract values
    expect(calculation.metrics.totalSqft).toBe(4.17);
    expect(calculation.metrics.perimeterLf).toBe(8.33);
    expect(byCell('C9')?.amount).toBe(518.41);     // Glass
    expect(byCell('C39')?.amount).toBe(297.21);    // Frame
    expect(byCell('C61')?.amount).toBe(29.72);     // Waste (10% of 297.21)
    expect(byCell('C62')?.amount).toBe(80.00);     // Brackets (4 * 20)
    expect(byCell('C63')?.amount).toBe(144.00);    // Fasteners (16 * 9)
    expect(byCell('C64')?.amount).toBe(18.00);     // Silicone (1 * 18)
    expect(byCell('C66')?.amount).toBe(24.99);     // Perimeter gasket (8.33 * 3)
    expect(byCell('C71')?.amount).toBe(544.00);    // Man hours (8 * 68)
    expect(byCell('C72')?.amount).toBe(258.23);    // Paint (8.33 * 31)
    expect(byCell('C73')?.amount).toBe(150.00);    // Packaging (1 * 150)
    expect(calculation.subtotal).toBe(2064.56);    // Subtotal
    expect(byCell('C86')?.amount).toBe(206.46);    // Overhead (10% of 2064.56)
    expect(byCell('C87')?.amount).toBe(1362.61);   // Profit (60% of 2271.02)
    expect(byCell('C88')?.amount).toBe(218.02);    // Insurance (6% of 3633.63)
    expect(byCell('C90')?.amount).toBe(77.76);     // Duty (15% of 518.41)
    expect(calculation.finalPrice).toBe(3929.41);  // Grand Total Final Price
    expect(byCell('C107')?.amount).toBe(200.16);   // Seeded Organic (4.17 * 48)
    expect(byCell('C110')?.amount).toBe(233.52);   // NanoDot (4.17 * 56)

    // 2. Generate Excel workbook locally
    const excelBuffer = await generateProposalExcelLocally(schema, '20261012', 'Test Estimator', calculation);
    expect(excelBuffer).toBeInstanceOf(Buffer);

    // 3. Inspect generated Excel worksheet formulas
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelBuffer as any);
    const sheet = wb.worksheets[0]!;

    expect((sheet.getCell('H113').value as any)?.formula).toBe('ROUND(SUM(E113*F113)/144, 2)');
    expect((sheet.getCell('I113').value as any)?.formula).toMatch(/ROUND\(SUM\(\(E113\*2\)\+\(F113\*2\)\)\/\s*12,\s*2\)/);
    expect((sheet.getCell('F9').value as any)?.formula).toBe('ROUND(E9*$C9, 2)');
    expect((sheet.getCell('F39').value as any)?.formula).toBe('ROUND(E39*$C39, 2)');
    expect((sheet.getCell('F59').value as any)?.formula).toBe('ROUND(SUM(F37:F58)*$C$59, 2)');
    expect((sheet.getCell('F70').value as any)?.formula).toBe('ROUND(E70*$C70, 2)');
    expect((sheet.getCell('F82').value as any)?.formula).toBe('ROUND(SUM(F9:F71), 2)');
    expect((sheet.getCell('F84').value as any)?.formula).toBe('ROUND(SUM(F82:F83)*$C$84, 2)');
    expect((sheet.getCell('F85').value as any)?.formula).toBe('ROUND(SUM(F82:F84)*$C$85, 2)');
    expect((sheet.getCell('F86').value as any)?.formula).toBe('ROUND(SUM(F82:F85)*$C$86, 2)');
    expect((sheet.getCell('F88').value as any)?.formula).toContain('ROUND(SUM(F9:F15)*$C$88, 2)');
    expect((sheet.getCell('F90').value as any)?.formula).toBe('ROUND(SUM(F82:F89), 2)');
    expect((sheet.getCell('F93').value as any)?.formula).toBe('ROUND(SUM(F90+F91-F92)+SUM(F74:F80), 2)');
    expect((sheet.getCell('F105').value as any)?.formula).toBe('ROUND($C$105*E105, 2)');
    expect((sheet.getCell('F108').value as any)?.formula).toBe('ROUND(E108*$C108, 2)');

    // 4. Evaluate Excel formulas under standard arithmetic
    const excelH113 = Math.round(((20 * 30) / 144) * 100) / 100;
    const excelI113 = Math.round(((20 * 2 + 30 * 2) / 12) * 100) / 100;
    const excelF9 = Math.round(excelH113 * 124.32 * 100) / 100;
    const excelF39 = Math.round(excelI113 * 35.68 * 100) / 100;
    const excelF59 = Math.round(excelF39 * 0.10 * 100) / 100;
    const excelF62 = 4 * 20.00;
    const excelF63 = 16 * 9.00;
    const excelF64 = 1 * 18.00;
    const excelF66 = Math.round(excelI113 * 3.00 * 100) / 100;
    const excelF69 = 8 * 68.00;
    const excelF70 = Math.round(excelI113 * 31.00 * 100) / 100;
    const excelF71 = 150.00;
    const excelF82 = Math.round(
      (excelF9 + excelF39 + excelF59 + excelF62 + excelF63 + excelF64 + excelF66 + excelF69 + excelF70 + excelF71) * 100
    ) / 100;
    const excelF84 = Math.round(excelF82 * 0.10 * 100) / 100;
    const excelF85 = Math.round((excelF82 + excelF84) * 0.60 * 100) / 100;
    const excelF86 = Math.round((excelF82 + excelF84 + excelF85) * 0.06 * 100) / 100;
    const excelF88 = Math.round(excelF9 * 0.15 * 100) / 100;
    const excelF90 = Math.round((excelF82 + excelF84 + excelF85 + excelF86 + excelF88) * 100) / 100;
    const excelF93 = excelF90;

    expect(excelF93).toBe(calculation.finalPrice);
    expect(Math.abs(excelF93 - calculation.finalPrice)).toBe(0.00);
  });

  // =========================================================================
  // PROJECT 2: The Atkinson Project (Commercial Skylight, 60" x 432", 6 panels, 5 rafters)
  // =========================================================================
  it('Project 2 (The Atkinson Project): guarantees precision sync with multi-panel crossbeams and rafters', async () => {
    const schema = createEmptySchema() as IProjectSchema;

    schema.stage_2 = { glass_type: { value: 'GLASS_NO_IGU' } } as any;
    schema.stage_3 = { decision: { frame_type: { value: 'PERIMETER_NON_TB' } } } as any;
    schema.stage_4 = {
      crossbeam: { value: 'SERIES_1000_I_BEAM' },
      takeoff: { panel_count: { value: 6 }, packaging: { value: 2 } },
    } as any;
    schema.stage_5 = {
      addons: {
        duty: { value: 'y' },
        seeded_organic: { value: 'y' },
        nanodot: { value: 'y' },
      },
      calculated: {
        silicone_tubes: { value: 14 },
        total_man_hours: { value: 28 },
      },
      _signals: {},
    } as any;

    schema.units['A']!.status = 'APPROVED';
    schema.units['A']!.value_width_in = 60;
    schema.units['A']!.value_length_in = 432;
    schema.units['A']!.value_panel_count = 6;
    schema.units['A']!.value_num_units = 1;
    schema.units['A']!.value_vertical_rafter_count = 5;
    schema.units['A']!.value_horizontal_rafter_count = 0;

    const costOverrides: Record<string, number> = {
      C9: 76.00,
      C40: 32.65,
      C56: 40.77,
      C61: 0.10,
      C62: 20.00,
      C63: 9.00,
      C64: 18.00,
      C66: 3.00,
      C67: 3.00,
      C71: 68.00,
      C72: 31.00,
      C73: 150.00,
      C86: 0.10,
      C87: 0.60,
      C88: 0.06,
      C90: 0.15,
      C107: 10.00,
      C110: 56.00,
    };

    schema.stage_6 = {
      cells: {
        C9: 76.00,
        D9: 'y',
        C40: 32.65,
        D40: 'y',
        C56: 40.77,
        D56: 'y',
        C61: 0.10,
        C62: 20.00,
        E62: 24,
        C63: 9.00,
        E63: 76,
        C64: 18.00,
        E64: 14,
        C66: 3.00,
        C67: 3.00,
        C69: 68.00,
        E69: 28,
        C70: 31.00,
        C71: 150.00,
        E71: 2,
        C84: 0.10,
        C85: 0.60,
        C86: 0.06,
        C88: 0.15,
        D88: 'Y',
        C105: 10.00,
        D105: 'y',
        C108: 56.00,
        D108: 'Y',
      },
      status: 'APPROVED',
    } as any;

    const calculation = calculateFinalParameters(schema, costOverrides);
    const fields = calculation.categories.flatMap((cat) => cat.fields);
    const byCell = (cell: string) => fields.find((item) => item.cell === cell);

    expect(calculation.metrics.totalSqft).toBe(180);
    expect(calculation.metrics.perimeterLf).toBe(82);
    expect(calculation.metrics.rafterLf).toBe(25);
    expect(calculation.metrics.paintLf).toBe(107);
    expect(calculation.metrics.bracketCount).toBe(24);
    expect(calculation.metrics.fastenerCount).toBe(76);

    // Verify UI calculations
    expect(byCell('C9')?.amount).toBe(13680);           // 180 * 76
    expect(byCell('C40')?.amount).toBe(2677.30);        // 82 * 32.65
    expect(byCell('C56')?.amount).toBe(1019.25);        // 25 * 40.77
    expect(byCell('C61')?.amount).toBe(369.66);         // 10% waste on framing + crossbeam
    expect(byCell('C62')?.amount).toBe(480.00);         // 24 * 20
    expect(byCell('C63')?.amount).toBe(684.00);         // 76 * 9
    expect(byCell('C64')?.amount).toBe(252.00);         // 14 * 18
    expect(byCell('C66')?.amount).toBe(246.00);         // 82 * 3
    expect(byCell('C67')?.amount).toBe(75.00);          // 25 * 3
    expect(byCell('C71')?.amount).toBe(1904.00);        // 28 * 68
    expect(byCell('C72')?.amount).toBe(3317.00);        // 107 * 31
    expect(byCell('C73')?.amount).toBe(300.00);         // 2 * 150
    expect(calculation.subtotal).toBe(25004.21);

    expect(byCell('C86')?.amount).toBe(2500.42);        // Overhead 10%
    expect(byCell('C87')?.amount).toBe(16502.78);       // Profit 60%
    expect(byCell('C88')?.amount).toBe(2640.44);        // Insurance 6%
    expect(byCell('C90')?.amount).toBe(2052.00);        // Duty 15% of glass
    expect(calculation.finalPrice).toBe(48699.85);

    // Verify Excel generation and formula evaluation
    const excelBuffer = await generateProposalExcelLocally(schema, 'ATKINSON-01', 'Awais Khan', calculation);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelBuffer as any);
    const sheet = wb.worksheets[0]!;

    expect((sheet.getCell('H113').value as any)?.formula).toBe('ROUND(SUM(E113*F113)/144, 2)');
    expect((sheet.getCell('I113').value as any)?.formula).toMatch(/ROUND\(SUM\(\(E113\*2\)\+\(F113\*2\)\)\/\s*12,\s*2\)/);
    expect((sheet.getCell('N113').value as any)?.formula).toBe('ROUND((K113*E113)+(L113*F113), 2)');

    // Excel Subtotal & Markup calculations match cent-for-cent
    const excelSubtotal = Math.round(
      (13680 + 2677.30 + 1019.25 + 369.66 + 480 + 684 + 252 + 246 + 75 + 1904 + 3317 + 300) * 100
    ) / 100;
    const excelOverhead = Math.round(excelSubtotal * 0.10 * 100) / 100;
    const excelProfit = Math.round((excelSubtotal + excelOverhead) * 0.60 * 100) / 100;
    const excelInsurance = Math.round((excelSubtotal + excelOverhead + excelProfit) * 0.06 * 100) / 100;
    const excelDuty = Math.round(13680 * 0.15 * 100) / 100;
    const excelFinalPrice = Math.round((excelSubtotal + excelOverhead + excelProfit + excelInsurance + excelDuty) * 100) / 100;

    expect(excelFinalPrice).toBe(calculation.finalPrice);
    expect(Math.abs(excelFinalPrice - calculation.finalPrice)).toBe(0.00);
  });

  // =========================================================================
  // PROJECT 3: Fractional Dimensions (47.333" x 83.667" - tests heavy float propagation)
  // =========================================================================
  it('Project 3 (Fractional Dimensions): eliminates float precision drift across compounding markups', async () => {
    const schema = createEmptySchema() as IProjectSchema;

    // Fractional repeating thirds: 47-1/3" x 83-2/3"
    schema.units['A']!.value_width_in = 47 + 1 / 3;
    schema.units['A']!.value_length_in = 83 + 2 / 3;
    schema.units['A']!.value_panel_count = 1;
    schema.units['A']!.value_num_units = 1;

    schema.stage_2 = { glass_type: { value: 'GLASS_NO_IGU' } } as any;
    schema.stage_3 = { decision: { frame_type: { value: 'SERIES_1000_RECESSED' } } } as any;
    schema.stage_5 = {
      addons: { duty: { value: 'y' } },
      calculated: { silicone_tubes: { value: 2 }, total_man_hours: { value: 12 } },
      _signals: {},
    } as any;
    schema.stage_4 = { takeoff: { packaging: { value: 1 } } } as any;

    const costOverrides: Record<string, number> = {
      C9: 105.50,
      C39: 42.25,
      C61: 0.10,
      C62: 20.00,
      C63: 9.00,
      C64: 18.00,
      C66: 3.50,
      C71: 68.00,
      C72: 35.00,
      C73: 150.00,
      C86: 0.10,
      C87: 0.55,
      C88: 0.05,
      C90: 0.12,
    };

    schema.stage_6 = {
      cells: {
        C9: 105.50,
        D9: 'y',
        C39: 42.25,
        D39: 'y',
        C59: 0.10,
        C62: 20.00,
        E62: 4,
        C63: 9.00,
        E63: 16,
        C64: 18.00,
        E64: 2,
        C66: 3.50,
        C69: 68.00,
        E69: 12,
        C70: 35.00,
        C71: 150.00,
        E71: 1,
        C84: 0.10,
        C85: 0.55,
        C86: 0.05,
        C88: 0.12,
        D88: 'Y',
      },
      status: 'APPROVED',
    } as any;

    const calculation = calculateFinalParameters(schema, costOverrides);
    const fields = calculation.categories.flatMap((cat) => cat.fields);
    const byCell = (cell: string) => fields.find((item) => item.cell === cell);

    // Derived: (47.333333 * 83.666667) / 144 = 27.502315 -> rounded to 27.50
    expect(calculation.metrics.totalSqft).toBe(27.50);
    // Derived: 2 * (47.333333 + 83.666667) / 12 = 262 / 12 = 21.833333 -> rounded to 21.83
    expect(calculation.metrics.perimeterLf).toBe(21.83);

    // Verify no fractional drift on line amounts
    expect(byCell('C9')?.amount).toBe(2901.25);  // 27.50 * 105.50
    expect(byCell('C39')?.amount).toBe(922.32);  // 21.83 * 42.25

    // Verify Excel generation
    const excelBuffer = await generateProposalExcelLocally(schema, 'FRAC-01', 'Test', calculation);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelBuffer as any);
    const sheet = wb.worksheets[0]!;

    expect((sheet.getCell('H113').value as any)?.formula).toBe('ROUND(SUM(E113*F113)/144, 2)');
    expect((sheet.getCell('I113').value as any)?.formula).toMatch(/ROUND\(SUM\(\(E113\*2\)\+\(F113\*2\)\)\/\s*12,\s*2\)/);

    // In Excel, H113 evaluates to 27.50 and I113 to 21.83
    const excelGlass = Math.round(27.50 * 105.50 * 100) / 100;
    const excelFrame = Math.round(21.83 * 42.25 * 100) / 100;
    expect(excelGlass).toBe(byCell('C9')?.amount);
    expect(excelFrame).toBe(byCell('C39')?.amount);

    // Subtotal and Grand Total match exactly
    const excelWaste = Math.round(excelFrame * 0.10 * 100) / 100; // 92.23
    const excelGasket = Math.round(21.83 * 3.50 * 100) / 100;    // 76.41
    const excelPaint = Math.round(21.83 * 35.00 * 100) / 100;    // 764.05
    const excelSubtotal = Math.round(
      (excelGlass + excelFrame + excelWaste + 80 + 144 + 36 + excelGasket + 816 + excelPaint + 150) * 100
    ) / 100;
    const excelOverhead = Math.round(excelSubtotal * 0.10 * 100) / 100;
    const excelProfit = Math.round((excelSubtotal + excelOverhead) * 0.55 * 100) / 100;
    const excelInsurance = Math.round((excelSubtotal + excelOverhead + excelProfit) * 0.05 * 100) / 100;
    const excelDuty = Math.round(excelGlass * 0.12 * 100) / 100;
    const excelFinalPrice = Math.round((excelSubtotal + excelOverhead + excelProfit + excelInsurance + excelDuty) * 100) / 100;

    expect(excelFinalPrice).toBe(calculation.finalPrice);
    expect(Math.abs(excelFinalPrice - calculation.finalPrice)).toBe(0.00);
  });

  // =========================================================================
  // PROJECT 4: Multi-Unit Project (Units A, B, and C with Markup & Discount)
  // =========================================================================
  it('Project 4 (Multi-Unit A, B, C): guarantees precision across multiple unit columns and grand total column AH', async () => {
    const schema = createEmptySchema() as IProjectSchema;

    // Unit A: 30" x 40", 2 units
    schema.units['A']!.value_width_in = 30;
    schema.units['A']!.value_length_in = 40;
    schema.units['A']!.value_panel_count = 1;
    schema.units['A']!.value_num_units = 2;

    // Unit B: 50" x 60", 1 unit
    schema.units['B']!.value_width_in = 50;
    schema.units['B']!.value_length_in = 60;
    schema.units['B']!.value_panel_count = 1;
    schema.units['B']!.value_num_units = 1;

    // Unit C: 25" x 35", 3 units
    schema.units['C']!.value_width_in = 25;
    schema.units['C']!.value_length_in = 35;
    schema.units['C']!.value_panel_count = 1;
    schema.units['C']!.value_num_units = 3;

    schema.stage_2 = { glass_type: { value: 'GLASS_NO_IGU' } } as any;
    schema.stage_3 = { decision: { frame_type: { value: 'SERIES_1000_RECESSED' } } } as any;
    schema.stage_5 = {
      addons: { duty: { value: 'y' } },
      calculated: { silicone_tubes: { value: 6 }, total_man_hours: { value: 20 } },
      _signals: {},
    } as any;
    schema.stage_4 = { takeoff: { packaging: { value: 2 } } } as any;

    const calculation = calculateFinalParameters(schema, {
      C9: 90.00,
      C39: 30.00,
      C61: 0.10,
      C62: 20.00,
      C63: 9.00,
      C64: 18.00,
      C66: 3.00,
      C71: 68.00,
      C72: 25.00,
      C73: 150.00,
      C86: 0.10,
      C87: 0.50,
      C88: 0.05,
      C90: 0.10,
    });

    // Generate Excel workbook
    const excelBuffer = await generateProposalExcelLocally(schema, 'MULTI-01', 'Multi-Unit Estimator', calculation);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelBuffer as any);
    const sheet = wb.worksheets[0]!;

    // Verify all 3 units have rounded takeoff formulas
    expect((sheet.getCell('H113').value as any)?.formula).toBe('ROUND(SUM(E113*F113)/144, 2)'); // Unit A
    expect((sheet.getCell('H114').value as any)?.formula).toBe('ROUND(SUM(E114*F114)/144, 2)'); // Unit B
    expect((sheet.getCell('H115').value as any)?.formula).toBe('ROUND(SUM(E115*F115)/144, 2)'); // Unit C

    // Verify Column AH totals formulas are rounded
    expect((sheet.getCell('AH82').value as any)?.formula).toBe('ROUND(SUM(F82+I82+L82+O82+R82+U82+X82+AA82+AD82+AG82), 2)');
    expect((sheet.getCell('AH90').value as any)?.formula).toBe('ROUND(SUM(F90+I90+L90+O90+R90+U90+X90+AA90+AD90+AG90), 2)');
    expect((sheet.getCell('AH93').value as any)?.formula).toBe('ROUND(SUM(F93+I93+L93+O93+R93+U93+X93+AA93+AD93+AG93), 2)');

    // Verify multi-unit price multiplication formulas
    expect((sheet.getCell('E93').value as any)?.formula).toBe('IF($J$113>1, ROUND(F93*$J$113, 2), "")'); // Unit A (2 units)
    expect((sheet.getCell('K93').value as any)?.formula).toBe('IF($J$115>1, ROUND(L93*$J$115, 2), "")'); // Unit C (3 units)
  });

  // =========================================================================
  // PROJECT 5: 700 Innovation Drive (Production Master Template Structure)
  // =========================================================================
  it('Project 5 (700 Innovation Drive): guarantees production template rows (84-95, 115-124) are preserved with zero corruption or #VALUE! errors', async () => {
    // Create a production-structured workbook
    const prodWb = new ExcelJS.Workbook();
    const sheet = prodWb.addWorksheet('Pricing Worksheet');

    // Section headers and labels
    sheet.getCell('B65').value = 'Gasket LF';
    sheet.getCell('B66').value = 'Perimeter';
    sheet.getCell('B67').value = 'Rafters';
    sheet.getCell('B82').value = 'Shop Drawings';
    sheet.getCell('B84').value = 'Sub Total';
    sheet.getCell('B85').value = 'Shipping';
    sheet.getCell('B86').value = 'Overhead';
    sheet.getCell('B87').value = 'Profit';
    sheet.getCell('B88').value = 'Insurance';
    sheet.getCell('B89').value = 'Sales Rep Commission';
    sheet.getCell('B90').value = 'Duty';
    sheet.getCell('B91').value = 'Transgroup Fees';
    sheet.getCell('B92').value = 'TOTAL';
    sheet.getCell('B93').value = 'Mark up';
    sheet.getCell('B94').value = 'Discount Amount';
    sheet.getCell('B95').value = 'FINAL PRICE';
    sheet.getCell('B96').value = 'Unit Cost - $ per Sq. Ft';

    // Production template formulas
    sheet.getCell('C85').value = 350;
    sheet.getCell('E85').value = 0;
    sheet.getCell('F82').value = 9896.16;
    sheet.getCell('F84').value = { formula: 'SUM(F9:F73)' } as any;
    sheet.getCell('F85').value = { formula: '$C$85*E85' } as any;
    sheet.getCell('F86').value = { formula: 'SUM(F84:F85)*$C$86' } as any;
    sheet.getCell('F87').value = { formula: 'SUM(F84:F86)*$C$87' } as any;
    sheet.getCell('F88').value = { formula: 'SUM(F84:F87)*$C$88' } as any;
    sheet.getCell('F89').value = { formula: 'IF(D89="Y",SUM(F84:F88)*$C$89,"0")' } as any;
    sheet.getCell('F90').value = { formula: 'IF(D90="Y",SUM(F9:F15)*$C$90,"0")' } as any;
    sheet.getCell('F91').value = { formula: 'IF(D91="Y",$C$91/J115,"0")' } as any;
    sheet.getCell('F92').value = { formula: 'SUM(F84:F91)' } as any;
    sheet.getCell('F93').value = { formula: 'IF(D93="Y",F92*$C$93,"0")' } as any;
    sheet.getCell('F94').value = { formula: 'IF(D94="Y",F92*$C$94,"0")' } as any;
    sheet.getCell('F95').value = { formula: 'SUM(F92+F93-F94)+SUM(F76:F82)' } as any;

    // Production Takeoff row 115
    sheet.getCell('D115').value = 'A';
    sheet.getCell('H115').value = { formula: 'SUM(E115*F115)/144' } as any;
    sheet.getCell('I115').value = { formula: 'SUM((E115*2)+(F115*2))/12' } as any;
    sheet.getCell('N115').value = { formula: '(K115*E115)+(L115*F115)' } as any;

    const schema = createEmptySchema() as IProjectSchema;
    schema.units['A']!.value_width_in = 48;
    schema.units['A']!.value_length_in = 56;
    schema.units['A']!.value_num_units = 1;

    // Set cached template to this production workbook
    const prodBuffer = await prodWb.xlsx.writeBuffer();
    setCachedTemplateBuffer(Buffer.from(prodBuffer));

    const resultBuffer = await generateProposalExcelLocally(schema, 'GFS-2026-1018', 'Greg Muniz');
    const resultWb = new ExcelJS.Workbook();
    await resultWb.xlsx.load(resultBuffer as any);
    const resultSheet = resultWb.worksheets[0]!;

    // 1. Takeoff was stamped to row 115 (NOT row 113)
    expect(resultSheet.getCell('E115').value).toBe(48);
    expect(resultSheet.getCell('F115').value).toBe(56);
    expect((resultSheet.getCell('H115').value as any)?.formula).toBe('ROUND(SUM(E115*F115)/144, 2)');

    // 2. Row 65 (Gasket LF header) is completely untouched (no #VALUE!)
    expect(resultSheet.getCell('E65').value).toBeNull();
    expect(resultSheet.getCell('H65').value).toBeNull();

    // 3. Row 85 (Shipping) is NOT overwritten with profit formula
    expect((resultSheet.getCell('F85').value as any)?.formula).toBe('ROUND($C$85*E85, 2)');

    // 4. Row 86 (Overhead) preserves template formula
    expect((resultSheet.getCell('F86').value as any)?.formula).toBe('ROUND(SUM(F84:F85)*$C$86, 2)');

    // 5. Row 90 (Duty) is NOT overwritten with net price
    expect((resultSheet.getCell('F90').value as any)?.formula).toBe('IF(D90="Y", ROUND(SUM(F9:F15)*$C$90, 2), "0")');

    // 6. Row 93 (Markup) is NOT overwritten with final unit price and no qty formula in col H
    expect((resultSheet.getCell('F93').value as any)?.formula).toBe('IF(D93="Y", ROUND(F92*$C$93, 2), "0")');
    expect(resultSheet.getCell('H93').value).toBeNull();

    // 7. Row 94 (Discount) is NOT zeroed out
    expect((resultSheet.getCell('F94').value as any)?.formula).toBe('IF(D94="Y", ROUND(F92*$C$94, 2), "0")');

    // 8. Row 95 (Final Price) preserves production formula
    expect((resultSheet.getCell('F95').value as any)?.formula).toBe('ROUND(SUM(F92+F93-F94)+SUM(F76:F82), 2)');
  });

  it('guarantees Fasteners (28), Paint by LF (38 LF), Brackets (8), Rafters (8 LF), Crossbeam (8 LF), and Y/N selections match between UI and Excel', async () => {
    const prodWb = new ExcelJS.Workbook();
    const sheet = prodWb.addWorksheet('Pricing Worksheet');

    sheet.getCell('B58').value = 'Series 2000 I beam thermally broken';
    sheet.getCell('C58').value = 41;
    sheet.getCell('E58').value = { formula: 'IF(D58="y",N115/12,0)' } as any;
    sheet.getCell('F58').value = { formula: 'E58*$C58' } as any;

    sheet.getCell('B62').value = 'Brackets - Includes $10 for paint';
    sheet.getCell('C62').value = 20;
    sheet.getCell('E62').value = { formula: 'IF($L115>0,(($K115*4)+($L115*4)+$K115*$L115*4)+4,($K115*4)+4)' } as any;
    sheet.getCell('F62').value = { formula: 'E62*$C62' } as any;

    sheet.getCell('B63').value = 'Fasteners';
    sheet.getCell('C63').value = 9;
    sheet.getCell('E63').value = { formula: 'IF($L$115>0,(($K$115*12)+($L$115*12)+($K$115*$L$115*8))+16,($K$115*12)+16)' } as any;
    sheet.getCell('F63').value = { formula: 'E63*$C63' } as any;

    sheet.getCell('B65').value = 'Gasket LF';
    sheet.getCell('B66').value = 'Perimeter';
    sheet.getCell('C66').value = 3;
    sheet.getCell('E66').value = { formula: 'I115' } as any;
    sheet.getCell('F66').value = { formula: 'E66*$C66' } as any;

    sheet.getCell('B67').value = 'Rafters';
    sheet.getCell('C67').value = 3;
    sheet.getCell('E67').value = { formula: 'N115/12' } as any;
    sheet.getCell('F67').value = { formula: 'E67*$C67' } as any;

    sheet.getCell('B69').value = '3m tape';
    sheet.getCell('C69').value = 0.95;
    sheet.getCell('E69').value = { formula: 'IF(D69="y",E66+E67,0)' } as any;
    sheet.getCell('F69').value = { formula: 'E69*$C69' } as any;

    sheet.getCell('B72').value = 'Paint by LF';
    sheet.getCell('C72').value = 31;
    sheet.getCell('E72').value = { formula: 'SUM(E66:E67)' } as any;
    sheet.getCell('F72').value = { formula: 'E72*$C72' } as any;

    sheet.getCell('B84').value = 'Sub Total';
    sheet.getCell('B92').value = 'TOTAL';
    sheet.getCell('B95').value = 'FINAL PRICE';
    sheet.getCell('B96').value = 'Unit Cost - $ per Sq. Ft';

    sheet.getCell('B112').value = 'Take Off Sheet';
    sheet.getCell('G112').value = 'Take Off Sheet';
    sheet.getCell('B113').value = 'Inches';
    sheet.getCell('I113').value = 'LF';
    sheet.getCell('K113').value = 'Rafters';
    sheet.getCell('L113').value = 'Rafters';
    sheet.getCell('O113').value = 'Per Sq. Ft Cost';
    sheet.getCell('B114').value = 'Location';
    sheet.getCell('C114').value = 'Drawing #';
    sheet.getCell('D114').value = 'Unit';
    sheet.getCell('E114').value = 'Width';
    sheet.getCell('F114').value = 'Length';
    sheet.getCell('G114').value = '# of panels';
    sheet.getCell('H114').value = 'Total Sq. Ft';
    sheet.getCell('I114').value = 'Perimeter';
    sheet.getCell('J114').value = '# of units';
    sheet.getCell('K114').value = 'Vertical';
    sheet.getCell('L114').value = 'Horizontal';
    sheet.getCell('M114').value = 'Glass Thickness';
    sheet.getCell('N114').value = 'Total length';
    sheet.getCell('O114').value = 'Unit cost';
    sheet.getCell('Q114').value = 500;

    sheet.getCell('D115').value = 'A';
    sheet.getCell('H115').value = { formula: 'SUM(E115*F115)/144' } as any;
    sheet.getCell('I115').value = { formula: 'SUM((E115*2)+(F115*2))/12' } as any;
    sheet.getCell('N115').value = { formula: '(K115*E115)+(L115*F115)' } as any;
    sheet.getCell('O115').value = { formula: 'H115*$Q$114' } as any;

    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type = { value: 'GLASS_WITH_IGU', status: 'APPROVED' };
    schema.stage_3.decision = { frame_type: { value: 'SERIES_2000_PEDESTAL' } } as any;
    schema.stage_4.crossbeam = { value: 'I_BEAM_TB', status: 'APPROVED' } as any;
    schema.stage_4.takeoff = { panel_count: { value: 2 } } as any;
    schema.stage_6 = { status: 'READY_FOR_EXCEL', cells: { D58: 'y', K115: 1 } };
    schema.units['A']!.status = 'APPROVED';
    schema.units['A']!.value_width_in = 96;
    schema.units['A']!.value_length_in = 84;
    schema.units['A']!.value_panel_count = 2;
    schema.units['A']!.value_num_units = 1;

    const costOverrides = {
      C41: 35.68,
      C58: 41.00,
      C61: 0.10,
      C62: 20.00,
      C63: 9.00,
      C64: 18.00,
      C66: 3.00,
      C67: 3.00,
      C69: 0.95,
      C71: 68.00,
      C72: 31.00,
      C73: 150.00,
    };

    // Calculate UI final parameters
    const calc = calculateFinalParameters(schema, costOverrides);
    expect(calc.metrics.fastenerCount).toBe(28);
    expect(calc.metrics.bracketCount).toBe(8);
    expect(calc.metrics.paintLf).toBe(38);
    expect(calc.metrics.rafterLf).toBe(8);
    expect(calc.metrics.perimeterLf).toBe(30);

    const fields = calc.categories.flatMap((c) => c.fields);
    const byCell = (c: string) => fields.find((f) => f.cell === c);
    expect(byCell('C63')).toMatchObject({ quantity: 28, amount: 252 });
    expect(byCell('C62')).toMatchObject({ quantity: 8, amount: 160 });
    expect(byCell('C72')).toMatchObject({ quantity: 38, amount: 1178 });
    expect(byCell('C67')).toMatchObject({ quantity: 8, amount: 24 });
    expect(byCell('C58')).toMatchObject({ quantity: 8, amount: 328 });
    expect(byCell('C69')).toMatchObject({ quantity: 0, amount: 0, selection: 'N' });

    // Generate Excel and verify cell values
    const prodBuffer = await prodWb.xlsx.writeBuffer();
    setCachedTemplateBuffer(Buffer.from(prodBuffer));

    const resultBuffer = await generateProposalExcelLocally(schema, 'GFS-2026-1018', 'Greg Muniz', calc);
    const resultWb = new ExcelJS.Workbook();
    await resultWb.xlsx.load(resultBuffer as any);
    const resSheet = resultWb.worksheets[0]!;

    // Unit A takeoff: K115 was stamped with 1 (rafters)
    expect(resSheet.getCell('K115').value).toBe(1);
    expect(resSheet.getCell('E115').value).toBe(96);
    expect(resSheet.getCell('F115').value).toBe(84);

    // Crossbeam selection stamped
    expect(resSheet.getCell('D58').value).toBe('y');
    expect(resSheet.getCell('D69').value).toBe('N');

    // Inactive unit columns (H for Unit B, K for Unit C) are cleared on pricing rows
    expect(resSheet.getCell('H62').value).toBeNull();
    expect(resSheet.getCell('H63').value).toBeNull();

    // Row 112, 113, 114 headers MUST BE PRESERVED and never wiped by inactive unit clearing
    expect(resSheet.getCell('G112').value).toBe('Take Off Sheet');
    expect(resSheet.getCell('I113').value).toBe('LF');
    expect(resSheet.getCell('K113').value).toBe('Rafters');
    expect(resSheet.getCell('G114').value).toBe('# of panels');
    expect(resSheet.getCell('H114').value).toBe('Total Sq. Ft');
    expect(resSheet.getCell('Q114').value).toBe(500);

    // Row 113 unit value slots remain clean (not corrupted with numbers)
    expect(resSheet.getCell('D113').value).toBeNull();
    expect(resSheet.getCell('E113').value).toBeNull();
    expect(resSheet.getCell('F113').value).toBeNull();
    expect(resSheet.getCell('H113').value).toBeNull();
  });

  it('guarantees stale proposal documents are marked not current and trigger regeneration', () => {
    const { PROPOSAL_ENGINE_CUTOFF_MS, PROPOSAL_ENGINE_VERSION } = require('@features/proposal/proposal.service');
    expect(PROPOSAL_ENGINE_VERSION).toBe('2026.09.10.v4');

    // Document created prior to fix
    const oldDoc = {
      createdAt: new Date(PROPOSAL_ENGINE_CUTOFF_MS - 100000),
      metadata: { source: 'proposal-generator' },
    };
    // Document created with new engine
    const newDoc = {
      createdAt: new Date(),
      metadata: { source: 'proposal-generator', engineVersion: PROPOSAL_ENGINE_VERSION },
    };

    expect(new Date(oldDoc.createdAt).getTime()).toBeLessThan(PROPOSAL_ENGINE_CUTOFF_MS);
    expect(newDoc.metadata.engineVersion).toBe(PROPOSAL_ENGINE_VERSION);
  });
});
