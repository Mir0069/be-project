import {
  aiStageResultBodySchema,
  dropInvalidUnitFields,
  normalizeAiMultiUnitPayload,
} from '@features/proposal/multi-unit.contract';

describe('multi-unit AI contract', () => {
  it('validates and normalizes the documented Stage 4 wrapper', () => {
    const payload = normalizeAiMultiUnitPayload({
      stage: 4,
      fields_to_show: {
        takeoff: { panel_count: { value: 5 } },
        units: {
          A: {
            value_width_in: '48',
            value_length_in: 96,
            value_panel_count: '3',
            value_num_units: 1,
          value_frame_type: 'SERIES_2000_PEDESTAL',
          value_glass_type: 'GLASS_WITH_IGU',
          value_cross_beam: 'SERIES_2000_T_SECTION_TB',
          cross_beam_confidence: 92,
          },
        },
      },
    });

    expect(payload['units']).toEqual({
      A: expect.objectContaining({
        unit_id: 'A',
        value_width_in: 48,
        value_panel_count: 3,
        value_frame_type: 'SERIES_2000_PEDESTAL',
        value_glass_type: 'GLASS_WITH_IGU',
        value_cross_beam: 'SERIES_2000_T_SECTION_TB',
      }),
    });
    expect((payload['fields_to_show'] as Record<string, unknown>)['units']).toBeUndefined();
  });

  it('accepts the legacy root-level units shape', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      stage: 0,
      units: {
        A: { value_width_in: 48, value_length_in: 96 },
        B: { value_width_in: 36, value_length_in: 72 },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects unknown unit keys and mismatched unit ids', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      units: {
        K: { value_width_in: 48 },
        A: { unit_id: 'B', value_width_in: 36 },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects invalid unit-specific frame/glass values and negative dimensions', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      units: {
        A: {
          value_width_in: -1,
          value_frame_type: 'UNKNOWN_FRAME',
          value_glass_type: 'UNKNOWN_GLASS',
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('merges unit maps from every wrapper location instead of dropping all but the first', () => {
    const payload = normalizeAiMultiUnitPayload({
      stage: 4,
      units: {
        A: { value_width_in: 48, value_length_in: 96 },
      },
      fields_to_show: {
        units: {
          B: { value_width_in: 36, value_length_in: 72 },
        },
      },
    });

    expect(Object.keys(payload['units'] ?? {}).sort()).toEqual(['A', 'B']);
  });

  it('normalizes a 0-100 per-unit confidence into the 0-1 scale once', () => {
    const payload = normalizeAiMultiUnitPayload({
      stage: 4,
      fields_to_show: {
        units: {
          A: { value_width_in: 48, extracted_confidence: 94 },
        },
      },
    });

    expect((payload['units'] as Record<string, any>)['A'].extracted_confidence).toBeCloseTo(0.94);
  });

  it('accepts the canonical Vision layout fields added from canonical.py', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      stage: 4,
      units: {
        A: {
          value_width_in: 54,
          value_length_in: 46,
          value_panel_count: 9,
          value_rows: 3,
          value_columns: 3,
          value_vertical_rafter_count: 2,
          value_horizontal_rafter_count: 2,
          value_t_rafter_details: 'T-bar at grid C',
          value_layout_source: '3x3 configuration callout',
          extracted_rows: 3,
          extracted_columns: 3,
          extracted_vertical_rafter_count: 2,
          extracted_horizontal_rafter_count: 2,
          extracted_t_rafter_details: 'T-bar at grid C',
          extracted_layout_source: '3x3 configuration callout',
          extracted_dim_type: 'EXPOSED_FRAME',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('normalizes a canonical Vision units array into the backend map', () => {
    const payload = normalizeAiMultiUnitPayload({
      stage: 0,
      status: 'EXTRACTION_DONE',
      units: [
        {
          unit_label: 'A',
          location_description: 'Gym Skylights',
          width_inches: 54,
          length_inches: 46,
          panel_count: 9,
          rows: 3,
          columns: 3,
          vertical_rafter_count: 2,
          horizontal_rafter_count: 2,
          layout_source: '3x3 configuration callout',
          dimension_label_type: 'GLASS',
          confidence: 'MEDIUM',
          verbatim: 'nine 54x46 in 3x3 configuration',
          page: 3,
          reasoning: 'grid gives 9 panels',
        },
      ],
    });

    expect(payload['units']).toEqual({
      A: expect.objectContaining({
        unit_id: 'A',
        value_width_in: 54,
        value_rows: 3,
        value_columns: 3,
        value_layout_source: '3x3 configuration callout',
        extracted_location: 'Gym Skylights',
      }),
    });
  });

  it('accepts canonical Vision arrays wrapped in fields_to_show', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      stage: 4,
      fields_to_show: {
        units: [
          {
            location_description: 'Roof Deck East',
            width_inches: 48,
            length_inches: 96,
            rows: 1,
            columns: 2,
          },
        ],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects invalid canonical Vision array entries', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      units: [
        {
          unit_label: 'A',
          width_inches: -12,
          dimension_label_type: 'DOME',
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts the §2a per-unit fields: unit_label, value_cols, grid confirmation', () => {
    const parsed = aiStageResultBodySchema.safeParse({
      stage: 2,
      units: {
        A: {
          unit_label: 'Skylight assembly 1',
          value_width_in: 54,
          value_length_in: 46,
          value_panel_count: 9,
          value_rows: 3,
          value_cols: 3,
          value_is_grid_confirmed: true,
          value_glass_type: 'GLASS_WITH_IGU',
          value_frame_type: 'SERIES_2000_PEDESTAL',
          extracted_glass_thickness: '1 inch',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('mirrors value_cols to value_columns so both readers agree', () => {
    const payload = normalizeAiMultiUnitPayload({
      stage: 3,
      units: {
        A: { value_width_in: 54, value_length_in: 46, value_cols: 3 },
        B: { value_width_in: 36, value_length_in: 36, value_columns: 2 },
      },
    });

    const units = payload['units'] as Record<string, any>;
    expect(units['A'].value_columns).toBe(3);
    expect(units['A'].value_cols).toBe(3);
    expect(units['B'].value_cols).toBe(2);
    expect(units['B'].value_columns).toBe(2);
  });

  it('normalizes a stage 2/3/5 per-unit spec payload without dropping units', () => {
    const payload = normalizeAiMultiUnitPayload({
      stage: 5,
      status: 'SUCCESS',
      fields_to_show: {
        stage_5: { calculated: { total_man_hours: { value: 12 } } },
        units: {
          A: {
            unit_id: 'A',
            value_glass_type: 'GLASS_WITH_IGU',
            value_frame_type: 'SERIES_2000_PEDESTAL',
            value_man_hours: 7.5,
            value_calculated_sqft: 25,
          },
          B: {
            unit_id: 'B',
            value_glass_type: 'GLASS_NO_IGU',
            value_frame_type: 'SERIES_1000_RECESSED',
            value_man_hours: 4.5,
            value_calculated_sqft: 16,
          },
        },
      },
    });

    const units = payload['units'] as Record<string, any>;
    expect(Object.keys(units).sort()).toEqual(['A', 'B']);
    // Per-unit values must differ per unit — never stamped with one global spec.
    expect(units['A'].value_glass_type).toBe('GLASS_WITH_IGU');
    expect(units['B'].value_glass_type).toBe('GLASS_NO_IGU');
    expect(units['A'].value_frame_type).toBe('SERIES_2000_PEDESTAL');
    expect(units['B'].value_frame_type).toBe('SERIES_1000_RECESSED');
    expect(units['A'].value_man_hours).toBe(7.5);
  });

  // Regression: GFS-AI writes extracted_at with Python's isoformat(), i.e. a
  // "+00:00" offset. Rejecting it 400'd every Stage 2-5 result for units that
  // carry an extraction timestamp, silently dropping descriptions/man hours.
  it('accepts a Python isoformat extracted_at with a UTC offset', () => {
    const body = {
      stage: 5,
      status: 'SUCCESS',
      fields_to_show: {
        stage_5: {},
        units: {
          A: {
            value_width_in: 156.5,
            value_length_in: 36,
            value_man_hours: 8,
            value_description: '(1 Qty.) 156.5" x 36" modified interior floor glass flooring system, 1 panel',
            extracted_at: '2026-09-23T14:26:54.264634+00:00',
          },
        },
      },
    };

    expect(aiStageResultBodySchema.safeParse(body).success).toBe(true);
    const units = normalizeAiMultiUnitPayload(body).units as any;
    expect(units['A'].value_description).toContain('156.5" x 36"');
  });
});

describe('dropInvalidUnitFields', () => {
  // The shape GFS-AI actually sent on 2026-09-29, which returned 400 for Stages 2-5.
  const rejectedStage2 = () => ({
    stage: 2,
    status: 'SUCCESS',
    fields_to_show: {
      stage_2: { glass_type: { value: 'GLASS_2_0' } },
      units: {
        A: {
          unit_id: 'A',
          status: 'NEEDS_REVIEW',
          value_width_in: 60,
          value_glass_type: 'TRIPLE-INSULATED GLAZING',
          extracted_glass_type: '10MM LOW IRON TEMPERED + 1.52MM SENTRYGLAS',
          value_frame_type: 'SERIES 2000',
          extracted_frame_type: 'SERIES_2000_PEDESTAL',
          value_crossbeam: 'econoframe_35',
          extracted_at: '2026-09-29T15:32:10.354165+00:00',
        },
      },
    },
  });

  it('keeps NEEDS_REVIEW as a valid unit status', () => {
    const payload = rejectedStage2();
    delete (payload.fields_to_show.units.A as any).value_glass_type;
    delete (payload.fields_to_show.units.A as any).extracted_glass_type;
    delete (payload.fields_to_show.units.A as any).value_frame_type;
    expect(aiStageResultBodySchema.safeParse(payload).success).toBe(true);
  });

  it('drops only the invalid unit values so the rest of the result is accepted', () => {
    const payload = rejectedStage2();
    expect(aiStageResultBodySchema.safeParse(payload).success).toBe(false);

    expect(dropInvalidUnitFields(payload)).toEqual([
      'fields_to_show.units.A.value_glass_type',
      'fields_to_show.units.A.extracted_glass_type',
      'fields_to_show.units.A.value_frame_type',
    ]);
    expect(aiStageResultBodySchema.safeParse(payload).success).toBe(true);

    const unit = payload.fields_to_show.units.A as Record<string, unknown>;
    expect(unit).toMatchObject({
      status: 'NEEDS_REVIEW',
      value_width_in: 60,
      extracted_frame_type: 'SERIES_2000_PEDESTAL',
      value_cross_beam: 'ECONOFRAME_3_5',
    });
    expect(unit).not.toHaveProperty('value_crossbeam');
  });

  it('still rejects unit keys outside A-J', () => {
    const payload = { units: { K: { value_width_in: 10 } } };
    expect(dropInvalidUnitFields(payload)).toEqual([]);
    expect(aiStageResultBodySchema.safeParse(payload).success).toBe(false);
  });
});
