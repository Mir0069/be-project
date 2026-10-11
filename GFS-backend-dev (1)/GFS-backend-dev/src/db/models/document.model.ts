import mongoose, { Document, Schema } from 'mongoose';

export enum DocumentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
  STAGING = 'STAGING' 
}

export enum DocumentTypeTag {
  DRAWING = 'drawing',
  SPEC = 'spec',
  TRANSCRIPT = 'transcript',
  QUOTE = 'quote',
  PHOTO = 'photo',
  OTHER = 'other',
  GENERAL = 'GENERAL',
}

export interface IDocument extends Document {
  id: string;
  projectId?: mongoose.Types.ObjectId | null; // optional for staging documents
  rootDocumentId: string;
  previousVersionId?: string | null;
  version: number;
  isLatest: boolean;
  isActive: boolean;
  isFinalInput: boolean;
  isInternal?: boolean; // internal system files (e.g. email-*.txt) hidden from UI and Dropbox
  documentType: DocumentTypeTag;
  status: DocumentStatus;
  
  originalName: string;
  mimeType: string;
  extension: string;
  storageKey: string;
  blobUrl: string;
  sha256: string;
  byteSize: number;

  // Lazily-generated PDF companion for proposal (QUOTE) documents — populated
  // on first PDF download so later downloads skip re-converting via Graph.
  pdfStorageKey?: string | null;
  pdfBlobUrl?: string | null;
  pdfByteSize?: number | null;

  uploadedBy: string; 
  uploadedAt: Date;
  processedAt?: Date | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  errorMessage?: string | null;
  
  metadata: Map<string, any>;
  parentArchiveId?: string | null; 
  
  // Document deduplication fields
  contentHash?: string | null; // SHA-256 of file content for deduplication
  contentHashCachedAt?: Date | null; // When hash was computed
  cachedAiResultRef?: string | null; // Reference to document_processing_cache if AI result is cached
  
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>({
  projectId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Project', 
    //The conditional requirement for staging bypass
    required: function(this: any) {
      return this.status !== DocumentStatus.STAGING;
    }
  },
  rootDocumentId: { type: String, required: true },
  previousVersionId: { type: String, default: null },
  version: { type: Number, required: true, default: 1 },
  
  isLatest: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  isFinalInput: { type: Boolean, default: false },
  isInternal: { type: Boolean, default: false, index: true },
  
  documentType: { type: String, enum: Object.values(DocumentTypeTag), required: true },
  status: { type: String, enum: Object.values(DocumentStatus), default: DocumentStatus.PENDING },

  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  extension: { type: String, required: true },
  storageKey: { type: String, required: true },
  blobUrl: { type: String, required: true },
  sha256: { type: String, required: true },
  byteSize: { type: Number, required: true },

  pdfStorageKey: { type: String, default: null },
  pdfBlobUrl: { type: String, default: null },
  pdfByteSize: { type: Number, default: null },

  uploadedBy: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },
  errorMessage: { type: String, default: null },

  metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  parentArchiveId: { type: String, default: null },

  // Document deduplication fields
  contentHash: { type: String },
  contentHashCachedAt: { type: Date, default: null },
  cachedAiResultRef: { type: String, default: null }

}, { timestamps: true });

DocumentSchema.index({ projectId: 1, isActive: 1 });
DocumentSchema.index({ projectId: 1, isInternal: 1, isActive: 1, isLatest: 1 });
DocumentSchema.index({ projectId: 1, isActive: 1, isLatest: 1, documentType: 1 });
DocumentSchema.index({ 'metadata.dropboxPath': 1 }, { sparse: true });
DocumentSchema.index({ rootDocumentId: 1 });
DocumentSchema.index({ status: 1 });
// Sparse lookup index for deduplication. The same content may legitimately be
// uploaded into different projects or document versions, so this must not be
// globally unique.
DocumentSchema.index({ contentHash: 1 }, { sparse: true, background: true });

export const DocumentModel = mongoose.model<IDocument>('Document', DocumentSchema);
