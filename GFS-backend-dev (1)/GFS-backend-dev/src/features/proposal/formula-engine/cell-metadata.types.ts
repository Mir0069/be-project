// =============================================================================
// CELL METADATA TYPES
// =============================================================================

export interface ICellMetadata {
  sheet: string;
  address: string;
  row: number;
  column: string;
  rawValue: string | null;
  cachedValue: string | null;
  isFormula: boolean;
  fill: string | null;
}

export interface ITemplateMetadata {
  cells: ICellMetadata[];
  cross_sheet_refs: string[][]; // [src_sheet, dst_sheet]
}
