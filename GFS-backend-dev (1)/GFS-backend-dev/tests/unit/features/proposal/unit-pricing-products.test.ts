import {
  matchCrossbeamKey,
  matchFrameTypeKey,
  resolveUnitProducts,
} from '../../../../src/features/proposal/unit-pricing-products';
import { matchCrossbeamKey as generatorMatchCrossbeamKey } from '../../../../src/features/proposal/excel/graph.generator';
import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { IProjectSchema } from '../../../../src/db/models/proposal.model';

const field = (value: unknown) => ({ value, status: 'APPROVED' }) as any;

describe('resolveUnitProducts', () => {
  const projectSchema = () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type = field('GLASS_NO_IGU');
    schema.stage_3.decision.frame_type = field('SERIES_2000_PEDESTAL');
    schema.stage_4.crossbeam = field('I_BEAM_TB');
    return schema;
  };

  it('uses the unit\'s own glass, frame and crossbeam', () => {
    const schema = projectSchema();
    Object.assign(schema.units['A']!, {
      value_glass_type: 'GLASS_WITH_IGU',
      value_frame_type: 'SERIES_1000_PEDESTAL',
      value_cross_beam: 'I_BEAM_TB',
    });

    expect(resolveUnitProducts(schema, 'A')).toEqual({
      glass: 'GLASS_WITH_IGU',
      frame: 'SERIES_1000_PEDESTAL',
      crossbeam: 'SERIES_1000_I_BEAM_TB',
    });
  });

  it('reads the unit crossbeam the AI stores as value_crossbeam', () => {
    const schema = projectSchema();
    Object.assign(schema.units['A']!, { value_frame_type: 'SERIES_1000_PEDESTAL', value_crossbeam: 'I_BEAM_TB' });

    expect(resolveUnitProducts(schema, 'A').crossbeam).toBe('SERIES_1000_I_BEAM_TB');
  });

  it('falls back to the project decision for anything the unit does not set', () => {
    expect(resolveUnitProducts(projectSchema(), 'B')).toEqual({
      glass: 'GLASS_NO_IGU',
      frame: 'SERIES_2000_PEDESTAL',
      crossbeam: 'SERIES_2000_I_BEAM_TB',
    });
  });

  it('resolves nothing for MANUAL or missing selections', () => {
    const schema = createEmptySchema() as IProjectSchema;
    Object.assign(schema.units['A']!, { value_frame_type: 'MANUAL', value_cross_beam: 'NO_BEAM' });

    expect(resolveUnitProducts(schema, 'A')).toEqual({ glass: null, frame: null, crossbeam: null });
  });
});

describe('product matchers', () => {
  it('maps Series 2000 non-walkable frames to their own row', () => {
    expect(matchFrameTypeKey('SERIES_2000_NON_WALKABLE')).toBe('SERIES_2000_NON_WALKABLE');
    expect(matchFrameTypeKey('Series 2000 non-walkable')).toBe('SERIES_2000_NON_WALKABLE');
  });

  it('treats T_SECTION_NTB as not thermally broken', () => {
    expect(matchCrossbeamKey('T_SECTION_NTB', 'SERIES_1000_PEDESTAL')).toBe('SERIES_1000_T_SECTION');
    expect(matchCrossbeamKey('T_SECTION_TB', 'SERIES_1000_PEDESTAL')).toBe('SERIES_1000_T_SECTION_TB');
  });

  it('keeps mapping the Pricing Worksheet crossbeam labels exactly as before', () => {
    expect(generatorMatchCrossbeamKey('Series 1000 T - Section thermally Broken')).toBe('SERIES_1000_T_SECTION_TB');
    expect(generatorMatchCrossbeamKey('Series 1000 I - Beam thermally broken')).toBe('SERIES_1000_I_BEAM_TB');
    expect(generatorMatchCrossbeamKey('Series 1000 T - Section ')).toBe('SERIES_1000_T_SECTION');
    expect(generatorMatchCrossbeamKey('Series 1000 I - Beam ')).toBe('SERIES_1000_I_BEAM');
    expect(generatorMatchCrossbeamKey('Series 2000 T section thermally broken')).toBe('SERIES_2000_T_SECTION_TB');
    expect(generatorMatchCrossbeamKey('Series 2000 I beam thermally broken')).toBe('SERIES_2000_I_BEAM_TB');
    expect(generatorMatchCrossbeamKey('Econoframe 2.5"')).toBe('ECONOFRAME_2_5');
    expect(generatorMatchCrossbeamKey('Econoframe 3.5"')).toBe('ECONOFRAME_3_0');
  });
});
