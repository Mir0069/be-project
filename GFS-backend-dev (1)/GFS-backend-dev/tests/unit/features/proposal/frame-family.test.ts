import {
  dropFrameDerivedFields,
  frameFamiliesNamedIn,
  frameFamilyOf,
  instructionNamesFrameFamily,
} from '../../../../src/features/proposal/frame-family';

describe('frame families', () => {
  it('groups Series 1000/2000 variants and keeps other codes as their own family', () => {
    expect(frameFamilyOf('SERIES_2000_RECESSED')).toBe('SERIES_2000');
    expect(frameFamilyOf('VERTICAL_CAP_SERIES_1000')).toBe('SERIES_1000');
    expect(frameFamilyOf('SERIES_3000')).toBe('SERIES_3000');
    expect(frameFamilyOf('ECONOFRAME')).toBe('ECONOFRAME');
  });

  it.each([
    ['spoke with customer they needed glass with igu and frame type of series 3000', 'SERIES_3000'],
    ['frame type  of series  2000 recesses at unitB', 'SERIES_2000'],
    ['switch to S3000 please', 'SERIES_3000'],
    ['they want the 1000 series pedestal', 'SERIES_1000'],
    ['go with Econo-Frame', 'ECONOFRAME'],
    ['perimeter non thermally broken frame', 'PERIMETER_NON_TB'],
    ['use a deck perimeter', 'DECK_PERIMETER'],
    ['a 42" round frame', 'ROUND_FRAME_42'],
  ])('reads "%s" as naming %s', (text, family) => {
    expect(frameFamiliesNamedIn(text).has(family)).toBe(true);
  });

  it('does not see a family in unrelated numbers', () => {
    expect(frameFamiliesNamedIn('budget is 3000 dollars for 3000 units').size).toBe(0);
    expect(frameFamiliesNamedIn(null).size).toBe(0);
  });

  it('authorises only the family the instruction names', () => {
    const note = 'frame type of series 3000';
    expect(instructionNamesFrameFamily(note, 'SERIES_3000')).toBe(true);
    expect(instructionNamesFrameFamily(note, 'SERIES_2000_RECESSED')).toBe(false);
    expect(instructionNamesFrameFamily(null, 'SERIES_3000')).toBe(false);
    expect(instructionNamesFrameFamily('use manual pricing', 'MANUAL')).toBe(false);
  });
});

describe('dropFrameDerivedFields', () => {
  it('removes what the rules derived from a rejected frame and keeps extracted signals', () => {
    const stage3 = {
      decision: { proposal_number: { value: 7 }, assembly_type: { value: 'MANUAL' }, proposal_description: { value: null } },
      _signals: {
        install_type: { value: 'RECESSED', updated_by: 'rules_engine' },
        frame_type_stated: { value: 'EconoFrame' },
      },
    };

    expect(dropFrameDerivedFields(stage3)).toEqual([
      'stage_3.decision.proposal_number',
      'stage_3.decision.assembly_type',
      'stage_3._signals.install_type',
    ]);
    expect(Object.keys(stage3.decision)).toEqual(['proposal_description']);
    expect(Object.keys(stage3._signals)).toEqual(['frame_type_stated']);
  });

  it('keeps an install type the AI read from a document', () => {
    const stage3 = { _signals: { install_type: { value: 'PEDESTAL', updated_by: 'extraction' } } };
    expect(dropFrameDerivedFields(stage3)).toEqual([]);
    expect(stage3._signals.install_type.value).toBe('PEDESTAL');
  });
});
