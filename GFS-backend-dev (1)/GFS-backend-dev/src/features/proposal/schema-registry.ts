import {
  MULTI_UNIT_CROSSBEAM_TYPES,
  MULTI_UNIT_FRAME_TYPES,
  MULTI_UNIT_GLASS_TYPES,
} from './multi-unit.contract';

export type RegistryValueType = 'text' | 'number' | 'integer' | 'select' | 'yn' | 'calculated';

export interface FieldDefinition {
  path: string;
  stage: 1 | 2 | 3 | 4 | 5;
  label: string;
  manual: boolean;
  valueType?: RegistryValueType;
  editable?: boolean;
  min?: number;
  max?: number;
  allowedValues?: readonly string[];
  note?: string;
  excelCell?: string;
  internal?: boolean;
}

export const SCHEMA_FIELDS: readonly FieldDefinition[] = [
  // STAGE 1
  { path: 'stage_1.project_name', stage: 1, label: 'Project Name', manual: false, excelCell: 'C2' },
  { path: 'stage_1.project_address', stage: 1, label: 'Project Address', manual: false, excelCell: 'F2' },
  { path: 'stage_1.contact_name', stage: 1, label: 'Contact Name', manual: false, excelCell: 'C3' },
  { path: 'stage_1.contact_address', stage: 1, label: 'Contact Address', manual: false, excelCell: 'F3' },
  { path: 'stage_1.contact_phone', stage: 1, label: 'Contact Phone', manual: false, excelCell: 'I3' },
  { path: 'stage_1.contact_email', stage: 1, label: 'Contact Email', manual: false, excelCell: 'L3' },
  { path: 'stage_1.project_type', stage: 1, label: 'Project Type', manual: false, allowedValues: ['RESIDENTIAL', 'COMMERCIAL'], excelCell: 'C4' },
  { path: 'stage_1.architect', stage: 1, label: 'Architect', manual: false, excelCell: 'F4' },
  { path: 'stage_1.homeowner', stage: 1, label: 'Homeowner', manual: true, excelCell: 'I4' },
  { path: 'stage_1.drafter_designer', stage: 1, label: 'Drafter / Designer', manual: true, excelCell: 'L4' },
  { path: 'stage_1.person_quoting', stage: 1, label: 'Person Quoting', manual: true, editable: true, valueType: 'select', excelCell: 'L2' },
  { path: 'stage_1.person_checked', stage: 1, label: 'Person Checked Quote', manual: true, excelCell: 'P2' },

  // STAGE 2
  { path: 'stage_2._signals.is_walkable', stage: 2, label: 'Is Walkable', manual: false, internal: true },
  { path: 'stage_2._signals.is_exterior', stage: 2, label: 'Is Exterior', manual: false, internal: true },
  { path: 'stage_2._signals.has_air_gap', stage: 2, label: 'Has Air Gap', manual: false, internal: true },
  { path: 'stage_2._signals.has_conditioned_space_below', stage: 2, label: 'Has Conditioned Space Below', manual: false, internal: true },
  { path: 'stage_2._signals.has_wine_cellar_below', stage: 2, label: 'Has Wine Cellar Below', manual: false, internal: true },
  { path: 'stage_2._signals.has_open_space_below', stage: 2, label: 'Has Open Space Below', manual: false, internal: true },
  { path: 'stage_2._signals.is_stair_tread', stage: 2, label: 'Is Stair Tread', manual: false, internal: true },
  { path: 'stage_2._signals.is_egr', stage: 2, label: 'Is EGR', manual: false, internal: true },
  { path: 'stage_2._signals.is_replacement_glass_only', stage: 2, label: 'Is Replacement Glass Only', manual: false, internal: true },
  { path: 'stage_2._signals.is_glass_2_0', stage: 2, label: 'Is Glass 2.0', manual: false, internal: true },
  { path: 'stage_2._signals.product_type', stage: 2, label: 'Product Type', manual: false, allowedValues: ['GLASS_ONLY', 'SKYLIGHT', 'INTERIOR_FLOOR', 'NOT_STATED'], internal: true },
  { path: 'stage_2.glass_type', stage: 2, label: 'Glass Type', manual: false, allowedValues: ['GLASS_NO_IGU', 'GLASS_WITH_IGU', 'GLASS_2_0', 'STAIR_TREAD', 'NON_WALKABLE', 'EGR'] },

  // STAGE 3
  { path: 'stage_3._signals.frame_type_stated', stage: 3, label: 'Frame Type Stated', manual: false, internal: true },
  { path: 'stage_3._signals.product_type', stage: 3, label: 'Product Type', manual: false, allowedValues: ['GLASS_ONLY', 'SKYLIGHT', 'INTERIOR_FLOOR', 'NOT_STATED'], internal: true },
  { path: 'stage_3._signals.install_type', stage: 3, label: 'Install Type', manual: false, allowedValues: ['PEDESTAL', 'RECESSED', 'DECK_PERIMETER', 'CURB_MOUNTED', 'NOT_STATED'], internal: true },
  { path: 'stage_3._signals.panel_configuration', stage: 3, label: 'Panel Configuration', manual: false, allowedValues: ['SINGLE_PANEL', 'MULTI_PANEL', 'NOT_STATED'], internal: true },
  { path: 'stage_3._signals.is_existing_structure', stage: 3, label: 'Is Existing Structure', manual: false, internal: true },
  { path: 'stage_3._signals.is_new_deck_construction', stage: 3, label: 'Is New Deck Construction', manual: false, internal: true },
  { path: 'stage_3._signals.is_custom_radius', stage: 3, label: 'Is Custom Radius', manual: false, internal: true },
  { path: 'stage_3.decision.frame_type', stage: 3, label: 'Frame Type', manual: false, allowedValues: ['SERIES_2000_RECESSED', 'SERIES_2000_PEDESTAL', 'SERIES_1000_PEDESTAL', 'SERIES_1000_RECESSED', 'PERIMETER_NON_TB', 'DECK_PERIMETER', 'ECONOFRAME', 'SERIES_3000', 'SERIES_2000_WITH_PLATE', 'SERIES_2000_NON_WALKABLE', 'ROUND_FRAME_42', 'HORIZONTAL_CAP_SERIES_1000', 'VERTICAL_CAP_SERIES_1000', 'MANUAL'] },
  { path: 'stage_3.decision.proposal_number', stage: 3, label: 'Proposal Number', manual: false }, // Integer 1-15
  { path: 'stage_3.decision.proposal_description', stage: 3, label: 'Proposal Description', manual: true },
  { path: 'stage_3.decision.assembly_type', stage: 3, label: 'Assembly Type', manual: false, allowedValues: ['FA', 'KD', 'FACTORY_GLAZED', 'FIELD_GLAZED', 'MANUAL'] },

  // STAGE 4
  {
    path: 'stage_4.crossbeam',
    stage: 4,
    label: 'Crossbeam',
    manual: false,
    editable: true,
    valueType: 'select',
    allowedValues: MULTI_UNIT_CROSSBEAM_TYPES,
    note: 'Choose the crossbeam series from the Pricing Worksheet options before Stage 4 approval.',
  },
  {
    path: 'stage_4.takeoff.panel_count',
    stage: 4,
    label: 'Panel Count',
    manual: false,
    editable: true,
    valueType: 'integer',
    min: 0,
    note: 'Calculated from approved takeoff units and editable before stage approval.',
  },
  {
    path: 'stage_4.takeoff.packaging',
    stage: 4,
    label: 'Packaging',
    manual: true,
    editable: true,
    valueType: 'number',
    min: 0,
    excelCell: 'E73',
    note: 'Manual packaging quantity or cost input used by the pricing worksheet.',
  },

  // STAGE 5
  { path: 'stage_5._signals.has_nanodot', stage: 5, label: 'Has NanoDot', manual: false, internal: true },
  { path: 'stage_5._signals.has_seeded_organic', stage: 5, label: 'Has Seeded Organic', manual: false, internal: true },
  { path: 'stage_5._signals.has_krypton', stage: 5, label: 'Has Krypton', manual: false, internal: true },
  { path: 'stage_5._signals.project_country', stage: 5, label: 'Project Country', manual: false, allowedValues: ['US', 'CA'], internal: true },
  { path: 'stage_5._signals.is_expedited', stage: 5, label: 'Is Expedited', manual: false, internal: true },
  
  { path: 'stage_5.addons.duty', stage: 5, label: 'Duty', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'], excelCell: 'D90' },
  { path: 'stage_5.addons.heat_soak_testing', stage: 5, label: 'Heat Soak Testing', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  { path: 'stage_5.addons.nanodot', stage: 5, label: 'NanoDot', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  { path: 'stage_5.addons.seeded_organic', stage: 5, label: 'Seeded Organic', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  { path: 'stage_5.addons.sentry_glass', stage: 5, label: 'Sentry Glass', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  { path: 'stage_5.addons.krypton_gas', stage: 5, label: 'Krypton Gas', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  { path: 'stage_5.addons.custom_shape', stage: 5, label: 'Custom Shape', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  { path: 'stage_5.addons.backpaint', stage: 5, label: 'Backpaint', manual: false, allowedValues: ['y', 'n', 'MANUAL', 'PENDING'] },
  
  { path: 'stage_5.calculated.total_sqft', stage: 5, label: 'Total SqFt', manual: false },
  { path: 'stage_5.calculated.total_weight', stage: 5, label: 'Total Weight', manual: false },
  { path: 'stage_5.calculated.perimeter_lf', stage: 5, label: 'Perimeter LF', manual: false },
  { path: 'stage_5.calculated.silicone_tubes', stage: 5, label: 'Silicone Tubes', manual: false },
  { path: 'stage_5.calculated.total_man_hours', stage: 5, label: 'Total Man Hours', manual: false, note: 'Calculated by AI from takeoff data. Display-only — not written to Excel.' },
];

export function getFieldDefinition(path: string): FieldDefinition | undefined {
  if (path.startsWith('units.')) {
    return undefined; 
  }
  return SCHEMA_FIELDS.find(f => f.path === path);
}

export interface UnitFieldDefinition {
  valueType: 'text' | 'number' | 'integer' | 'select';
  min?: number;
  max?: number;
  allowedValues?: readonly string[];
}

// Unit fields mirror the takeoff columns in the Excel template and are validated separately
// because units live at the schema root rather than under a standard stage field.
const UNIT_FIELD_DEFINITIONS: Readonly<Record<string, UnitFieldDefinition>> = {
  unit_label: { valueType: 'text' },
  value_frame_type: { valueType: 'select', allowedValues: MULTI_UNIT_FRAME_TYPES },
  value_glass_type: { valueType: 'select', allowedValues: MULTI_UNIT_GLASS_TYPES },
  value_cross_beam: { valueType: 'select', allowedValues: MULTI_UNIT_CROSSBEAM_TYPES },
  value_location: { valueType: 'text' },
  value_drawing_number: { valueType: 'text' },
  // AI v4 wire name mirroring value_drawing_number (proposal.model.ts:139) —
  // hasRealUnitData (graph.generator.ts) checks both, so both must be
  // independently editable or clearing a unit's drawing number leaves this
  // one stale and the unit still counts as "real" for Excel generation.
  value_drawing_no: { valueType: 'text' },
  value_glass_thickness: { valueType: 'text' },
  value_width_in: { valueType: 'number', min: 0 },
  value_length_in: { valueType: 'number', min: 0 },
  value_panel_count: { valueType: 'integer', min: 0 },
  value_num_units: { valueType: 'integer', min: 1 },
  value_rafter_count: { valueType: 'integer', min: 0 },
  value_vertical_rafter_count: { valueType: 'integer', min: 0 },
  value_horizontal_rafter_count: { valueType: 'integer', min: 0 },
  value_rows: { valueType: 'integer', min: 0 },
  value_columns: { valueType: 'integer', min: 0 },
  // AI wire alias for value_columns (mirrored at the contract boundary).
  value_cols: { valueType: 'integer', min: 0 },
  value_t_rafter_details: { valueType: 'text' },
  value_layout_source: { valueType: 'text' },
  value_man_hours: { valueType: 'number', min: 0 },
  value_packaging: { valueType: 'number', min: 0 },
  value_description: { valueType: 'text' },
};

export function getUnitFieldDefinition(field: string): UnitFieldDefinition | undefined {
  return UNIT_FIELD_DEFINITIONS[field];
}

export function getUnitFieldDefinitions(): Readonly<Record<string, UnitFieldDefinition>> {
  return UNIT_FIELD_DEFINITIONS;
}

export function isInternalPath(path: string): boolean {
  return path === '_signals' || path.includes('._signals') || path.startsWith('_signals.');
}

/** A glass type an estimator can approve: one of the listed codes, never the AI's MANUAL or a blank. */
export function isResolvedGlassValue(value: unknown): value is string {
  const allowed = getFieldDefinition('stage_2.glass_type')?.allowedValues ?? [];
  return typeof value === 'string' && allowed.includes(value);
}

export function isResolvedCrossbeamValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toUpperCase();
  return normalized !== '' && normalized !== 'MANUAL';
}

export function createEmptySchema(): any {
  const schema: any = {
    stage_1: {},
    stage_2: { _signals: {} },
    stage_3: { _signals: {}, decision: {} },
    stage_4: { takeoff: {} },
    stage_5: { _signals: {}, addons: {}, calculated: {} },
    units: {},
    pipeline_status: {
      extraction_complete: false,
      extraction_at: null,
      stage_1_status: 'PENDING',
      stage_2_status: 'LOCKED',
      stage_3_status: 'LOCKED',
      stage_4_status: 'LOCKED',
      stage_5_status: 'LOCKED',
      stage_6_status: 'LOCKED',
    },
    stage_6: {
      cells: {},
      status: 'PENDING'
    },
    stage_6_proposal: {
      target_sheet: 'Proposal',
      cells: {},
      status: 'PENDING'
    },
  };

  for (const field of SCHEMA_FIELDS) {
    const parts = field.path.split('.');
    let current = schema;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!current[part]) current[part] = {};
      current = current[part];
    }
    const meta = {
      manual: field.manual,
      ...(field.valueType && { value_type: field.valueType }),
      ...(field.editable !== undefined && { editable: field.editable }),
      ...(field.min !== undefined && { min: field.min }),
      ...(field.max !== undefined && { max: field.max }),
      ...(field.excelCell && { excel_cell: field.excelCell }),
      ...(field.allowedValues && { allowed_values: field.allowedValues }),
      ...(field.note && { note: field.note }),
    };
    const leaf = parts[parts.length - 1]!;
    current[leaf] = { value: null, status: 'PENDING', _meta: meta };
  }

  // Pre-seed Units A-J
  const unitKeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const excelRows = [115, 116, 117, 118, 119, 120, 121, 122, 123, 124];
  unitKeys.forEach((key, index) => {
    const row = excelRows[index];
    schema.units[key] = {
      unit_id: key,
      status: 'PENDING',
      unit_label: null,
      value_frame_type: null,
      value_glass_type: null,
      value_width_in: null,
      value_length_in: null,
      value_panel_count: null,
      value_rafter_count: null,
      value_vertical_rafter_count: null,
      value_horizontal_rafter_count: null,
      value_rows: null,
      value_columns: null,
      value_cols: null,
      value_is_grid_confirmed: null,
      value_t_rafter_details: null,
      value_layout_source: null,
      value_man_hours: null,
      value_packaging: null,
      value_description: null,
      value_num_units: 1,
      value_location: null,
      value_drawing_number: null,
      value_glass_thickness: null,
      excel_takeoff_row: row,
      excel_width_cell: `E${row}`,
      excel_length_cell: `F${row}`,
      excel_panel_cell: `G${row}`,
      excel_location_cell: `B${row}`,
      excel_drawing_cell: `C${row}`,
      excel_num_units_cell: `J${row}`,
      excel_vert_rafter_cell: `K${row}`,
      excel_horiz_rafter_cell: `L${row}`,
      excel_glass_thickness_cell: `M${row}`,
      excel_glass_trigger_cell: `D9`,
      excel_hst_trigger_cell: `D109`,
      excel_nanodot_trigger_cell: `D110`,
      excel_seeded_trigger_cell: `D107`,
    };
  });

  return schema;
}
