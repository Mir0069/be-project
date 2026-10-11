import ExcelJS from 'exceljs';
import {
  applyPricingWorksheetSelections,
  bakeComputedProposalValues,
  buildMergedCells,
  buildProposalUnitCells,
  estimateWrappedLines,
  reconcileBasePricing,
  setCachedStringKeepingFormula,
} from '../../../../src/features/proposal/excel/graph.generator';
import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { IProjectSchema } from '../../../../src/db/models/proposal.model';

describe('buildMergedCells', () => {
  it('injects the estimator man hours into E71 and packaging into E73', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_5.calculated.total_man_hours.value = 80;
    schema.stage_4.takeoff.packaging.value = 5;

    const merged = buildMergedCells(schema);

    expect(merged['E71']).toBe(80);
    expect(merged['E73']).toBe(5);
  });

  it('leaves E71 and E73 untouched when the estimator has not entered values', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_5.calculated.total_man_hours.value = null;
    schema.stage_4.takeoff.packaging.value = null;

    const merged = buildMergedCells(schema);

    expect(merged['E71']).toBeUndefined();
    expect(merged['E73']).toBeUndefined();
  });

  it('lets the estimator Parameters value override any AI stage_6 cell at E71', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_6 = { cells: { E71: 999, E64: 6 }, status: 'READY_FOR_EXCEL' };
    schema.stage_5.calculated.total_man_hours.value = 80;

    const merged = buildMergedCells(schema);

    expect(merged['E71']).toBe(80);
    expect(merged['E64']).toBe(6);
  });

  it('preserves stage_7 cost overrides alongside the injected takeoff values', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_7 = {
      status: 'APPROVED',
      cost_overrides: { C69: 68, C71: 150 },
    };
    schema.stage_5.calculated.total_man_hours.value = 80;
    schema.stage_4.takeoff.packaging.value = 5;

    const merged = buildMergedCells(schema);

    expect(merged['C69']).toBe(68);
    expect(merged['C71']).toBe(150);
    expect(merged['E71']).toBe(80);
    expect(merged['E73']).toBe(5);
  });

  it('merges stage_6 cells and stage_7 cost overrides as before', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_6 = { cells: { E11: 43.74, D90: 'y' }, status: 'READY_FOR_EXCEL' };
    schema.stage_7 = { status: 'APPROVED', cost_overrides: { C85: 0.6 } };

    const merged = buildMergedCells(schema);

    expect(merged['E11']).toBe(43.74);
    expect(merged['D90']).toBe('y');
    expect(merged['C85']).toBe(0.6);
  });

  it('injects manual stage 1 header fields (person_quoting, homeowner, drafter_designer, person_checked)', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_1.person_quoting.value = 'John Doe';
    schema.stage_1.homeowner.value = 'Jane Smith';
    schema.stage_1.drafter_designer.value = 'Alex Drafter';
    schema.stage_1.person_checked.value = 'Bob Checker';

    const merged = buildMergedCells(schema);

    expect(merged['L2']).toBe('John Doe');
    expect(merged['I4']).toBe('Jane Smith');
    expect(merged['L4']).toBe('Alex Drafter');
    expect(merged['P2']).toBe('Bob Checker');
  });

  it('stamps every customer phone number into the Excel contact cell', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_1.contact_phone.value = [
      '(801) 483-1660',
      '(801) 635-6312',
    ] as unknown as string;

    const merged = buildMergedCells(schema);

    expect(merged['I3']).toBe('(801) 483-1660\n(801) 635-6312');
  });

  it('stamps resolved Y/N selections and project-level charge quantities', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_7 = {
      status: 'PENDING',
      cost_overrides: { C75: 100, C76: 540, C81: 0.55, C85: 350 },
      additional_charge_selections: { C75: 'Y', C76: 'N', C81: 'Y', C85: 'Y' },
    };

    const calculation = {
      categories: [{
        title: 'Additional Charges',
        fields: [
          { cell: 'C75', label: 'Engineering', quantity: 1, amount: 100 },
          { cell: 'C76', label: 'Stamped Drawings', quantity: 0, amount: 0 },
          { cell: 'C81', label: 'Custom Upcharge (%)', quantity: null, amount: 55 },
          { cell: 'C85', label: 'Shipping', quantity: 1, amount: 350 },
        ],
      }],
      metrics: { totalSqft: 180 },
    } as any;

    const merged = buildMergedCells(schema, calculation);

    expect(merged['D75']).toBe('Y');
    expect(merged['D76']).toBe('N');
    expect(merged['D81']).toBe('Y');
    expect(merged['D85']).toBe('Y');
    expect(merged['E75']).toBe(1);
    expect(merged['E76']).toBe(0);
    expect(merged['E85']).toBe(1);
    expect(merged['F75']).toBe(100);
    expect(merged['F81']).toBe(55);
  });
});

describe('extractComputedProposalCells', () => {
  it('harvests literals, numbers and cached formula results, skipping K2', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Proposal');
    ws.getCell('B16').value = 'Once you receive your SkyFloor system...';
    ws.getCell('F23').value = 48;
    ws.getCell('E24').value = { formula: "Pricing!B118", result: 'Roof skylight' };
    ws.getCell('K2').value = { formula: 'Pricing!I2', result: 20261001 }; // must be skipped
    ws.getCell('Z999').value = 'beyond content';
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const { extractComputedProposalCells } = require('../../../../src/features/proposal/excel/graph.generator');
    const cells = await extractComputedProposalCells(buffer, 'Proposal');

    expect(cells['B16']).toBe('Once you receive your SkyFloor system...');
    expect(cells['F23']).toBe(48);
    expect(cells['E24']).toBe('Roof skylight'); // cached formula result
    expect(cells['K2']).toBeUndefined();        // skip-list enforced
  });

  it('returns an empty object when the target sheet does not exist', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Pricing Worksheet');
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const { extractComputedProposalCells } = require('../../../../src/features/proposal/excel/graph.generator');
    const cells = await extractComputedProposalCells(buffer, 'Proposal');

    expect(cells).toEqual({});
  });
});

describe('buildProposalUnitCells', () => {
  it('maps approved unit dimensions to Proposal rows', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.units['C']!.value_width_in = 54;
    schema.units['C']!.value_length_in = 46;
    schema.units['C']!.value_location = 'Curb mounted skylight';
    schema.units['C']!.extracted_citation = { pdf_name: 'Ernesto Caceres.pdf' } as any;

    expect(buildProposalUnitCells(schema)).toEqual({
      B25: 'C',
      C25: 'Ernesto Caceres.pdf',
      E25: 'Curb mounted skylight',
      F25: 54,
      H25: 46,
      G25: 'x',
    });
  });

  it('blanks a missing drawing/location instead of leaving the template formula (which printed 0)', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.units['A']!.value_width_in = 32;
    schema.units['A']!.value_length_in = 153;

    const cells = buildProposalUnitCells(schema);

    expect(cells['C23']).toBe('');
    expect(cells['E23']).toBe('');
  });

  it('ignores empty units', () => {
    const schema = createEmptySchema() as IProjectSchema;

    expect(buildProposalUnitCells(schema)).toEqual({});
  });
});

describe('per-unit man hours and descriptions in the generated workbook', () => {
  const twoUnitSchema = () => {
    const schema = createEmptySchema() as IProjectSchema;
    Object.assign(schema.units['A']!, { value_location: 'Foyer, Main Floor', value_width_in: 96, value_length_in: 120, value_panel_count: 10 });
    Object.assign(schema.units['B']!, { value_location: 'Deck Skylights', value_width_in: 24, value_length_in: 48, value_panel_count: 3 });
    schema.stage_5.calculated.total_man_hours.value = null;
    return schema;
  };

  it('keeps the AI Stage 6 row-71 hours for units with no value_man_hours instead of zeroing them', () => {
    const schema = twoUnitSchema();
    schema.stage_6 = { cells: { E71: 44, H71: 16 }, status: 'READY_FOR_EXCEL' };

    const merged = buildMergedCells(schema);

    expect(merged['E71']).toBe(44);
    expect(merged['H71']).toBe(16);
  });

  it('prefers the unit value_man_hours over the Stage 6 cell', () => {
    const schema = twoUnitSchema();
    schema.stage_6 = { cells: { E71: 44, H71: 16 }, status: 'READY_FOR_EXCEL' };
    schema.units['B']!.value_man_hours = 20;

    const merged = buildMergedCells(schema);

    expect(merged['E71']).toBe(44);
    expect(merged['H71']).toBe(20);
  });

  it('writes each unit description into Proposal column J from the unit, falling back to the Stage 6 proposal cell', () => {
    const schema = twoUnitSchema();
    schema.units['A']!.value_description = '(1 Qty.) 96" x 120" floor';
    schema.stage_6_proposal = {
      target_sheet: 'Proposal',
      status: 'READY_FOR_PROPOSAL_EXCEL',
      cells: { J23: 'stale A', J24: '(1 Qty.) 24" x 48" floor', J25: 'Description' },
    };

    const cells = buildProposalUnitCells(schema);

    expect(cells['J23']).toBe('(1 Qty.) 96" x 120" floor');
    expect(cells['J24']).toBe('(1 Qty.) 24" x 48" floor');
    expect(cells['J25']).toBeUndefined();
  });
});

describe('Base Pricing description caching', () => {
  // Base Pricing D80:D87 is one shared formula (=J23 ...). Graph's PDF export
  // prints cached results, so the description must be re-cached in the XML
  // without breaking the shared-formula master/clone link.
  const xml =
    '<row r="80"><c r="D80" s="370" t="str"><f t="shared" ref="D80:D87" si="0">J23</f><v>Description</v></c></row>' +
    '<row r="81"><c r="D81" s="374" t="str"><f t="shared" si="0"/><v>Description</v></c></row>' +
    '<row r="88"><c r="D88" s="374" t="s"><v>222</v></c></row>';

  it('re-caches a shared-formula clone as escaped text and keeps its formula', () => {
    const out = setCachedStringKeepingFormula(xml, 'D81', '(1 Qty.) 32" x 96" <floor> & more');
    expect(out).toContain('<c r="D81" s="374" t="str"><f t="shared" si="0"/><v>(1 Qty.) 32" x 96" &lt;floor&gt; &amp; more</v></c>');
    expect(out).toContain('<f t="shared" ref="D80:D87" si="0">J23</f><v>Description</v>');
  });

  it('leaves a cell without a formula untouched', () => {
    expect(setCachedStringKeepingFormula(xml, 'D88', 'x')).toBe(xml);
  });
});

describe('estimateWrappedLines', () => {
  it('counts greedy word-wrapped lines, splitting words longer than the box', () => {
    expect(estimateWrappedLines('Quote nº 158389 - Glass Flooring', 8)).toBe(4);
    expect(estimateWrappedLines('short', 20)).toBe(1);
    expect(estimateWrappedLines('abcdefghijkl', 5)).toBe(3);
    expect(estimateWrappedLines('', 5)).toBe(1);
  });
});

describe('Base Pricing per-unit amounts', () => {
  // The template ships sample cached results (417.89 in every unit's FINAL
  // PRICE cell). Nothing reliably recalculates them before the PDF export, so
  // every unit printed the same price. The bake must evaluate them fresh.
  it('replaces stale cached FINAL PRICE results with freshly evaluated per-unit amounts', async () => {
    const wb = new ExcelJS.Workbook();
    const pricing = wb.addWorksheet('Pricing Worksheet');
    const rates = wb.addWorksheet('Bonnell - Glass Pricing');
    const proposal = wb.addWorksheet('Proposal');

    rates.getCell('H14').value = 100;
    pricing.getCell('C38').value = { formula: "'Bonnell - Glass Pricing'!H14", result: 1 } as any;
    // Unit A = 10 sqft, Unit B = 4 sqft; FINAL PRICE = sqft * glass rate.
    pricing.getCell('H115').value = 10;
    pricing.getCell('H116').value = 4;
    pricing.getCell('J115').value = 1;
    pricing.getCell('J116').value = 2;
    pricing.getCell('F95').value = { formula: 'H115*C38', result: 417.8944 } as any;
    pricing.getCell('I95').value = { formula: 'H116*C38', result: 417.8944 } as any;

    proposal.getCell('J80').value = { formula: "'Pricing Worksheet'!F95*'Pricing Worksheet'!J115", result: 417.8944 } as any;
    proposal.getCell('J81').value = { formula: "'Pricing Worksheet'!I95*'Pricing Worksheet'!J116", result: 417.8944 } as any;
    proposal.getCell('J90').value = { formula: 'SUM(J80:J89)', result: 835.79 } as any;

    const baked = await bakeComputedProposalValues(Buffer.from(await wb.xlsx.writeBuffer()), 'Proposal');
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(baked as any);
    const sheet = out.getWorksheet('Proposal')!;
    const result = (address: string) => (sheet.getCell(address).value as any)?.result;

    expect(result('J80')).toBe(1000);
    expect(result('J81')).toBe(800);
    expect(result('J90')).toBe(1800);
    // Formulas stay live for anyone opening the workbook in Excel.
    expect((sheet.getCell('J80').value as any).formula).toBe("'Pricing Worksheet'!F95*'Pricing Worksheet'!J115");
  });
});

describe('reconcileBasePricing', () => {
  // Real project (1500 Clinton Ave): the workbook's per-unit rounding summed
  // to 35,850.58 while the approved Final Parameters price was 35,853.31.
  const workbook = { J80: 16684.31, J81: 10121.9, J82: 9044.37, J90: 35850.58 };

  it('scales the units to the approved final price so the cents add up exactly', () => {
    const out = reconcileBasePricing(workbook, 35853.31);
    expect(out['J90']).toBe(35853.31);
    expect(Math.round((out['J80']! + out['J81']! + out['J82']!) * 100)).toBe(3585331);
    // The workbook's split is kept — each unit moves by only its share of the drift.
    expect(out['J80']).toBeCloseTo(16685.58, 2);
    expect(out['J81']).toBeCloseTo(10122.67, 2);
    expect(out['J82']).toBeCloseTo(9045.06, 2);
  });

  it('leaves the workbook amounts alone without an approved price', () => {
    expect(reconcileBasePricing(workbook, undefined)).toEqual(workbook);
  });

  it('refuses to mask a real pricing difference beyond 1%', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(reconcileBasePricing(workbook, 40000)).toEqual(workbook);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('applyPricingWorksheetSelections', () => {
  it('stamps selection triggers on the exact worksheet rows for glass, frame, crossbeam, options, and accepted add-ons', () => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pricing Worksheet');

    // Setup mock template rows with labels in column B
    sheet.getCell('B9').value = 'Glass - no IGU';
    sheet.getCell('B10').value = 'Glass with IGU';
    sheet.getCell('B16').value = 'Sentry Glass interlayer';
    sheet.getCell('B17').value = 'Krypton Gas';
    sheet.getCell('B40').value = 'Series 2000 Pedestal';
    sheet.getCell('B41').value = 'Series 2000 Recessed';
    sheet.getCell('B52').value = 'Series 1000 I - Beam thermally broken';
    sheet.getCell('B53').value = 'Series 1000 T - Section ';
    sheet.getCell('B105').value = 'Seeded Organic';
    sheet.getCell('E105').value = { formula: 'IF(D105="y",H113*J113,0)' };
    sheet.getCell('B107').value = 'Heat Soak Testing ';
    sheet.getCell('E107').value = { formula: 'IF(D107="Y",H113*J113,0)' };
    sheet.getCell('B108').value = 'Nano Dot';
    sheet.getCell('E108').value = { formula: 'IF(D108="Y",H113*J113,0)' };

    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type = { value: 'GLASS_NO_IGU', status: 'APPROVED' } as any;
    schema.stage_3 = { decision: { frame_type: { value: 'SERIES_2000_PEDESTAL', status: 'APPROVED' } } } as any;
    schema.stage_4 = { crossbeam: { value: 'SERIES_1000_I_BEAM_TB', status: 'APPROVED' } } as any;
    schema.stage_5.addons = {
      sentry_glass: 'y',
      krypton_gas: 'n',
      duty: 'y',
      seeded_organic: 'y',
      heat_soak_testing: 'y',
      nanodot: 'n',
    } as any;
    schema.stage_7 = {
      optional_add_on_statuses: {
        C107: 'ACCEPTED',
        C109: 'ACCEPTED',
        C110: 'DECLINED',
      },
    } as any;
    schema.units['A'] = {
      ...schema.units['A'],
      status: 'APPROVED',
      value_width_in: 168,
      value_length_in: 384,
      value_panel_count: 5,
      value_num_units: 1,
    } as any;

    applyPricingWorksheetSelections(sheet, schema);

    // Unit A is column D:
    // Glass: row 9 should be 'y', row 10 should be null
    expect(sheet.getCell('D9').value).toBe('y');
    expect(sheet.getCell('D10').value).toBeNull();

    // Frame: row 40 should be 'y', row 41 should be null
    expect(sheet.getCell('D40').value).toBe('y');
    expect(sheet.getCell('D41').value).toBeNull();

    // Crossbeam: row 52 should be 'y', row 53 should be null
    expect(sheet.getCell('D52').value).toBe('y');
    expect(sheet.getCell('D53').value).toBeNull();

    // Options: row 16 should be 'y', row 17 should be null
    expect(sheet.getCell('D16').value).toBe('y');
    expect(sheet.getCell('D17').value).toBeNull();

    // Accepted Add-ons: row 105 should be 'y', row 107 should be 'Y', declined row 108 should be null
    expect(sheet.getCell('D105').value).toBe('y');
    expect(sheet.getCell('D107').value).toBe('Y');
    expect(sheet.getCell('D108').value).toBeNull();
  });
});

