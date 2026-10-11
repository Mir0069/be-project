import mongoose, { Schema, Document } from 'mongoose';

/**
 * Pending Change Approval Model
 * 
 * Stores detected changes from external sources (Email, Teams, Zoho, Dropbox)
 * that require human approval before triggering the re-processing pipeline.
 */

export enum ChangeSource {
  EMAIL = 'EMAIL',
  TEAMS = 'TEAMS',
  ZOHO = 'ZOHO',
  DROPBOX = 'DROPBOX',
  MANUAL = 'MANUAL',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface FieldChange {
  fieldPath: string;
  previousValue: any;
  newValue: any;
  fieldName: string;
  fieldType: string;
  aiReasoning?: string; // AI-provided reasoning for this specific field change
}

export interface IPendingChangeApproval extends Document {
  projectId: string;
  source: ChangeSource;
  sourceId: string; // emailId, teamsMessageId, zohoLeadId, dropboxFileId, etc.
  status: ApprovalStatus;
  
  // Change detection
  detectedChanges: FieldChange[];
  reasoning: string;
  confidence: number; // 0-1 scale
  aiExtractedData?: any;
  
  // Document information
  documentIds: string[];
  documentNames: string[];
  
  // Metadata
  correlationId: string;
  subject?: string; // For email
  sender?: string; // For email
  messageId?: string; // Source message identifier
  
  // Approval tracking
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  
  // Processing tracking
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  processingError?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const PendingChangeApprovalSchema = new Schema<IPendingChangeApproval>(
  {
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(ChangeSource),
      required: true,
    },
    sourceId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ApprovalStatus),
      default: ApprovalStatus.PENDING,
      required: true,
      index: true,
    },
    
    // Change detection
    detectedChanges: [{
      fieldPath: { type: String, required: true },
      previousValue: { type: Schema.Types.Mixed },
      newValue: { type: Schema.Types.Mixed },
      fieldName: { type: String, required: true },
      fieldType: { type: String, required: true },
      aiReasoning: { type: String }, // AI-provided reasoning for this specific field change
    }],
    reasoning: {
      type: String,
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
    aiExtractedData: {
      type: Schema.Types.Mixed, // Store the full AI extraction result for reference
    },
    
    // Document information
    documentIds: [{ type: String }],
    documentNames: [{ type: String }],
    
    // Metadata
    correlationId: {
      type: String,
      required: true,
      unique: true,
    },
    subject: String,
    sender: String,
    messageId: String,
    
    // Approval tracking
    approvedBy: String,
    approvedAt: Date,
    rejectedBy: String,
    rejectedAt: Date,
    rejectionReason: String,
    
    // Processing tracking
    processingStartedAt: Date,
    processingCompletedAt: Date,
    processingError: String,
    
    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
PendingChangeApprovalSchema.index({ projectId: 1, status: 1, createdAt: -1 });
PendingChangeApprovalSchema.index({ source: 1, sourceId: 1 });

export const PendingChangeApprovalModel = (mongoose.models['PendingChangeApproval'] as mongoose.Model<IPendingChangeApproval>) || 
  mongoose.model<IPendingChangeApproval>('PendingChangeApproval', PendingChangeApprovalSchema);
