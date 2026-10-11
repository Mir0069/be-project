// =============================================================================
// EXCEL TEMPLATE MODEL
//
// Stores the master GFS Excel workbook template as a raw binary Buffer.
//
// DESIGN RULES:
//   - The template is NEVER mutated after upload.
//   - There is only ONE active template at a time (isActive: true).
//   - The Excel generator always fetches the active template and copies it
//     into memory before writing cell values. The stored template is never
//     written to.
//   - To upload a new template version, set the old one to isActive=false
//     and create a new document.
// =============================================================================

import { Schema, model, HydratedDocument } from 'mongoose';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// TYPESCRIPT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IExcelTemplateDoc {
  publicId:   string;
  name:       string;    // e.g. "GFS Standard Workbook"
  version:    string;    // e.g. "2024-01"
  /** Raw .xlsx binary — never mutated after upload */
  fileBuffer: Buffer;
  fileSizeBytes: number;
  isActive:   boolean;
  uploadedBy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGOOSE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const ExcelTemplateSchema = new Schema<IExcelTemplateDoc>(
  {
    publicId:      { type: String, required: true, unique: true, default: () => crypto.randomUUID() },
    name:          { type: String, required: true, trim: true },
    version:       { type: String, required: true, trim: true },
    fileBuffer:    { type: Buffer, required: true },
    fileSizeBytes: { type: Number, required: true, min: 0 },
    isActive:      { type: Boolean, required: true, default: false },
    uploadedBy:    { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Index for fast active-template lookup — only one document should have isActive=true
ExcelTemplateSchema.index({ isActive: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// MODEL EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const ExcelTemplateModel = model<IExcelTemplateDoc>(
  'ExcelTemplate',
  ExcelTemplateSchema,
);

export type ExcelTemplateDocument = HydratedDocument<IExcelTemplateDoc>;
