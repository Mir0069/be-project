import { singleUnitSpecPatches, syncSingleUnitSpecsFromProject } from '../../../../src/features/proposal/single-unit-sync';

const schema = (glass: string | null, frame: string | null, units: Record<string, any>): any => ({
  stage_2: { glass_type: { value: glass } },
  stage_3: { decision: { frame_type: { value: frame } } },
  units,
});
const unitA = (extra: Record<string, any> = {}) => ({
  unit_id: 'A',
  value_width_in: 70,
  value_glass_type: 'GLASS_WITH_IGU',
  value_frame_type: 'SERIES_2000_PEDESTAL',
  ...extra,
});
const empty = (id: string) => ({ unit_id: id, value_num_units: 1 });

describe('syncSingleUnitSpecsFromProject', () => {
  it('moves the only unit to the new project frame', () => {
    const before = schema('GLASS_WITH_IGU', 'SERIES_2000_PEDESTAL', { A: unitA(), B: empty('B') });
    const next = schema('GLASS_WITH_IGU', 'SERIES_3000', { A: unitA(), B: empty('B') });

    expect(syncSingleUnitSpecsFromProject(before, next)).toEqual(['units.A.value_frame_type']);
    expect(next.units.A.value_frame_type).toBe('SERIES_3000');
    expect(next.units.A.reasoning).toEqual(['Follows the project frame type change to SERIES_3000']);
    expect(next.units.A.value_glass_type).toBe('GLASS_WITH_IGU');
  });

  it('leaves a unit the same push already changed', () => {
    const before = schema('GLASS_NO_IGU', 'ECONOFRAME', { A: unitA({ value_glass_type: 'GLASS_NO_IGU' }) });
    const next = schema('GLASS_WITH_IGU', 'ECONOFRAME', { A: unitA({ value_glass_type: 'GLASS_2_0' }) });

    expect(syncSingleUnitSpecsFromProject(before, next)).toEqual([]);
    expect(next.units.A.value_glass_type).toBe('GLASS_2_0');
  });

  it('respects a field the estimator overrode', () => {
    const overridden = { _meta: { human_override_fields: ['value_frame_type'] } };
    const before = schema(null, 'SERIES_2000_PEDESTAL', { A: unitA(overridden) });
    const next = schema(null, 'SERIES_3000', { A: unitA(overridden) });

    expect(syncSingleUnitSpecsFromProject(before, next)).toEqual([]);
    expect(next.units.A.value_frame_type).toBe('SERIES_2000_PEDESTAL');
  });

  it('does nothing for multi-unit projects, unchanged values, or codes outside the contract', () => {
    const twoUnits = { A: unitA(), B: unitA({ unit_id: 'B' }) };
    expect(syncSingleUnitSpecsFromProject(schema(null, 'ECONOFRAME', twoUnits), schema(null, 'SERIES_3000', structuredClone(twoUnits)))).toEqual([]);
    expect(syncSingleUnitSpecsFromProject(schema(null, 'SERIES_3000', { A: unitA() }), schema(null, 'SERIES_3000', { A: unitA() }))).toEqual([]);
    expect(syncSingleUnitSpecsFromProject(schema(null, 'ECONOFRAME', { A: unitA() }), schema(null, 'PERIMETER_NTB', { A: unitA() }))).toEqual([]);
  });
});

describe('singleUnitSpecPatches', () => {
  const edits = (fieldPath: string, value: unknown) => [{ fieldPath, value }];

  it('adds the matching unit edit for a one-unit project', () => {
    const current = schema('MANUAL', 'SERIES_2000_PEDESTAL', { A: unitA(), B: empty('B') });

    expect(singleUnitSpecPatches(current, edits('stage_2.glass_type', 'GLASS_NO_IGU'))).toEqual([
      { fieldPath: 'units.A.value_glass_type', value: 'GLASS_NO_IGU' },
    ]);
    expect(singleUnitSpecPatches(current, edits('stage_3.decision.frame_type', 'MANUAL'))).toEqual([
      { fieldPath: 'units.A.value_frame_type', value: 'MANUAL' },
    ]);
  });

  it('adds nothing for other fields, several units, or a unit edited in the same request', () => {
    const one = schema(null, null, { A: unitA() });
    const two = schema(null, null, { A: unitA(), B: unitA({ unit_id: 'B' }) });

    expect(singleUnitSpecPatches(one, edits('stage_1.project_name', 'X'))).toEqual([]);
    expect(singleUnitSpecPatches(two, edits('stage_2.glass_type', 'GLASS_NO_IGU'))).toEqual([]);
    expect(singleUnitSpecPatches(one, [
      { fieldPath: 'stage_2.glass_type', value: 'GLASS_NO_IGU' },
      { fieldPath: 'stage_2.units.A.value_glass_type', value: 'EGR' },
    ])).toEqual([]);
  });
});
