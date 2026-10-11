import ExcelJS from 'exceljs';
import { excelIngestionService } from '../../../../src/features/proposal/excel/excel-ingestion.service';
import type { IProjectSchema } from '../../../../src/db/models/proposal.model';

describe('ExcelIngestionService', () => {
  it('should parse an Excel workbook, diff changes against schema, and apply updates', async () => {
    // 1. Create a mock proposal workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pricing Worksheet');

    // Stage 1 Headers
    worksheet.getCell('C2').value = 'Aspen Deck Glass Renovation';
    worksheet.getCell('F2').value = '123 Aspen Way, Aspen CO';
    worksheet.getCell('C3').value = 'Jane Doe';
    worksheet.getCell('F3').value = '456 Pine Street';
    worksheet.getCell('I3').value = '555-123-4567';
    worksheet.getCell('L3').value = 'jane@example.com';
    worksheet.getCell('C4').value = 'RESIDENTIAL';
    worksheet.getCell('L2').value = 'Greg Muniz';

    // Unit Takeoff - Unit A (Row 115)
    worksheet.getCell('C115').value = 'Deck Main Floor';
    worksheet.getCell('D115').value = 'A';
    worksheet.getCell('E115').value = 60; // width
    worksheet.getCell('F115').value = 120; // length
    worksheet.getCell('G115').value = 2; // panels
    worksheet.getCell('J115').value = 1; // num units
    worksheet.getCell('K115').value = 1; // vert rafters
    worksheet.getCell('L115').value = 0; // horiz rafters
    worksheet.getCell('M115').value = 'DWG-001';

    // Unit Takeoff - Unit B (Row 116)
    worksheet.getCell('C116').value = 'Balcony';
    worksheet.getCell('D116').value = 'B';
    worksheet.getCell('E116').value = 48;
    worksheet.getCell('F116').value = 96;
    worksheet.getCell('G116').value = 1;
    worksheet.getCell('J116').value = 1;

    // Unit Man Hours (Row 71) & Packaging (Row 73)
    worksheet.getCell('E71').value = 10; // Unit A Man Hours
    worksheet.getCell('E73').value = 2;  // Unit A Packaging
    worksheet.getCell('H71').value = 15; // Unit B Man Hours
    worksheet.getCell('H73').value = 3;  // Unit B Packaging

    // Glass Type - Row 10 (Glass with IGU)
    worksheet.getCell('B10').value = 'Glass – with IGU';
    worksheet.getCell('D10').value = 'y';

    // Frame Type - Row 41 (Series 2000 Pedestal)
    worksheet.getCell('B41').value = 'Series 2000 Pedestal';
    worksheet.getCell('D41').value = 'y';

    // Unit B Specific Glass Type (Row 11 in Col G) & Frame Type (Row 42 in Col G)
    worksheet.getCell('B11').value = 'Glass – 2.0';
    worksheet.getCell('G11').value = 'y'; // Unit B Glass Type: GLASS_2_0
    worksheet.getCell('B42').value = 'Series 2000 Recessed';
    worksheet.getCell('G42').value = 'y'; // Unit B Frame Type: SERIES_2000_RECESSED

    // Crossbeam - Row 57 (SERIES_2000_T_SECTION_TB)
    worksheet.getCell('D57').value = 'y';

    // Stage 5 Addons
    worksheet.getCell('B16').value = 'Sentry Glass';
    worksheet.getCell('D16').value = 'y'; // Sentry Glass
    worksheet.getCell('D90').value = 'y'; // Duty
    worksheet.getCell('D110').value = 'y'; // NanoDot
    worksheet.getCell('B69').value = '3M Tape';
    worksheet.getCell('D69').value = 'y'; // 3M Tape

    // Stage 7 Additional Charges Selection
    worksheet.getCell('D75').value = 'y'; // Special Crating
    worksheet.getCell('D91').value = 'y'; // Transgroup fees

    // Cost overrides
    worksheet.getCell('F68').value = 1500; // Freight override

    // Pricing totals
    worksheet.getCell('A200').value = 'FINAL PRICE';
    worksheet.getCell('F200').value = 15800;

    // 2. Parse workbook
    const parsedData = await excelIngestionService.parseProposalExcel(workbook);

    expect(parsedData.stage1.projectName).toBe('Aspen Deck Glass Renovation');
    expect(parsedData.stage1.projectAddress).toBe('123 Aspen Way, Aspen CO');
    expect(parsedData.stage1.contactName).toBe('Jane Doe');
    expect(parsedData.stage1.contactPhone).toBe('555-123-4567');
    expect(parsedData.stage1.personQuoting).toBe('Greg Muniz');

    const unitA = parsedData.units['A']!;
    expect(unitA).toBeDefined();
    expect(unitA.widthIn).toBe(60);
    expect(unitA.lengthIn).toBe(120);
    expect(unitA.panelCount).toBe(2);
    expect(unitA.verticalRafterCount).toBe(1);
    expect(unitA.drawingNumber).toBe('DWG-001');
    expect(unitA.manHours).toBe(10);
    expect(unitA.packaging).toBe(2);

    const unitB = parsedData.units['B']!;
    expect(unitB).toBeDefined();
    expect(unitB.widthIn).toBe(48);
    expect(unitB.lengthIn).toBe(96);
    expect(unitB.manHours).toBe(15);
    expect(unitB.packaging).toBe(3);
    expect(unitB.glassType).toBe('GLASS_2_0');
    expect(unitB.frameType).toBe('SERIES_2000_RECESSED');

    expect(parsedData.glassType).toBe('GLASS_WITH_IGU');
    expect(parsedData.frameType).toBe('SERIES_2000_PEDESTAL');
    expect(parsedData.crossbeam).toBe('SERIES_2000_T_SECTION_TB');
    expect(parsedData.stage5Addons.duty).toBe('y');
    expect(parsedData.stage5Addons.nanodot).toBe('y');
    expect(parsedData.stage5Addons.sentryGlass).toBe('y');
    expect(parsedData.stage5Addons.threeMTape).toBe('y');
    expect(parsedData.optionalAddOnStatuses?.['C110']).toBe('ACCEPTED');
    expect(parsedData.additionalChargeSelections?.['C75']).toBe('Y');
    expect(parsedData.additionalChargeSelections?.['C91']).toBe('Y');
    expect(parsedData.costOverrides['F68']).toBe(1500);

    // 3. Diff against an existing schema
    const initialSchema: IProjectSchema = {
      stage_1: {
        project_name: { value: 'Old Project Name' },
        contact_name: { value: 'Old Contact' },
      } as any,
      stage_2: {
        glass_type: { value: 'GLASS_NO_IGU' },
      } as any,
      stage_3: {
        decision: { frame_type: { value: 'SERIES_1000_PEDESTAL' } },
      } as any,
      units: {
        A: {
          value_width_in: 48,
          value_length_in: 96,
          value_panel_count: 1,
          value_man_hours: 0,
          value_packaging: 0,
        } as any,
        B: {
          value_width_in: 48,
          value_length_in: 96,
          value_panel_count: 1,
        } as any,
      },
      stage_4: {
        crossbeam: { value: 'T_SECTION_NTB' },
      } as any,
      stage_5: {
        addons: {
          duty: { value: 'n', status: 'APPROVED' },
          nanodot: 'n',
          sentry_glass: 'n',
          three_m_tape: 'n',
        },
      } as any,
      stage_7: {
        cost_overrides: {},
        additional_charge_selections: { C75: 'N', C91: 'N' },
        optional_add_on_statuses: { C110: 'NOT_SELECTED' },
        computed_snapshot: { final_price: 12000 },
      } as any,
    } as any;

    const diff = excelIngestionService.diffWithCurrentSchema(initialSchema, parsedData);

    expect(diff.length).toBeGreaterThan(0);
    const widthChange = diff.find((d) => d.fieldPath === 'units.A.value_width_in');
    expect(widthChange).toBeDefined();
    expect(widthChange?.previousValue).toBe(48);
    expect(widthChange?.newValue).toBe(60);

    const glassChange = diff.find((d) => d.fieldPath === 'stage_2.glass_type');
    expect(glassChange).toBeDefined();
    expect(glassChange?.previousValue).toBe('GLASS_NO_IGU');
    expect(glassChange?.newValue).toBe('GLASS_WITH_IGU');

    const unitBGlassChange = diff.find((d) => d.fieldPath === 'units.B.value_glass_type');
    expect(unitBGlassChange).toBeDefined();
    expect(unitBGlassChange?.newValue).toBe('GLASS_2_0');

    const frameChange = diff.find((d) => d.fieldPath === 'stage_3.decision.frame_type');
    expect(frameChange).toBeDefined();
    expect(frameChange?.previousValue).toBe('SERIES_1000_PEDESTAL');
    expect(frameChange?.newValue).toBe('SERIES_2000_PEDESTAL');

    const unitBFrameChange = diff.find((d) => d.fieldPath === 'units.B.value_frame_type');
    expect(unitBFrameChange).toBeDefined();
    expect(unitBFrameChange?.newValue).toBe('SERIES_2000_RECESSED');

    const pkgChangeA = diff.find((d) => d.fieldPath === 'units.A.value_packaging');
    expect(pkgChangeA).toBeDefined();
    expect(pkgChangeA?.newValue).toBe(2);

    const pkgChangeB = diff.find((d) => d.fieldPath === 'units.B.value_packaging');
    expect(pkgChangeB).toBeDefined();
    expect(pkgChangeB?.newValue).toBe(3);

    const mhChangeA = diff.find((d) => d.fieldPath === 'units.A.value_man_hours');
    expect(mhChangeA).toBeDefined();
    expect(mhChangeA?.newValue).toBe(10);

    const crossbeamChange = diff.find((d) => d.fieldPath === 'stage_4.crossbeam');
    expect(crossbeamChange).toBeDefined();
    expect(crossbeamChange?.newValue).toBe('SERIES_2000_T_SECTION_TB');

    const dutyChange = diff.find((d) => d.fieldPath === 'stage_5.addons.duty');
    expect(dutyChange).toBeDefined();
    expect(dutyChange?.newValue).toBe('y');

    const sentryChange = diff.find((d) => d.fieldPath === 'stage_5.addons.sentry_glass');
    expect(sentryChange).toBeDefined();
    expect(sentryChange?.newValue).toBe('y');

    const tapeChange = diff.find((d) => d.fieldPath === 'stage_5.addons.three_m_tape');
    expect(tapeChange).toBeDefined();
    expect(tapeChange?.newValue).toBe('y');

    const optStatusChange = diff.find((d) => d.fieldPath === 'stage_7.optional_add_on_statuses.C110');
    expect(optStatusChange).toBeDefined();
    expect(optStatusChange?.newValue).toBe('ACCEPTED');

    const chargeChange75 = diff.find((d) => d.fieldPath === 'stage_7.additional_charge_selections.C75');
    expect(chargeChange75).toBeDefined();
    expect(chargeChange75?.newValue).toBe('Y');

    const chargeChange91 = diff.find((d) => d.fieldPath === 'stage_7.additional_charge_selections.C91');
    expect(chargeChange91).toBeDefined();
    expect(chargeChange91?.newValue).toBe('Y');

    const overrideChange = diff.find((d) => d.fieldPath === 'stage_7.cost_overrides.F68');
    expect(overrideChange).toBeDefined();
    expect(overrideChange?.newValue).toBe(1500);

    // 4. Apply parsed data to schema
    const { nextSchema, changedFieldPaths, newFinalPrice } = excelIngestionService.applyParsedDataToSchema(
      initialSchema,
      parsedData
    );

    expect(nextSchema.stage_1?.project_name?.value).toBe('Aspen Deck Glass Renovation');
    expect(nextSchema.units?.['A']?.value_width_in).toBe(60);
    expect(nextSchema.units?.['A']?.value_length_in).toBe(120);
    expect(nextSchema.units?.['A']?.value_panel_count).toBe(2);
    expect(nextSchema.units?.['A']?.value_packaging).toBe(2);
    expect(nextSchema.units?.['A']?.value_man_hours).toBe(10);
    expect(nextSchema.units?.['B']?.value_packaging).toBe(3);
    expect(nextSchema.units?.['B']?.value_man_hours).toBe(15);
    expect(nextSchema.units?.['B']?.value_glass_type).toBe('GLASS_2_0');
    expect(nextSchema.units?.['B']?.value_frame_type).toBe('SERIES_2000_RECESSED');
    expect(nextSchema.stage_2?.glass_type).toEqual({ value: 'GLASS_WITH_IGU', status: 'APPROVED' });
    expect(nextSchema.stage_3?.decision?.frame_type).toEqual({ value: 'SERIES_2000_PEDESTAL', status: 'APPROVED' });
    expect(nextSchema.stage_4?.crossbeam?.value).toBe('SERIES_2000_T_SECTION_TB');
    expect(nextSchema.stage_5?.addons?.duty).toEqual({ value: 'y', status: 'APPROVED' });
    expect(nextSchema.stage_5?.addons?.sentry_glass).toEqual({ value: 'y', status: 'APPROVED' });
    expect(nextSchema.stage_5?.addons?.three_m_tape).toEqual({ value: 'y', status: 'APPROVED' });
    expect(nextSchema.stage_7?.optional_add_on_statuses?.['C110']).toBe('ACCEPTED');
    expect(nextSchema.stage_7?.additional_charge_selections?.['C75']).toBe('Y');
    expect(nextSchema.stage_7?.additional_charge_selections?.['C91']).toBe('Y');
    expect(nextSchema.stage_7?.cost_overrides?.['F68']).toBe(1500);
    expect(changedFieldPaths).toContain('stage_2.glass_type');
    expect(changedFieldPaths).toContain('stage_3.decision.frame_type');
    expect(changedFieldPaths).toContain('units.A.value_width_in');
    expect(changedFieldPaths).toContain('units.A.value_packaging');
    expect(changedFieldPaths).toContain('units.B.value_packaging');
    expect(changedFieldPaths).toContain('units.B.value_glass_type');
    expect(changedFieldPaths).toContain('units.B.value_frame_type');
    expect(changedFieldPaths).toContain('stage_4.crossbeam');
    expect(changedFieldPaths).toContain('stage_5.addons.sentry_glass');
    expect(changedFieldPaths).toContain('stage_5.addons.three_m_tape');
    expect(changedFieldPaths).toContain('stage_7.optional_add_on_statuses.C110');
    expect(changedFieldPaths).toContain('stage_7.additional_charge_selections.C75');
    expect(changedFieldPaths).toContain('stage_7.additional_charge_selections.C91');
    expect(changedFieldPaths).toContain('stage_7.cost_overrides.F68');
    expect(newFinalPrice).toBe(15800);
  });

  it('correctly re-ingests a real generated proposal workbook with zero false diffs', async () => {
    const fs = require('fs');
    const path = require('path');
    const {
      generateProposalExcelLocally,
      setCachedTemplateBuffer,
      invalidateTemplateBufferCache,
    } = require('../../../../src/features/proposal/excel/graph.generator');
    const { createEmptySchema } = require('../../../../src/features/proposal/schema-registry');
    const templatePath = path.resolve(__dirname, '../../../fixtures/dummy-template.xlsx');
    const templateBuffer = fs.readFileSync(templatePath);
    setCachedTemplateBuffer(templateBuffer);

    try {
      const schema = createEmptySchema() as IProjectSchema;
      schema.stage_1.project_name = { value: 'Roundtrip Test Project', status: 'APPROVED' } as any;
      schema.stage_1.contact_name = { value: 'Alice Smith', status: 'APPROVED' } as any;
      schema.stage_2 = { glass_type: { value: 'GLASS_NO_IGU', status: 'APPROVED' } } as any;
      schema.stage_3 = { decision: { frame_type: { value: 'SERIES_1000_RECESSED', status: 'APPROVED' } } } as any;
      schema.stage_4 = { crossbeam: { value: 'SERIES_1000_I_BEAM_TB', status: 'APPROVED' } } as any;
      schema.stage_5 = {
        addons: { duty: 'y', sentry_glass: 'y' },
        calculated: {},
        _signals: {},
      } as any;
      schema.units['A'] = {
        ...schema.units['A'],
        value_width_in: 40,
        value_length_in: 60,
        value_panel_count: 1,
        value_num_units: 1,
        status: 'APPROVED',
      } as any;

      const excelBuffer = await generateProposalExcelLocally(schema, 'Q-ROUNDTRIP');
      const parsed = await excelIngestionService.parseProposalExcel(excelBuffer);

      // Verify fields are correctly parsed from the real template
      expect(parsed.stage1.projectName).toBe('Roundtrip Test Project');
      expect(parsed.units['A']?.widthIn).toBe(40);
      expect(parsed.units['A']?.lengthIn).toBe(60);
      expect(parsed.crossbeam).toBe('SERIES_1000_I_BEAM_TB');
      expect(parsed.stage5Addons.duty).toBe('y');
      expect(parsed.pricingSnapshot?.final_price).toBeGreaterThan(0);

      // Populate snapshot with the calculated price so diff comparison is against the generated price
      schema.stage_7 = {
        status: 'APPROVED',
        cost_overrides: {},
        computed_snapshot: {
          final_price: parsed.pricingSnapshot!.final_price,
          grand_total: parsed.pricingSnapshot!.final_price,
        },
      } as any;

      // Zero false diffs when diffed against the current schema
      const diff = excelIngestionService.diffWithCurrentSchema(schema, parsed);
      expect(diff).toEqual([]);
    } finally {
      invalidateTemplateBufferCache();
    }
  }, 120000);
});

