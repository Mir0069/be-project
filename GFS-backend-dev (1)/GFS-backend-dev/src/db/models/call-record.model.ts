import mongoose, { Document, Schema } from 'mongoose';

export enum AiExtractionStatus {
  NOT_REQUESTED = 'NOT_REQUESTED',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface ICallRecord extends Document {
  projectId: mongoose.Types.ObjectId;
  callDate: Date;
  customerName: string;
  summaryText?: string;
  transcriptFileUrl?: string;
  transcriptFileName?: string;
  contributedBy?: mongoose.Types.ObjectId;
  aiExtractionStatus: AiExtractionStatus;
  aiExtractedRequirements?: string;
  aiExtractedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CallRecordSchema = new Schema<ICallRecord>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    callDate: { type: Date, required: true },
    customerName: { type: String, required: true, trim: true },
    summaryText: { type: String, trim: true },
    transcriptFileUrl: { type: String, trim: true },
    transcriptFileName: { type: String, trim: true },
    contributedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    aiExtractionStatus: {
      type: String,
      enum: Object.values(AiExtractionStatus),
      default: AiExtractionStatus.NOT_REQUESTED,
    },
    aiExtractedRequirements: { type: String },
    aiExtractedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

CallRecordSchema.index({ projectId: 1, isActive: 1 });
CallRecordSchema.index({ contributedBy: 1 });

export const CallRecord = mongoose.model<ICallRecord>('CallRecord', CallRecordSchema);
