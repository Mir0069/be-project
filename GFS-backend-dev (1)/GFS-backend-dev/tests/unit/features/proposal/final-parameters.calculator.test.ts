import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { calculateFinalParameters } from '../../../../src/features/proposal/final-parameters.calculator';

const field = (value: unknown) => ({ value, status: 'APPROVED' });

describe('Final Parameters workbook calculation contract', () => {
  it('resolves the Atkinson workbook quantities and dependent prices', () => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_NO_IGU');
    schema.stage_3.decision.frame_type = field('PERIMETER_NON_TB');
    schema.stage_4.crossbeam = field('SERIES_1000_I_BEAM');
    schema.stage_4.takeoff.panel_count = field(6);
    schema.stage_4.takeoff.packaging = field(2);
    schema.stage_5.calculated.silicone_tubes = field(14);
    schema.stage_5.calculated.total_man_hours = field(28);
    schema.stage_5.addons.duty = field('y');
    schema.stage_5.addons.seeded_organic = field('y');
    schema.stage_5.addons.heat_soak_testing = field('n');
    schema.stage_5.addons.nanodot = field('y');
    schema.units.A = {
      ...schema.units.A,
      status: 'APPROVED',
      value_width_in: 60,
      value_length_in: 432,
      value_panel_count: 6,
      value_num_units: 1,
      value_vertical_rafter_count: 5,
      value_horizontal_rafter_count: 0,
    };

    const result = calculateFinalParameters(schema, {
      C9: 76,
      C40: 32.649435,
      C56: 40.773915,
      C61: 0.1,
      C62: 20,
      C63: 9,
      C64: 18,
      C66: 3,
      C67: 3,
      C71: 68,
      C72: 31,
      C73: 150,
      C86: 0.1,
      C87: 0.6,
      C88: 0.06,
      C90: 0.15,
      C107: 10,
      C109: 7.5,
      C110: 56,
    });

    expect(result.metrics).toMatchObject({
      totalSqft: 180,
      perimeterLf: 82,
      totalCrossbeamLengthIn: 300,
      rafterLf: 25,
      bracketCount: 24,
      fastenerCount: 76,
      paintLf: 107,
    });

    const fields = result.categories.flatMap((category) => category.fields);
    const byCell = (cell: string) => fields.find((item) => item.cell === cell);

    expect(byCell('C62')).toMatchObject({ quantity: 24, amount: 480 });
    expect(byCell('C63')).toMatchObject({ quantity: 76, amount: 684 });
    expect(byCell('C64')).toMatchObject({ quantity: 14, amount: 252 });
    expect(byCell('C67')).toMatchObject({ quantity: 25, amount: 75 });
    expect(byCell('C72')).toMatchObject({ quantity: 107, amount: 3317 });
    expect(byCell('C73')).toMatchObject({ quantity: 2, amount: 300 });
    expect(byCell('C69')).toMatchObject({ quantity: 0, amount: 0, selection: 'N' });
    expect(byCell('C85')).toMatchObject({ quantity: 0, amount: 0, selection: 'N' });
    expect(byCell('C89')).toMatchObject({ quantity: null, amount: null, selection: 'N' });
    expect(byCell('C91')).toMatchObject({ quantity: 0, amount: null, selection: 'N' });
    expect(byCell('C93')).toMatchObject({ quantity: null, amount: null, selection: 'N' });
    expect(byCell('C94')).toMatchObject({ quantity: null, amount: null, selection: 'N' });
    expect(byCell('C86')).toMatchObject({ amount: 2500.43 });
    expect(byCell('C90')).toMatchObject({ amount: 2052 });
    expect(result.categories.find((category) => category.title === 'Optional Add-ons')?.fields.map((item) => item.cell))
      .toEqual(['C107', 'C110']);
    expect(byCell('C107')).toMatchObject({ quantity: 180, amount: 1800, includedInTotal: false });
    expect(byCell('C110')).toMatchObject({ quantity: 180, amount: 10080, includedInTotal: false });
    expect(result.alternateTotal).toBe(11880);
    expect(result.finalPrice).toBe(48699.95);
  });

  it('defaults additional charges to N and calculates a selected charge from its unit cost', () => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_NO_IGU');
    schema.units.A.status = 'APPROVED';
    schema.units.A.value_width_in = 60;
    schema.units.A.value_length_in = 432;

    const result = calculateFinalParameters(schema, { C9: 76, C76: 540 });
    const stampedDrawings = result.categories
      .flatMap((category) => category.fields)
      .find((item) => item.cell === 'C76');

    expect(stampedDrawings).toMatchObject({ quantity: 0, amount: 0, selection: 'N' });

    schema.stage_7 = { additional_charge_selections: { C76: 'Y' } };
    const selectedResult = calculateFinalParameters(schema, { C9: 76, C76: 540 });
    const selectedStampedDrawings = selectedResult.categories
      .flatMap((category) => category.fields)
      .find((item) => item.cell === 'C76');

    expect(selectedStampedDrawings).toMatchObject({ quantity: 1, amount: 540, selection: 'Y' });

    schema.stage_7.additional_charge_selections = {
      C69: 'Y', C85: 'Y', C89: 'Y', C91: 'Y', C93: 'Y', C94: 'N',
    };
    const selectedFixedAndPercentageCharges = calculateFinalParameters(schema, {
      C9: 76,
      C69: 0.95,
      C85: 350,
      C89: 0.05,
      C91: 195,
      C93: 0.2,
      C94: 0.2,
    });
    const selectedByCell = (cell: string) => selectedFixedAndPercentageCharges.categories
      .flatMap((category) => category.fields)
      .find((item) => item.cell === cell);

    expect(selectedByCell('C85')).toMatchObject({ quantity: 1, amount: 350, selection: 'Y' });
    expect(selectedByCell('C69')).toMatchObject({ quantity: 82, amount: 77.9, selection: 'Y' });
    expect(selectedByCell('C89')).toMatchObject({ quantity: null, selection: 'Y' });
    expect(selectedByCell('C89')?.amount).not.toBeNull();
    expect(selectedByCell('C91')).toMatchObject({ quantity: 1, amount: 195, selection: 'Y' });
    expect(selectedByCell('C93')).toMatchObject({ quantity: null, selection: 'Y' });
    expect(selectedByCell('C93')?.amount).toBeGreaterThan(0);
    expect(selectedByCell('C94')).toMatchObject({ quantity: null, amount: null, selection: 'N' });
  });

  it.each([
    { scenario: 'single unit', unitKeys: ['A'] },
    { scenario: 'multiple units', unitKeys: ['A', 'B'] },
  ])('adds stamped drawings after percentage calculations for a $scenario project', ({ unitKeys }) => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_NO_IGU');
    for (const [index, unitKey] of unitKeys.entries()) {
      schema.units[unitKey] = {
        ...schema.units[unitKey],
        status: 'APPROVED',
        value_width_in: index === 0 ? 60 : 48,
        value_length_in: index === 0 ? 432 : 120,
        value_num_units: 1,
      };
    }

    const costs = { C9: 76, C76: 540, C81: 0.55, C86: 0.1, C87: 0.6, C88: 0.06, C93: 0.2 };
    schema.stage_7 = { additional_charge_selections: { C76: 'N', C81: 'Y', C93: 'Y' } };
    const withoutCharge = calculateFinalParameters(schema, costs);

    schema.stage_7.additional_charge_selections.C76 = 'Y';
    const withCharge = calculateFinalParameters(schema, costs);
    const fields = (result: ReturnType<typeof calculateFinalParameters>) =>
      result.categories.flatMap((category) => category.fields);
    const amount = (result: ReturnType<typeof calculateFinalParameters>, cell: string) =>
      fields(result).find((item) => item.cell === cell)?.amount;

    expect(withCharge.subtotal).toBe(withoutCharge.subtotal);
    expect(amount(withCharge, 'C86')).toBe(amount(withoutCharge, 'C86'));
    expect(amount(withCharge, 'C87')).toBe(amount(withoutCharge, 'C87'));
    expect(amount(withCharge, 'C88')).toBe(amount(withoutCharge, 'C88'));
    expect(amount(withCharge, 'C81')).toBe(amount(withoutCharge, 'C81'));
    expect(amount(withCharge, 'C93')).toBe(amount(withoutCharge, 'C93'));
    expect(amount(withCharge, 'C76')).toBe(540);
    expect(withCharge.finalPrice - withoutCharge.finalPrice).toBe(540);
  });

  it('adds an optional add-on only after explicit acceptance', () => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_NO_IGU');
    schema.stage_5.addons.nanodot = field('y');
    schema.units.A = {
      ...schema.units.A,
      status: 'APPROVED',
      value_width_in: 60,
      value_length_in: 120,
      value_num_units: 1,
    };
    schema.stage_7 = {
      cost_overrides: {},
      optional_add_on_statuses: { C110: 'SELECTED_PENDING_ACCEPTANCE' },
    };

    const pending = calculateFinalParameters(schema, { C110: 2 });
    expect(pending.optionalAddOnStatuses.C110).toBe('SELECTED_PENDING_ACCEPTANCE');
    expect(pending.optionalAddOnTotal).toBe(0);

    schema.stage_7.optional_add_on_statuses.C110 = 'ACCEPTED';
    const accepted = calculateFinalParameters(schema, { C110: 2 });
    expect(accepted.optionalAddOnTotal).toBe(100);
    expect(accepted.grandTotal).toBe(accepted.finalPrice + 100);
  });

  it('uses the legacy rafter count when explicit vertical/horizontal counts are unavailable', () => {
    const schema: any = createEmptySchema();
    schema.units.A = {
      ...schema.units.A,
      status: 'APPROVED',
      value_width_in: 60,
      value_length_in: 432,
      value_rafter_count: 3,
      value_vertical_rafter_count: 0,
      value_horizontal_rafter_count: 0,
    };

    const result = calculateFinalParameters(schema, { C67: 3 });
    const rafters = result.categories
      .flatMap((category) => category.fields)
      .find((item) => item.cell === 'C67');

    expect(result.metrics.rafterLf).toBe(15);
    expect(rafters).toMatchObject({ quantity: 15, amount: 45 });
  });

  it('maps Series 2000 I-Beam TB (C58) when frame is Series 2000 and crossbeam is I_BEAM_TB or D58 is y', () => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_WITH_IGU');
    schema.stage_3.decision.frame_type = field('SERIES_2000_PEDESTAL');
    schema.stage_4.crossbeam = field('I_BEAM_TB');
    schema.stage_4.takeoff.panel_count = field(2);
    schema.stage_6 = {
      cells: {
        D58: 'y',
        K115: 1,
      },
    };
    schema.units.A = {
      ...schema.units.A,
      status: 'APPROVED',
      value_width_in: 96,
      value_length_in: 84,
      value_panel_count: 2,
      value_num_units: 1,
    };

    const result = calculateFinalParameters(schema, {
      C10: 124.32,
      C41: 35.68,
      C54: 42.49,
      C58: 41.00,
      C67: 3.00,
    });

    const crossbeamCategory = result.categories.find((c) => c.title === 'Cross Beam');
    expect(crossbeamCategory).toBeDefined();

    // Series 2000 I-Beam TB must be visible, NOT Series 1000
    const visibleCells = crossbeamCategory!.fields.map((f) => f.cell);
    expect(visibleCells).toEqual(['C58']);

    const beamField = crossbeamCategory!.fields[0]!;
    expect(beamField.label).toBe('Series 2000 I-Beam TB');
    expect(beamField.cell).toBe('C58');
    expect(beamField.quantity).toBe(8);
    expect(beamField.amount).toBe(328);

    // Rafters in Gasket LF & Hardware also gets 8 LF
    const raftersField = result.categories
      .flatMap((c) => c.fields)
      .find((f) => f.cell === 'C67');
    expect(raftersField).toMatchObject({ quantity: 8, amount: 24 });
  });

  it('maps Series 1000 I-Beam TB (C54) when frame is Series 1000 and crossbeam is I_BEAM_TB', () => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_WITH_IGU');
    schema.stage_3.decision.frame_type = field('SERIES_1000_PEDESTAL');
    schema.stage_4.crossbeam = field('I_BEAM_TB');
    schema.stage_4.takeoff.panel_count = field(2);
    schema.units.A = {
      ...schema.units.A,
      status: 'APPROVED',
      value_width_in: 96,
      value_length_in: 84,
      value_panel_count: 2,
      value_vertical_rafter_count: 1,
      value_num_units: 1,
    };

    const result = calculateFinalParameters(schema, {
      C10: 124.32,
      C38: 35.68,
      C54: 42.49,
      C58: 41.00,
    });

    const crossbeamCategory = result.categories.find((c) => c.title === 'Cross Beam');
    expect(crossbeamCategory).toBeDefined();

    const visibleCells = crossbeamCategory!.fields.map((f) => f.cell);
    expect(visibleCells).toEqual(['C54']);
    expect(crossbeamCategory!.fields[0]!.label).toBe('Series 1000 I-Beam TB');
    expect(crossbeamCategory!.fields[0]!.quantity).toBe(8);
    expect(crossbeamCategory!.fields[0]!.amount).toBe(339.92);
  });

  it('allows quantity overrides to update line item quantities, line amounts, and grand total', () => {
    const schema: any = createEmptySchema();
    schema.stage_2.glass_type = field('GLASS_WITH_IGU');
    schema.stage_3.decision.frame_type = field('SERIES_2000_PEDESTAL');
    schema.units.A = {
      ...schema.units.A,
      status: 'APPROVED',
      value_width_in: 96,
      value_length_in: 120,
      value_panel_count: 1,
      value_num_units: 1,
    };

    // Base calculation: SqFt = 96 * 120 / 144 = 80 sqft. Cost C10 = 100. Base amount = 8000.
    const baseResult = calculateFinalParameters(schema, { C10: 100 });
    const glassBase = baseResult.categories.flatMap((c) => c.fields).find((f) => f.cell === 'C10');
    expect(glassBase?.quantity).toBe(80);
    expect(glassBase?.amount).toBe(8000);

    // Override quantity to 95 sqft
    const overriddenResult = calculateFinalParameters(schema, { C10: 100 }, { C10: 95 });
    const glassOverridden = overriddenResult.categories.flatMap((c) => c.fields).find((f) => f.cell === 'C10');
    expect(glassOverridden?.quantity).toBe(95);
    expect(glassOverridden?.amount).toBe(9500);
    expect(overriddenResult.grandTotal).toBeGreaterThan(baseResult.grandTotal);
  });

  describe('Packaging (C73)', () => {
    const packagingSchema = (unitPackaging: Array<number | null>) => {
      const schema: any = createEmptySchema();
      schema.stage_2.glass_type = field('GLASS_NO_IGU');
      schema.stage_4.takeoff.packaging = field(1);
      schema.stage_5.calculated.total_packaging = field(1);
      ['A', 'B'].forEach((key, index) => {
        schema.units[key] = {
          ...schema.units[key],
          status: 'APPROVED',
          value_width_in: 60,
          value_length_in: 120,
          value_packaging: unitPackaging[index],
        };
      });
      return schema;
    };
    const packagingRow = (result: ReturnType<typeof calculateFinalParameters>) =>
      result.categories.flatMap((category) => category.fields).find((item) => item.cell === 'C73');

    it('sums the Approved Unit Breakdown over the project-level takeoff default', () => {
      const result = calculateFinalParameters(packagingSchema([1, 2]), { C73: 150 });

      expect(packagingRow(result)).toMatchObject({ quantity: 3, amount: 450 });
    });

    it('falls back to the project-level packaging when no unit carries packaging', () => {
      const result = calculateFinalParameters(packagingSchema([null, null]), { C73: 150 });

      expect(packagingRow(result)).toMatchObject({ quantity: 1, amount: 150 });
    });

    it('keeps an explicit C73 quantity override above the unit sum', () => {
      const result = calculateFinalParameters(packagingSchema([1, 2]), { C73: 150 }, { C73: 5 });

      expect(packagingRow(result)).toMatchObject({ quantity: 5, amount: 750 });
    });
  });

  describe('Excel Ingestion Overrides Bridging (Column E / F)', () => {
    it('honors F-row cost overrides and E-row quantity overrides for manual charge items like C68', () => {
      const schema: any = createEmptySchema();
      schema.stage_2.glass_type = field('GLASS_NO_IGU');
      schema.stage_7 = {
        cost_overrides: {
          E68: 10,  // Quantity override from Excel column E
          F68: 1500, // Unit cost from Excel column F
        },
      };

      const result = calculateFinalParameters(schema, schema.stage_7.cost_overrides);
      const gasket = result.categories.flatMap((c) => c.fields).find((f) => f.cell === 'C68');

      expect(gasket).toBeDefined();
      expect(gasket?.quantity).toBe(10);
      expect(gasket?.amount).toBe(15000);
    });

    it('honors additional charge selection in stage_7.additional_charge_selections', () => {
      const schema: any = createEmptySchema();
      schema.stage_2.glass_type = field('GLASS_NO_IGU');
      schema.stage_7 = {
        additional_charge_selections: {
          C75: 'Y',
        },
        cost_overrides: {
          F75: 500,
        },
      };

      const result = calculateFinalParameters(schema, schema.stage_7.cost_overrides);
      const engineering = result.categories.flatMap((c) => c.fields).find((f) => f.cell === 'C75');

      expect(engineering).toBeDefined();
      expect(engineering?.quantity).toBe(1);
      expect(engineering?.amount).toBe(500);
    });
  });
});
