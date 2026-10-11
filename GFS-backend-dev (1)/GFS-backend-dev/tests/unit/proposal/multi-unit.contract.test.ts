import { normalizeAiMultiUnitPayload } from '../../../src/features/proposal/multi-unit.contract';

describe('normalizeAiMultiUnitPayload crossbeam contract', () => {
  it('normalizes legacy unit-map crossbeam fields and enum values', () => {
    const result = normalizeAiMultiUnitPayload({
      units: {
        A: {
          value_crossbeam: 'ECONOFRAME_35',
          extracted_crossbeam: 'NONE',
          crossbeam_confidence: 78,
          crossbeam_reasoning: 'AI selected this from the unit details.',
          crossbeam_citation: { source: 'drawing.pdf', page: 2 },
        },
      },
    });

    expect(result.units?.['A']).toMatchObject({
      value_cross_beam: 'ECONOFRAME_3_5',
      extracted_cross_beam: 'NO_BEAM',
      cross_beam_confidence: 0.78,
      cross_beam_reasoning: ['AI selected this from the unit details.'],
      cross_beam_citation: { source: 'drawing.pdf', page: 2 },
    });
    expect(result.units?.['A']).not.toHaveProperty('value_crossbeam');
    expect(result.units?.['A']).not.toHaveProperty('crossbeam_reasoning');
  });

  it('preserves canonical fields and normalizes legacy Vision array aliases', () => {
    const result = normalizeAiMultiUnitPayload({
      units: [
        {
          unit_label: 'A',
          value_crossbeam: 'NONE',
          crossbeam_confidence: 92,
          crossbeam_reasoning: ['No crossbeam is specified for this unit.'],
        },
      ],
    });

    expect(result.units?.['A']).toMatchObject({
      value_cross_beam: 'NO_BEAM',
      extracted_cross_beam: 'NO_BEAM',
      cross_beam_confidence: 0.92,
      cross_beam_reasoning: ['No crossbeam is specified for this unit.'],
    });
  });

  it('does not replace an explicit canonical value with a conflicting legacy alias', () => {
    const result = normalizeAiMultiUnitPayload({
      units: {
        A: {
          value_cross_beam: 'NO_BEAM',
          value_crossbeam: 'I_BEAM_TB',
        },
      },
    });

    expect(result.units?.['A']?.value_cross_beam).toBe('NO_BEAM');
  });

  it('accepts crossbeam codes emitted by the AI rules engine', () => {
    const result = normalizeAiMultiUnitPayload({
      units: { A: { value_crossbeam: 'I_BEAM_NTB' } },
    });

    expect(result.units?.['A']?.value_cross_beam).toBe('I_BEAM_NTB');
  });
});
