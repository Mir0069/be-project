import { createEmptySchema } from '../src/features/proposal/schema-registry';
import { FormulaEngineService } from '../src/features/proposal/formula-engine/formula-engine.service';

describe('FormulaEngineService', () => {
  it('calculates aggregate panel count from approved takeoff units', async () => {
    const schema = createEmptySchema();
    schema.units.A.status = 'APPROVED';
    schema.units.A.value_panel_count = 14;
    schema.units.A.value_num_units = 1;
    schema.units.B.status = 'APPROVED';
    schema.units.B.value_panel_count = 3;
    schema.units.B.value_num_units = 2;

    const patches = await new FormulaEngineService().recalculate(schema);

    expect(patches).toContainEqual({
      fieldPath: 'stage_4.takeoff.panel_count',
      value: 20,
      status: 'APPROVED',
    });
  });

  it('calculates total sqft from the Pricing Worksheet width and length formula', async () => {
    const schema = createEmptySchema();
    schema.units.A.status = 'APPROVED';
    schema.units.A.value_width_in = 24;
    schema.units.A.value_length_in = 48;
    schema.units.A.value_panel_count = 3;
    schema.units.A.value_num_units = 2;

    const patches = await new FormulaEngineService().recalculate(schema);

    expect(patches).toContainEqual({
      fieldPath: 'stage_5.calculated.total_sqft',
      value: 8,
    });
  });

  it('sums sqft only from approved takeoff units', async () => {
    const schema = createEmptySchema();
    schema.units.A.status = 'APPROVED';
    schema.units.A.value_width_in = 12;
    schema.units.A.value_length_in = 12;
    schema.units.A.value_panel_count = 4;
    schema.units.B.status = 'PENDING';
    schema.units.B.value_width_in = 120;
    schema.units.B.value_length_in = 120;
    schema.units.B.value_panel_count = 10;

    const patches = await new FormulaEngineService().recalculate(schema);

    expect(patches).toContainEqual({
      fieldPath: 'stage_5.calculated.total_sqft',
      value: 1,
    });
  });

  it('ignores takeoff units that are not approved', async () => {
    const schema = createEmptySchema();
    schema.units.A.status = 'PENDING';
    schema.units.A.value_panel_count = 14;

    const patches = await new FormulaEngineService().recalculate(schema);

    expect(patches).toContainEqual({
      fieldPath: 'stage_4.takeoff.panel_count',
      value: 0,
      status: 'APPROVED',
    });
  });

  it('preserves an approved silicone quantity instead of overwriting it', async () => {
    const schema = createEmptySchema();
    schema.stage_5.calculated.silicone_tubes.value = 14;
    schema.units.A.status = 'APPROVED';
    schema.units.A.value_width_in = 60;
    schema.units.A.value_length_in = 432;
    schema.units.A.value_vertical_rafter_count = 5;

    const patches = await new FormulaEngineService().recalculate(schema);

    expect(patches).toContainEqual({
      fieldPath: 'stage_5.calculated.silicone_tubes',
      value: 14,
    });
  });

  it('calculates total weight using GFS structural glass standards', async () => {
    // 1 unit of 24" x 48" = (24*48/144) = 8 sqft total
    const createTestSchema = (glassTypeValue: string) => {
      const s = createEmptySchema();
      s.stage_2.glass_type.value = glassTypeValue;
      s.units.A.status = 'APPROVED';
      s.units.A.value_width_in = 24;
      s.units.A.value_length_in = 48;
      s.units.A.value_panel_count = 2;
      s.units.A.value_num_units = 1;
      return s;
    };

    const engine = new FormulaEngineService();

    // 1. GLASS_NO_IGU -> 15.0 lbs/sqft -> 8 * 15 = 120 lbs
    const noIguPatches = await engine.recalculate(createTestSchema('GLASS_NO_IGU'));
    expect(noIguPatches).toContainEqual({
      fieldPath: 'stage_5.calculated.total_weight',
      value: 120,
    });

    // 2. GLASS_WITH_IGU -> 20.0 lbs/sqft -> 8 * 20 = 160 lbs
    const withIguPatches = await engine.recalculate(createTestSchema('GLASS_WITH_IGU'));
    expect(withIguPatches).toContainEqual({
      fieldPath: 'stage_5.calculated.total_weight',
      value: 160,
    });

    // 3. GLASS_2_0 -> 21.0 lbs/sqft -> 8 * 21 = 168 lbs
    const glass2Patches = await engine.recalculate(createTestSchema('GLASS_2_0'));
    expect(glass2Patches).toContainEqual({
      fieldPath: 'stage_5.calculated.total_weight',
      value: 168,
    });

    // 4. Default / STAIR_TREAD / NON_WALKABLE -> 15.0 lbs/sqft
    const nonWalkablePatches = await engine.recalculate(createTestSchema('NON_WALKABLE'));
    expect(nonWalkablePatches).toContainEqual({
      fieldPath: 'stage_5.calculated.total_weight',
      value: 120,
    });
  });

  it('triggers heat soak testing correctly based on weight thresholds', async () => {
    const engine = new FormulaEngineService();

    // 40 sqft * 15 lbs/sqft = 600 lbs -> threshold > 400 is MANUAL
    const schemaManual = createEmptySchema();
    schemaManual.stage_2.glass_type.value = 'GLASS_NO_IGU';
    schemaManual.stage_5.addons.heat_soak_testing.status = 'PENDING';
    schemaManual.units.A.status = 'APPROVED';
    schemaManual.units.A.value_width_in = 48;
    schemaManual.units.A.value_length_in = 120; // 40 sqft
    schemaManual.units.A.value_panel_count = 1;
    schemaManual.units.A.value_num_units = 1;

    const manualPatches = await engine.recalculate(schemaManual);
    expect(manualPatches).toContainEqual({
      fieldPath: 'stage_5.addons.heat_soak_testing',
      value: 'MANUAL',
    });

    // 45 sqft * 15 lbs/sqft = 675 lbs (> 600) -> 'y'
    const schemaYes = createEmptySchema();
    schemaYes.stage_2.glass_type.value = 'GLASS_NO_IGU';
    schemaYes.stage_5.addons.heat_soak_testing.status = 'PENDING';
    schemaYes.units.A.status = 'APPROVED';
    schemaYes.units.A.value_width_in = 54;
    schemaYes.units.A.value_length_in = 120; // 45 sqft
    schemaYes.units.A.value_panel_count = 1;
    schemaYes.units.A.value_num_units = 1;

    const yesPatches = await engine.recalculate(schemaYes);
    expect(yesPatches).toContainEqual({
      fieldPath: 'stage_5.addons.heat_soak_testing',
      value: 'y',
    });
  });
});
