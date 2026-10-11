import mongoose, { Document, Schema } from 'mongoose';

// ------------------------------------------------------------------------
// ENUMS ALIGNED WITH AI'S SPECIFICATION (Section 3.1 & 3.2) from docs/AI-Excel-Integration-Specification.md
// ------------------------------------------------------------------------
export enum AIStageStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  ERROR = 'error'
}

export enum AIFieldStatus {
  EXTRACTED = 'EXTRACTED',
  LOW_CONFIDENCE = 'LOW_CONFIDENCE',
  MANUAL = 'MANUAL',
  AWAITING = 'AWAITING'
}

export enum AIConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

// ------------------------------------------------------------------------
// THE UNIVERSAL FIELD CONTRACT (Section 3)
// Every field extracted by AI uses this exact format.
// ------------------------------------------------------------------------
const AIFieldSchema = new Schema({
  cell: { type: String, required: true },                 // Excel cell address (e.g., "E115")
  label: { type: String, required: true },                // Human-readable UI label
  value: { type: Schema.Types.Mixed, default: null },     // Extracted value (String/Number)
  confidence: { type: String, enum: Object.values(AIConfidence), required: true },
  reference: { type: String, default: null },             // Document page & text reference
  status: { type: String, enum: Object.values(AIFieldStatus), required: true },
  stage: { type: Number, required: true }                 // 1, 2, 3, or 4
}, { _id: false });

// ------------------------------------------------------------------------
// THE STAGE GATE SCHEMA (Section 2.4)
// ------------------------------------------------------------------------
const AIStageSchema = new Schema({
  status: { type: String, enum: Object.values(AIStageStatus), default: AIStageStatus.PENDING },
  fields: { type: [AIFieldSchema], default: [] }
}, { _id: false });

// Stage 4 produces final cell writes for Excel Engine, not just fields
const AIStage4Schema = new Schema({
  status: { type: String, enum: Object.values(AIStageStatus), default: AIStageStatus.PENDING },
  cell_writes: { type: [Schema.Types.Mixed], default: [] } 
}, { _id: false });

// ------------------------------------------------------------------------
// MAIN PROJECT PARAMETER SCHEMA
// ------------------------------------------------------------------------
export interface IProjectParameter extends Document {
  projectId: mongoose.Types.ObjectId;
  stages: {
    stage_1: { status: AIStageStatus; fields: any[] };
    stage_2: { status: AIStageStatus; fields: any[] };
    stage_3: { status: AIStageStatus; fields: any[] };
    stage_4: { status: AIStageStatus; cell_writes: any[] };
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProjectParameterSchema = new Schema<IProjectParameter>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    
    stages: {
      stage_1: { type: AIStageSchema, default: () => ({}) },
      stage_2: { type: AIStageSchema, default: () => ({}) },
      stage_3: { type: AIStageSchema, default: () => ({}) },
      stage_4: { type: AIStage4Schema, default: () => ({}) }
    }
  },
  { timestamps: true }
);

export const ProjectParameter = mongoose.model<IProjectParameter>('ProjectParameter', ProjectParameterSchema);