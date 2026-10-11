import {
  createEmptySchema,
  isResolvedCrossbeamValue,
} from '../src/features/proposal/schema-registry';
import { applyPatches } from '../src/features/proposal/schema-merge.engine';

describe('stage 4 field validation', () => {
  it('normalizes numeric labor inputs and rejects negative values', () => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_4_status = 'PENDING';

    const result = applyPatches(schema, [
      { fieldPath: 'stage_4.takeoff.packaging', value: '68' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(result.nextSchema.stage_4.takeoff.packaging.value).toBe(68);
    expect(() => applyPatches(schema, [
      { fieldPath: 'stage_4.takeoff.packaging', value: -1 },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' })).toThrow('at least 0');
  });

  it('allows panel count and crossbeam edits within backend rules', () => {
    const schema = createEmptySchema();

    const result = applyPatches(schema, [
      { fieldPath: 'stage_4.takeoff.panel_count', value: 14 },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(result.nextSchema.stage_4.takeoff.panel_count.value).toBe(14);

    const crossbeamField = schema.stage_4.crossbeam;
    expect(crossbeamField._meta.editable).toBe(true);
    expect(crossbeamField._meta.allowed_values).toContain('SERIES_2000_I_BEAM_TB');
    expect(crossbeamField._meta.allowed_values).toContain('NO_BEAM');

    const crossbeamResult = applyPatches(schema, [
      { fieldPath: 'stage_4.crossbeam', value: 'NO_BEAM' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(crossbeamResult.nextSchema.stage_4.crossbeam.value).toBe('NO_BEAM');
    expect(() => applyPatches(schema, [
      { fieldPath: 'stage_4.crossbeam', value: 'MANUAL' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' })).toThrow('beam series or NO_BEAM');

    const unresolvedAiResult = applyPatches(schema, [
      { fieldPath: 'stage_4.crossbeam', value: 'MANUAL' },
    ], { source: 'AI', updatedBy: 'stage-4-ai' });
    expect(unresolvedAiResult.nextSchema.stage_4.crossbeam.value).toBe('MANUAL');

    expect(() => applyPatches(schema, [
      { fieldPath: 'stage_4.crossbeam', value: 'UNSUPPORTED_CROSSBEAM' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' })).toThrow('Allowed');
  });

  it('requires a resolved crossbeam selection before approval', () => {
    expect(isResolvedCrossbeamValue(null)).toBe(false);
    expect(isResolvedCrossbeamValue('MANUAL')).toBe(false);
    expect(isResolvedCrossbeamValue('NO_BEAM')).toBe(true);
    expect(isResolvedCrossbeamValue('SERIES_2000_I_BEAM_TB')).toBe(true);
  });

  it('validates takeoff unit fields using their Excel column types', () => {
    const schema = createEmptySchema();

    const result = applyPatches(schema, [
      { fieldPath: 'units.A.value_panel_count', value: '14' },
      { fieldPath: 'units.A.value_width_in', value: '88.3333' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(result.nextSchema.units['A']?.value_panel_count).toBe(14);
    expect(result.nextSchema.units['A']?.value_width_in).toBe(88.3333);
    expect(() => applyPatches(schema, [
      { fieldPath: 'units.A.value_panel_count', value: 1.5 },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' })).toThrow('whole number');
  });

  it('exposes and validates unit-specific frame and glass selections', () => {
    const schema = createEmptySchema();

    expect(schema.units.A.value_frame_type).toBeNull();
    expect(schema.units.A.value_glass_type).toBeNull();

    const result = applyPatches(schema, [
      { fieldPath: 'units.A.value_frame_type', value: 'SERIES_2000_PEDESTAL' },
      { fieldPath: 'units.A.value_glass_type', value: 'GLASS_WITH_IGU' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(result.nextSchema.units['A']).toEqual(expect.objectContaining({
      value_frame_type: 'SERIES_2000_PEDESTAL',
      value_glass_type: 'GLASS_WITH_IGU',
    }));
    expect(schema.units.A._meta).toBeUndefined();
    expect(() => applyPatches(schema, [
      { fieldPath: 'units.A.value_frame_type', value: 'UNKNOWN_FRAME' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' })).toThrow('Allowed');
  });

  it('exposes and validates unit-specific Crossbeam selections', () => {
    const schema = createEmptySchema();

    const result = applyPatches(schema, [
      { fieldPath: 'units.A.value_cross_beam', value: 'SERIES_2000_T_SECTION_TB' },
      { fieldPath: 'stage_4.units.B.value_cross_beam', value: 'SERIES_1000_I_BEAM_TB' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(result.nextSchema.units['A']?.value_cross_beam).toBe('SERIES_2000_T_SECTION_TB');
    expect(result.nextSchema.units['B']?.value_cross_beam).toBe('SERIES_1000_I_BEAM_TB');
    expect(() => applyPatches(schema, [
      { fieldPath: 'units.A.value_cross_beam', value: 'UNKNOWN_CROSSBEAM' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' })).toThrow('Allowed');
  });

  it('accepts a Stage 2 unit-glass edit while persisting to the root unit schema', () => {
    const schema = createEmptySchema();

    const result = applyPatches(schema, [
      { fieldPath: 'stage_2.units.B.value_glass_type', value: 'GLASS_WITH_IGU' },
    ], { source: 'ESTIMATOR', updatedBy: 'estimator-1' });

    expect(result.nextSchema.units['B']?.value_glass_type).toBe('GLASS_WITH_IGU');
    expect(result.changedFieldPaths).toContain('units.B.value_glass_type');
  });
});

// =============================================================================
// HUMAN OVERRIDE MARKER
// A person's typed value must outlive "revise stage", which clears the APPROVED
// status the AI merge used to key on. See ProposalService.pushDeepSchemaFromAI.
// =============================================================================

describe('human override marker', () => {
  it('stamps _meta.human_override when a person edits a field', () => {
    const schema = createEmptySchema();

    const { nextSchema } = applyPatches(
      schema,
      [{ fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' }],
      { source: 'ESTIMATOR', updatedBy: 'estimator-1' },
    );

    expect(nextSchema.stage_2.glass_type._meta?.human_override).toBe(true);
    expect(nextSchema.stage_2.glass_type._meta?.human_override_by).toBe('estimator-1');
    expect(nextSchema.stage_2.glass_type._meta?.human_override_at).toEqual(expect.any(String));
  });

  it('stamps the marker for a sales manager, not just the assigned estimator', () => {
    const schema = createEmptySchema();

    const { nextSchema } = applyPatches(
      schema,
      [{ fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' }],
      { source: 'ESTIMATOR', updatedBy: 'sales-manager-1', authorRole: 'SALES_MANAGER' },
    );

    expect(nextSchema.stage_2.glass_type._meta?.human_override).toBe(true);
    expect(nextSchema.stage_2.glass_type._meta?.human_override_by).toBe('sales-manager-1');
  });

  it('does not stamp the marker for AI or formula-engine writes', () => {
    const schema = createEmptySchema();

    const { nextSchema } = applyPatches(
      schema,
      [{ fieldPath: 'stage_2.glass_type', value: 'GLASS_NO_IGU' }],
      { source: 'AI', updatedBy: 'rules_engine' },
    );

    expect(nextSchema.stage_2.glass_type._meta?.human_override).toBeUndefined();
  });

  it('stamps only the edited field name on a takeoff row, not the whole unit', () => {
    // Units are one flat node per unit rather than one IBaseField per field, so
    // protection must be tracked per field name (human_override_fields) —
    // otherwise editing one field (e.g. panel count) would also block AI-only
    // fields on the same unit, like value_description and value_man_hours,
    // that the estimator never touched.
    const schema = createEmptySchema();

    const { nextSchema } = applyPatches(
      schema,
      [{ fieldPath: 'units.A.value_panel_count', value: 12 }],
      { source: 'ESTIMATOR', updatedBy: 'estimator-1' },
    );

    expect(nextSchema.units['A']?._meta?.human_override_fields).toEqual(['value_panel_count']);
    expect(nextSchema.units['A']?._meta?.human_override_by).toBe('estimator-1');
    expect(nextSchema.units['A']?._meta?.human_override_at).toEqual(expect.any(String));
    // The old blanket flag must not be set — deepMergeSchema falls back to it
    // (protecting the whole unit) whenever human_override_fields is absent.
    expect(nextSchema.units['A']?._meta?.human_override).toBeUndefined();
  });

  it('accumulates distinct field names across separate edits to the same unit', () => {
    const schema = createEmptySchema();

    const { nextSchema } = applyPatches(
      schema,
      [{ fieldPath: 'units.A.value_panel_count', value: 12 }],
      { source: 'ESTIMATOR', updatedBy: 'estimator-1' },
    );
    const { nextSchema: nextSchema2 } = applyPatches(
      nextSchema,
      [{ fieldPath: 'units.A.value_width_in', value: 40 }],
      { source: 'ESTIMATOR', updatedBy: 'estimator-1' },
    );

    expect(nextSchema2.units['A']?._meta?.human_override_fields?.sort()).toEqual(
      ['value_panel_count', 'value_width_in'],
    );
  });

  it('keeps registry metadata already on the field', () => {
    const schema = createEmptySchema();
    const allowedBefore = schema.stage_2.glass_type._meta?.allowed_values;

    const { nextSchema } = applyPatches(
      schema,
      [{ fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' }],
      { source: 'ESTIMATOR', updatedBy: 'estimator-1' },
    );

    expect(nextSchema.stage_2.glass_type._meta?.allowed_values).toEqual(allowedBefore);
    expect(nextSchema.stage_2.glass_type._meta?.manual).toBe(schema.stage_2.glass_type._meta?.manual);
  });
});
