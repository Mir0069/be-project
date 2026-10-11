import { Schema } from 'mongoose';

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

export interface ExcelPosition {
  sheetName: string;
  row: number;
  column: number;
  cell: string;
  isMerged?: boolean;
  mergeStartRow?: number;
  mergeStartColumn?: number;
  mergeEndRow?: number;
  mergeEndColumn?: number;
  isFormula?: boolean;
  formula?: string;
  styleId?: string;
  numberFormat?: string;
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  wrapText?: boolean;
  locked?: boolean;
  hidden?: boolean;
  dynamicRowOffset?: number;
  dynamicColumnOffset?: number;
  notes?: string;
}

export interface ExcelTableColumnMap {
  column: number;
}

export interface ExcelTable {
  tableName: string;
  sheetName: string;
  startRow: number;
  startColumn: number;
  endColumn: number;
  rowIncrement: number;
  repeatable: boolean;
  dynamicExpansion?: boolean;
  headerRow?: number;
  footerRow?: number;
  columnMap: Map<string, ExcelTableColumnMap>;
}

export interface ExcelSheet {
  sheetName: string;
  sheetIndex: number;
  hidden?: boolean;
  freezePane?: string;
  printArea?: string;
  defaultRowHeight?: number;
  defaultColumnWidth?: number;
  positions?: ExcelPosition[];
  tables?: ExcelTable[];
}

export interface ExcelWorkbookLayout {
  version: string;
  templateName: string;
  templateVersion: string;
  sheets: ExcelSheet[];
  fieldMappings: Map<string, ExcelPosition>;
  tableMappings: Map<string, ExcelTable>;
}

// ============================================================================
// MONGOOSE SCHEMAS
// ============================================================================

export const ExcelPositionSchema = new Schema<ExcelPosition>({
  sheetName: { type: String, required: true },
  row: { type: Number, required: true },
  column: { type: Number, required: true },
  cell: { type: String, required: true },
  isMerged: { type: Boolean, default: false },
  mergeStartRow: { type: Number },
  mergeStartColumn: { type: Number },
  mergeEndRow: { type: Number },
  mergeEndColumn: { type: Number },
  isFormula: { type: Boolean, default: false },
  formula: { type: String },
  styleId: { type: String },
  numberFormat: { type: String },
  horizontalAlignment: { type: String, enum: ['left', 'center', 'right', 'justify'] },
  verticalAlignment: { type: String, enum: ['top', 'middle', 'bottom'] },
  wrapText: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  hidden: { type: Boolean, default: false },
  dynamicRowOffset: { type: Number },
  dynamicColumnOffset: { type: Number },
  notes: { type: String }
}, { _id: false });

export const ExcelTableColumnMapSchema = new Schema<ExcelTableColumnMap>({
  column: { type: Number, required: true }
}, { _id: false });

export const ExcelTableSchema = new Schema<ExcelTable>({
  tableName: { type: String, required: true },
  sheetName: { type: String, required: true },
  startRow: { type: Number, required: true },
  startColumn: { type: Number, required: true },
  endColumn: { type: Number, required: true },
  rowIncrement: { type: Number, default: 1 },
  repeatable: { type: Boolean, default: true },
  dynamicExpansion: { type: Boolean, default: true },
  headerRow: { type: Number },
  footerRow: { type: Number },
  columnMap: {
    type: Map,
    of: ExcelTableColumnMapSchema,
    required: true
  }
}, { _id: false });

export const ExcelSheetSchema = new Schema<ExcelSheet>({
  sheetName: { type: String, required: true },
  sheetIndex: { type: Number, required: true },
  hidden: { type: Boolean, default: false },
  freezePane: { type: String },
  printArea: { type: String },
  defaultRowHeight: { type: Number },
  defaultColumnWidth: { type: Number },
  positions: { type: [ExcelPositionSchema], default: [] },
  tables: { type: [ExcelTableSchema], default: [] }
}, { _id: false });

export const ExcelWorkbookLayoutSchema = new Schema<ExcelWorkbookLayout>({
  version: { type: String, required: true },
  templateName: { type: String, required: true },
  templateVersion: { type: String, required: true },
  sheets: { type: [ExcelSheetSchema], required: true },
  fieldMappings: {
    type: Map,
    of: ExcelPositionSchema,
    required: true
  },
  tableMappings: {
    type: Map,
    of: ExcelTableSchema,
    required: true
  }
}, { _id: false });