import {
  validateVisionPayload,
  visionCanonicalUnitsToMap,
  visionPayloadSchema,
} from '@features/proposal/vision.contract';

describe('vision API contract (canonical.py mirror)', () => {
  it('accepts a full canonical payload with the newly added signals', () => {
    const parsed = visionPayloadSchema.safeParse({
      project_id: 'proj-1',
      source_file: 'lead.pdf',
      source_type: 'lead_sheet',
      header_signals: {
        project_name: { value: '4 Jane Street', confidence: 'MEDIUM', verbatim: '4 Jane Street', page: 1, reasoning: 'title block' },
        project_type: { value: 'RESIDENTIAL', confidence: 90, verbatim: 'house', page: 1, reasoning: 'says house' },
      },
      glass_signals: {
        is_walkable: { value: true, confidence: 'MEDIUM', verbatim: 'walkable', page: 2, reasoning: 'walk-on label' },
        product_type: { value: 'SKYLIGHT', confidence: 'MEDIUM', verbatim: 'skylight', page: 2, reasoning: 'roof unit' },
      },
      frame_signals: {
        install_type: { value: 'CURB_MOUNTED', confidence: 'MEDIUM', verbatim: 'curb mounted', page: 2, reasoning: 'detail' },
        panel_configuration: { value: 'MULTI_PANEL', confidence: 'MEDIUM', verbatim: '3x3 configuration', page: 2, reasoning: 'grid callout' },
      },
      location_signals: {
        project_country: { value: 'US', confidence: 'MEDIUM', verbatim: 'NY 10001', page: 1, reasoning: 'zip' },
        is_expedited: { value: false, confidence: 'LOW', verbatim: null, page: null, reasoning: 'not stated' },
      },
      addon_signals: {
        has_krypton: { value: null, confidence: 'LOW', verbatim: null, page: null, reasoning: 'not mentioned' },
      },
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
          t_rafter_details: null,
          layout_source: '3x3 configuration callout',
          dimension_label_type: 'GLASS',
          confidence: 'MEDIUM',
          verbatim: 'nine 54x46 in 3x3 configuration',
          page: 3,
          reasoning: 'grid gives 9 panels',
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts sparse payloads that omit whole signal sections', () => {
    expect(validateVisionPayload({ source_file: null, units: [] }).success).toBe(true);
    expect(validateVisionPayload({}).success).toBe(true);
  });

  it('rejects mistyped known fields while preserving unknown keys', () => {
    const bad = validateVisionPayload({
      glass_signals: {
        is_walkable: { value: 'yes', confidence: 'MEDIUM' },
        product_type: { value: 'DOME', confidence: 'MEDIUM' },
      },
      frame_signals: {
        install_type: { value: 'FLOATING', confidence: 'MEDIUM' },
      },
      units: [{ unit_label: 'A', width_inches: -5 }],
    });

    expect(bad.success).toBe(false);
    if (!bad.success) {
      const paths = bad.error.issues.map((issue) => issue.path.join('.'));
      expect(paths.some((p) => p.includes('product_type'))).toBe(true);
      expect(paths.some((p) => p.includes('install_type'))).toBe(true);
      expect(paths.some((p) => p.includes('width_inches'))).toBe(true);
    }
  });

  it('maps canonical unit letters and seeds extracted/value layers', () => {
    const map = visionCanonicalUnitsToMap([
      {
        unit_label: 'B',
        location_description: 'Roof Deck East',
        width_inches: 48,
        length_inches: 96,
        panel_count: 3,
        rows: 1,
        columns: 3,
        vertical_rafter_count: 2,
        horizontal_rafter_count: 0,
        t_rafter_details: 'T-bar at grid C',
        layout_source: 'plan dimensions',
        dimension_label_type: 'EXPOSED_FRAME',
        confidence: 'MEDIUM',
        verbatim: '(3) 48x96',
        page: 2,
        reasoning: 'three openings grouped',
      } as never,
    ]);

    expect(Object.keys(map)).toEqual(['B']);
    expect(map['B']).toEqual(
      expect.objectContaining({
        unit_id: 'B',
        extracted_width_in: 48,
        value_width_in: 48,
        extracted_rows: 1,
        value_rows: 1,
        extracted_columns: 3,
        value_columns: 3,
        extracted_vertical_rafter_count: 2,
        value_vertical_rafter_count: 2,
        extracted_t_rafter_details: 'T-bar at grid C',
        value_t_rafter_details: 'T-bar at grid C',
        extracted_layout_source: 'plan dimensions',
        value_layout_source: 'plan dimensions',
        extracted_dim_type: 'EXPOSED_FRAME',
        reasoning: ['three openings grouped'],
      }),
    );
  });

  it('assigns sequential keys when labels are missing and caps at J', () => {
    const units = Array.from({ length: 12 }, (_, i) => ({
      location_description: `Unit ${i}`,
      width_inches: 24,
      length_inches: 48,
    }));
    const map = visionCanonicalUnitsToMap(units as never);

    expect(Object.keys(map)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });
});
