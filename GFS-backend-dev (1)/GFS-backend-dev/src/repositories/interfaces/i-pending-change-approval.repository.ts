import {
  IPendingChangeApproval,
  ChangeSource,
  ApprovalStatus,
} from '@db/models/pending-change-approval.model';

export interface CreatePendingChangeApprovalInput {
  projectId: string;
  source: ChangeSource;
  sourceId: string;
  detectedChanges: Array<{
    fieldPath: string;
    previousValue: any;
    newValue: any;
    fieldName: string;
    fieldType: string;
  }>;
  reasoning: string;
  confidence?: number;
  documentIds: string[];
  documentNames: string[];
  correlationId: string;
  subject?: string;
  sender?: string;
  messageId?: string;
  aiExtractedData?: any;
}

export interface IPendingChangeApprovalRepository {
  create(input: CreatePendingChangeApprovalInput): Promise<IPendingChangeApproval>;
  
  findById(id: string): Promise<IPendingChangeApproval | null>;
  
  findByCorrelationId(correlationId: string): Promise<IPendingChangeApproval | null>;
  
  findByProjectId(projectId: string): Promise<IPendingChangeApproval[]>;
  
  findPendingByProjectId(projectId: string): Promise<IPendingChangeApproval[]>;
  
  findBySource(sourceId: string, source: ChangeSource): Promise<IPendingChangeApproval | null>;
  
  updateStatus(
    id: string,
    status: ApprovalStatus,
    metadata?: {
      approvedBy?: string;
      rejectedBy?: string;
      rejectionReason?: string;
      processingError?: string;
    }
  ): Promise<IPendingChangeApproval | null>;
  
  updateProcessingTimestamps(
    id: string,
    timestamps: {
      processingStartedAt?: Date;
      processingCompletedAt?: Date;
    }
  ): Promise<IPendingChangeApproval | null>;
  
  updateAiEnrichment(
    id: string,
    enrichment: {
      reasoning?: string;
      confidence?: number;
      detectedChanges?: Array<{
        fieldPath: string;
        previousValue: any;
        newValue: any;
        fieldName: string;
        fieldType: string;
      }>;
      documentIds?: string[];
      documentNames?: string[];
    }
  ): Promise<IPendingChangeApproval | null>;

  delete(id: string): Promise<boolean>;
  
  countPendingByProjectId(projectId: string): Promise<number>;
}
