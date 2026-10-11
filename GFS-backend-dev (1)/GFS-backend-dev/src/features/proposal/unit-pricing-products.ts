import type { IProjectSchema } from '@db/models/proposal.model';

// Which glass, frame and crossbeam row each unit is priced with. Shared by the
// Final Parameters calculator and the workbook writer so both pick the same rows.

export type ProductGroup = 'glass' | 'frame' | 'crossbeam';
export type UnitProducts = Record<ProductGroup, string | null>;

export const PRODUCT_GROUPS: readonly ProductGroup[] = ['glass', 'frame', 'crossbeam'];

/** Pricing Worksheet cost cell (column C) of every glass, frame and crossbeam product. */
export const PRODUCT_COST_CELLS: Record<ProductGroup, Record<string, string>> = {
  glass: {
    GLASS_NO_IGU: 'C9',
    GLASS_WITH_IGU: 'C10',
    GLASS_2_0: 'C11',
    STAIR_TREAD: 'C12',
    NON_WALKABLE: 'C13',
    EGR: 'C14',
  },
  frame: {
    SERIES_1000_PEDESTAL: 'C38',
    SERIES_1000_RECESSED: 'C39',
    PERIMETER_NON_TB: 'C40',
    SERIES_2000_PEDESTAL: 'C41',
    SERIES_2000_RECESSED: 'C42',
    SERIES_2000_WITH_PLATE: 'C43',
    SERIES_2000_NON_WALKABLE: 'C44',
    SERIES_3000: 'C45',
    DECK_PERIMETER: 'C46',
    ECONOFRAME: 'C47',
    ROUND_FRAME_42: 'C48',
    HORIZONTAL_CAP_SERIES_1000: 'C49',
    VERTICAL_CAP_SERIES_1000: 'C50',
  },
  crossbeam: {
    SERIES_1000_T_SECTION_TB: 'C53',
    SERIES_1000_I_BEAM_TB: 'C54',
    SERIES_1000_T_SECTION: 'C55',
    SERIES_1000_I_BEAM: 'C56',
    SERIES_2000_T_SECTION_TB: 'C57',
    SERIES_2000_I_BEAM_TB: 'C58',
    ECONOFRAME_2_5: 'C59',
    ECONOFRAME_3_0: 'C60',
  },
};

export const PRODUCT_CELLS: ReadonlySet<string> = new Set(
  PRODUCT_GROUPS.flatMap((group) => Object.values(PRODUCT_COST_CELLS[group])),
);

export function hasRealUnitData(unit: IProjectSchema['units'][string] | null | undefined): boolean {
  if (!unit) return false;
  return (
    unit.value_frame_type != null ||
    unit.value_glass_type != null ||
    unit.value_cross_beam != null ||
    unit.value_glass_thickness != null ||
    unit.value_width_in != null ||
    unit.value_length_in != null ||
    unit.value_panel_count != null ||
    unit.value_location != null ||
    unit.value_drawing_number != null ||
    (unit as unknown as Record<string, unknown>)['value_drawing_no'] != null ||
    unit.value_vertical_rafter_count != null ||
    unit.value_horizontal_rafter_count != null
  );
}

export function matchGlassTypeKey(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase();
  if (s.includes('WITH IGU') || s.includes('WITH_IGU')) return 'GLASS_WITH_IGU';
  if (s.includes('2.0') || s.includes('2_0')) return 'GLASS_2_0';
  if (s.includes('STAIR')) return 'STAIR_TREAD';
  if (s.includes('NON-WALKABLE') || s.includes('NON_WALKABLE') || s.includes('NON WALKABLE')) return 'NON_WALKABLE';
  if (s.includes('EGR')) return 'EGR';
  return 'GLASS_NO_IGU';
}

export function matchFrameTypeKey(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase();
  if (s.includes('1000') && s.includes('PEDESTAL')) return 'SERIES_1000_PEDESTAL';
  if (s.includes('1000') && s.includes('RECESSED')) return 'SERIES_1000_RECESSED';
  if (s.includes('NON-THERMALLY') || s.includes('NON_TB') || s.includes('NON THERMALLY') || s.includes('NON-TB')) return 'PERIMETER_NON_TB';
  if (s.includes('2000') && s.includes('PEDESTAL')) return 'SERIES_2000_PEDESTAL';
  if (s.includes('2000') && s.includes('RECESSED')) return 'SERIES_2000_RECESSED';
  if (s.includes('2000') && s.includes('PLATE')) return 'SERIES_2000_WITH_PLATE';
  if (s.includes('2000') && (s.includes('NON-WALKABLE') || s.includes('NON_WALKABLE') || s.includes('NON WALKABLE'))) return 'SERIES_2000_NON_WALKABLE';
  if (s.includes('3000')) return 'SERIES_3000';
  if (s.includes('DECK')) return 'DECK_PERIMETER';
  if (s.includes('ECONOFRAME')) return 'ECONOFRAME';
  if (s.includes('ROUND')) return 'ROUND_FRAME_42';
  if (s.includes('HORIZONTAL') && s.includes('1000')) return 'HORIZONTAL_CAP_SERIES_1000';
  if (s.includes('VERTICAL') && s.includes('1000')) return 'VERTICAL_CAP_SERIES_1000';
  return 'SERIES_2000_PEDESTAL';
}

export function matchCrossbeamKey(raw: unknown, frameType?: unknown): string | null {
  const s = String(raw ?? '').toUpperCase().trim();
  if (!s || s === 'NONE' || s === 'NULL' || s === 'UNDEFINED') return null;

  if (s.includes('2.5') || s.includes('2_5')) return 'ECONOFRAME_2_5';
  if (s.includes('3.0') || s.includes('3_0') || s.includes('3.5') || s.includes('3_5') || s.includes('ECONOFRAME_3')) return 'ECONOFRAME_3_0';

  // "NTB" (e.g. T_SECTION_NTB) means NOT thermally broken, even though it contains "TB".
  const isNonTB = s.includes('NTB') || s.includes('NON_TB') || s.includes('NON-TB') || s.includes('NON THERMAL') || s.includes('NON-THERMAL');
  const isTB = !isNonTB && (s.includes('TB') || s.includes('THERMAL'));
  const isT = s.includes('T_SECTION') || s.includes('T-SECTION') || s.includes('T SECTION') || /(?:^|[\s_-])T(?:[\s_-]|$)/.test(s);
  const isI = s.includes('I_BEAM') || s.includes('I-BEAM') || s.includes('I BEAM') || /(?:^|[\s_-])I(?:[\s_-]|$)/.test(s);

  let is2000 = false;
  if (s.includes('2000')) {
    is2000 = true;
  } else if (s.includes('1000')) {
    is2000 = false;
  } else {
    is2000 = String(frameType ?? '').includes('2000');
  }

  if (is2000) {
    if (isT) return 'SERIES_2000_T_SECTION_TB';
    if (isI) return 'SERIES_2000_I_BEAM_TB';
  } else {
    if (isT) return isTB ? 'SERIES_1000_T_SECTION_TB' : 'SERIES_1000_T_SECTION';
    if (isI) return isTB ? 'SERIES_1000_I_BEAM_TB' : 'SERIES_1000_I_BEAM';
  }
  return null;
}

// MANUAL means the estimator prices it by hand, so it maps to no worksheet row.
const isChosen = (raw: unknown): raw is string =>
  typeof raw === 'string' && raw.trim() !== '' && raw.trim().toUpperCase() !== 'MANUAL';

/** The unit's own glass/frame/crossbeam, falling back to the project decision exactly like the workbook. */
export function resolveUnitProducts(schema: IProjectSchema, unitKey: string): UnitProducts {
  const unit = schema.units?.[unitKey];
  const rawGlass = unit?.value_glass_type ?? schema.stage_2?.glass_type?.value;
  const rawFrame = unit?.value_frame_type ?? schema.stage_3?.decision?.frame_type?.value;
  // The AI stores the unit crossbeam as value_crossbeam; the schema field is value_cross_beam.
  const unitCrossbeam = unit?.value_cross_beam ?? (unit as Record<string, unknown> | undefined)?.['value_crossbeam'];
  const rawCrossbeam = unitCrossbeam ?? schema.stage_4?.crossbeam?.value;
  return {
    glass: isChosen(rawGlass) ? matchGlassTypeKey(rawGlass) : null,
    frame: isChosen(rawFrame) ? matchFrameTypeKey(rawFrame) : null,
    crossbeam: matchCrossbeamKey(rawCrossbeam, rawFrame),
  };
}
