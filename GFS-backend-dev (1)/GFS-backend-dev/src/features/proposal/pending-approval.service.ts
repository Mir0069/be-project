import { AppError } from '@shared/errors/app.error';
import { StatusCodes } from 'http-status-codes';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  ChangeSource,
  ApprovalStatus,
  IPendingChangeApproval,
} from '@db/models/pending-change-approval.model';
import type { IPendingChangeApprovalRepository } from '@repositories/interfaces/i-pending-change-approval.repository';
import type { IProposalRepository } from '@repositories/interfaces/i-proposal.repository';
import type { ProjectAnalysisStatus } from '@db/models/project.model';
import { ChangeDetectionService } from './change-detection.service';

// Interface to avoid circular dependency with ProposalService
export interface IProposalExtractionTrigger {
  triggerStage0Extraction(
    projectId: string,
    documentIds: string[],
    source: {
      subject?: string;
      fromAddress?: string;
      correlationId: string;
      summary?: string | null;
      origin?: string | null;
    },
    options?: { skipIfAllCached?: boolean; documentScope?: 'listed' | 'listed-or-all' }
  ): Promise<void>;
  updateAnalysisStatus?(projectId: string, analysisStatus: ProjectAnalysisStatus): Promise<void>;
  applyExcelReingestion?(
    projectId: string,
    parsedData: any,
    documentId: string,
    userId: string
  ): Promise<any>;
}

export interface CreatePendingApprovalInput {
  projectId: string;
  source: ChangeSource;
  sourceId: string;
  correlationId: string;
  documentIds: string[];
  documentNames: string[];
  newExtractedData: any;
  subject?: string;
  sender?: string;
  messageId?: string;
  aiReasoning?: string; // AI-provided reasoning from extraction
  aiConfidence?: number; // AI confidence score
  detectedChanges?: any[];
}

const DEFAULT_AI_CONFIDENCE = 0.5;

/** Keep AI confidence values compatible with the persisted 0-1 schema. */
export function normalizeAiConfidence(value: unknown): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return DEFAULT_AI_CONFIDENCE;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_AI_CONFIDENCE;
  }

  const normalizedValue = numericValue > 1 ? numericValue / 100 : numericValue;
  return Math.min(1, Math.max(0, normalizedValue));
}

export interface ApprovalDecision {
  approved: boolean;
  userId: string;
  rejectionReason?: string;
}

/**
 * Pending Approval Service
 * 
 * Manages the Human-in-the-Loop approval workflow for detected changes
 * from external sources before triggering the re-processing pipeline.
 */
export class PendingApprovalService {
  private readonly changeDetectionService: ChangeDetectionService;
  
  constructor(
    private readonly pendingApprovalRepo: IPendingChangeApprovalRepository,
    private readonly proposalRepo: IProposalRepository,
    private readonly proposalExtractionTrigger: IProposalExtractionTrigger,
  ) {
    this.changeDetectionService = new ChangeDetectionService();
  }

  async updateProjectAnalysisStatus(projectId: string, analysisStatus: ProjectAnalysisStatus): Promise<void> {
    if (!this.proposalExtractionTrigger.updateAnalysisStatus) return;
    await this.proposalExtractionTrigger.updateAnalysisStatus(projectId, analysisStatus);
  }
  
  /**
   * Create a pending approval request after detecting changes
   */
  async createPendingApproval(input: CreatePendingApprovalInput): Promise<IPendingChangeApproval> {
    // Check if a pending approval already exists for this correlation
    const existing = await this.pendingApprovalRepo.findByCorrelationId(input.correlationId);
    if (existing) {
      throw new AppError(
        'A pending approval already exists for this request',
        StatusCodes.CONFLICT,
        true,
        { code: ErrorCode.CONFLICT }
      );
    }
    
    let fieldChanges: any[] = [];
    let reasoning = '';
    let confidence = DEFAULT_AI_CONFIDENCE;
    
    if (input.detectedChanges && input.detectedChanges.length > 0) {
      fieldChanges = input.detectedChanges;
      reasoning = input.aiReasoning || `Detected ${fieldChanges.length} changes from ${input.source}. Manual review required before applying.`;
      confidence = normalizeAiConfidence(input.aiConfidence ?? 1.0);
    } else if (input.newExtractedData && Object.keys(input.newExtractedData).length > 0) {
      try {
        const existingSchema = await this.proposalRepo.getCurrentSchema(input.projectId);
        const detectionResult = this.changeDetectionService.detectChanges(
          existingSchema,
          input.newExtractedData
        );
        
        fieldChanges = this.changeDetectionService.toFieldChanges(detectionResult.changes);
        
        // Combine AI reasoning with change detection reasoning
        if (input.aiReasoning && input.aiReasoning.trim().length > 0) {
          reasoning = `AI Analysis: ${input.aiReasoning}. ${detectionResult.overallReasoning}`;
          confidence = normalizeAiConfidence(input.aiConfidence ?? detectionResult.confidence);
        } else {
          // Use change detection reasoning which now includes field-level AI reasoning
          reasoning = detectionResult.overallReasoning;
          confidence = normalizeAiConfidence(detectionResult.confidence);
        }
      } catch (error) {
        console.error('Error during change detection, using default reasoning:', error);
        // Fallback to AI reasoning if available, otherwise use default
        reasoning = input.aiReasoning && input.aiReasoning.trim().length > 0
          ? input.aiReasoning
          : 'New documents arrived from external source. Manual review required before processing.';
        confidence = normalizeAiConfidence(input.aiConfidence);
      }
    } else {
      // No extracted data yet - this is a document arrival notification
      if (input.aiReasoning && input.aiReasoning.trim().length > 0) {
        reasoning = input.aiReasoning;
        confidence = normalizeAiConfidence(input.aiConfidence);
      } else {
        reasoning = `New document(s) arrived from ${input.source}. Extraction and change detection will run after approval.`;
        confidence = DEFAULT_AI_CONFIDENCE;
      }
    }
    
    // Create the pending approval record
    const approvalInput = {
      projectId: input.projectId,
      source: input.source,
      sourceId: input.sourceId,
      detectedChanges: fieldChanges,
      reasoning,
      confidence,
      aiExtractedData: input.newExtractedData,
      documentIds: input.documentIds,
      documentNames: input.documentNames,
      correlationId: input.correlationId,
      subject: input.subject,
      sender: input.sender,
      messageId: input.messageId,
    };
    
    return await this.pendingApprovalRepo.create(approvalInput);
  }
  
  /**
   * Get all pending approvals for a project
   */
  async getPendingApprovals(projectId: string): Promise<IPendingChangeApproval[]> {
    return await this.pendingApprovalRepo.findPendingByProjectId(projectId);
  }
  
  /**
   * Get a specific pending approval by ID
   */
  async getPendingApproval(id: string): Promise<IPendingChangeApproval> {
    const approval = await this.pendingApprovalRepo.findById(id);
    if (!approval) {
      throw new AppError(
        'Pending approval not found',
        StatusCodes.NOT_FOUND,
        true,
        { code: ErrorCode.NOT_FOUND }
      );
    }
    return approval;
  }

  /**
   * Get a pending approval by correlation ID
   */
  async getPendingApprovalByCorrelationId(correlationId: string): Promise<IPendingChangeApproval | null> {
    return await this.pendingApprovalRepo.findByCorrelationId(correlationId);
  }

  /**
   * Enrich an existing pending approval with AI extraction results & reasoning
   */
  async enrichPendingApprovalWithAi(
    correlationId: string,
    enrichment: {
      aiReasoning?: string;
      aiConfidence?: number;
      newExtractedData?: any;
    }
  ): Promise<IPendingChangeApproval> {
    const approval = await this.pendingApprovalRepo.findByCorrelationId(correlationId);
    if (!approval) {
      throw new AppError(
        `Pending approval not found for correlationId: ${correlationId}`,
        StatusCodes.NOT_FOUND,
        true,
        { code: ErrorCode.NOT_FOUND }
      );
    }

    let fieldChanges = approval.detectedChanges || [];
    let reasoning = enrichment.aiReasoning || approval.reasoning;
    let confidence = normalizeAiConfidence(enrichment.aiConfidence ?? approval.confidence);

    if (enrichment.newExtractedData && Object.keys(enrichment.newExtractedData).length > 0) {
      try {
        const existingSchema = await this.proposalRepo.getCurrentSchema(approval.projectId);
        const detectionResult = this.changeDetectionService.detectChanges(
          existingSchema,
          enrichment.newExtractedData
        );
        fieldChanges = this.changeDetectionService.toFieldChanges(detectionResult.changes);
        
        // Combine AI reasoning with change detection reasoning
        if (enrichment.aiReasoning && enrichment.aiReasoning.trim().length > 0) {
          reasoning = `AI Analysis: ${enrichment.aiReasoning}. ${detectionResult.overallReasoning}`;
          confidence = normalizeAiConfidence(enrichment.aiConfidence ?? detectionResult.confidence);
        } else {
          // Use change detection reasoning which now includes field-level AI reasoning
          reasoning = detectionResult.overallReasoning;
          confidence = normalizeAiConfidence(detectionResult.confidence);
        }
      } catch (err) {
        console.error('[PendingApprovalService] Error computing field changes during AI enrichment:', err);
      }
    }

    const docId = (approval as any)._id ? String((approval as any)._id) : (approval as any).id;
    const updated = await this.pendingApprovalRepo.updateAiEnrichment(docId, {
      reasoning,
      confidence,
      detectedChanges: fieldChanges,
    });

    console.log(`🤖 [PendingApprovalService] Enriched pending approval ${docId} with AI reasoning (Confidence: ${confidence})`);
    return updated || approval;
  }
  
  /**
   * Approve a pending change and trigger the re-processing pipeline
   */
  async approveChange(
    approvalId: string,
    userId: string
  ): Promise<IPendingChangeApproval> {
    const approval = await this.getPendingApproval(approvalId);
    
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new AppError(
        `Cannot approve change with status ${approval.status}`,
        StatusCodes.BAD_REQUEST,
        true,
        { code: ErrorCode.VALIDATION_ERROR }
      );
    }
    
    console.log(`\n======================================================`);
    console.log(`✅ [PendingApproval] Change approved by user ${userId} for Project ${approval.projectId}`);
    console.log(`Approval ID: ${approvalId} | Source: ${approval.source}`);
    console.log(`Documents: ${(approval.documentNames || []).join(', ')}`);
    console.log(`🚀 [PendingApproval] Re-triggering Stage 0 AI Extraction Pipeline...`);
    console.log(`======================================================\n`);

    // Update status to PROCESSING
    await this.pendingApprovalRepo.updateStatus(approvalId, ApprovalStatus.PROCESSING);
    await this.pendingApprovalRepo.updateProcessingTimestamps(approvalId, {
      processingStartedAt: new Date(),
    });
    
    try {
      // Check if this is an Excel re-ingestion approval
      if (approval.aiExtractedData?.excelReingestion && approval.aiExtractedData?.parsedData) {
        console.log(`🚀 [PendingApproval] Applying Excel re-ingestion changes for Project ${approval.projectId}...`);
        if (this.proposalExtractionTrigger.applyExcelReingestion) {
          await this.proposalExtractionTrigger.applyExcelReingestion(
            approval.projectId,
            approval.aiExtractedData.parsedData,
            approval.documentIds?.[0] || '',
            userId
          );
        } else {
          throw new Error('applyExcelReingestion handler not available on proposal extraction trigger');
        }
      } else {
        // Trigger the existing re-trigger mechanism
        // This calls the existing triggerStage0Extraction which will run the full pipeline
        await this.proposalExtractionTrigger.triggerStage0Extraction(
          approval.projectId,
          approval.documentIds,
          {
            subject: approval.subject || 'Re-trigger after approval',
            fromAddress: approval.sender || 'system',
            correlationId: approval.correlationId,
            // The AI's own words for what changed — a Teams/meeting summary, the
            // mail reasoning, the Zoho change. Stored on the approval since it was
            // raised; this is what finally carries it to the extraction.
            summary: approval.reasoning ?? null,
            origin: approval.source,
          },
          // Only this approval's own files: a note or chat approval sends none,
          // so documents from other, unapproved sources are never swept in.
          { documentScope: 'listed' }
        );
      }
      
      // Update status to COMPLETED
      const updated = await this.pendingApprovalRepo.updateStatus(
        approvalId,
        ApprovalStatus.COMPLETED,
        { approvedBy: userId }
      );
      await this.pendingApprovalRepo.updateProcessingTimestamps(approvalId, {
        processingCompletedAt: new Date(),
      });
      
      return updated!;
    } catch (error) {
      // Update status to FAILED on error
      await this.pendingApprovalRepo.updateStatus(
        approvalId,
        ApprovalStatus.FAILED,
        { processingError: String(error) }
      );
      await this.pendingApprovalRepo.updateProcessingTimestamps(approvalId, {
        processingCompletedAt: new Date(),
      });
      
      throw error;
    }
  }
  
  /**
   * Reject a pending change
   */
  async rejectChange(
    approvalId: string,
    userId: string,
    rejectionReason?: string
  ): Promise<IPendingChangeApproval> {
    const approval = await this.getPendingApproval(approvalId);
    
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new AppError(
        `Cannot reject change with status ${approval.status}`,
        StatusCodes.BAD_REQUEST,
        true,
        { code: ErrorCode.VALIDATION_ERROR }
      );
    }
    
    console.log(`\n======================================================`);
    console.log(`❌ [PendingApproval] Change rejected by user ${userId} for Project ${approval.projectId}`);
    console.log(`Approval ID: ${approvalId} | Reason: ${rejectionReason || 'No reason provided'}`);
    console.log(`No re-trigger executed. Project state remains untouched.`);
    console.log(`======================================================\n`);

    const updated = await this.pendingApprovalRepo.updateStatus(
      approvalId,
      ApprovalStatus.REJECTED,
      { rejectedBy: userId, rejectionReason }
    );
    if (!updated) {
      throw new AppError('Pending approval not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }
    return updated;
  }
  
  /**
   * Get count of pending approvals for a project
   */
  async getPendingCount(projectId: string): Promise<number> {
    return await this.pendingApprovalRepo.countPendingByProjectId(projectId);
  }
  
  /**
   * Check if a source has already been processed (to prevent duplicates)
   */
  async isSourceProcessed(sourceId: string, source: ChangeSource): Promise<boolean> {
    const existing = await this.pendingApprovalRepo.findBySource(sourceId, source);
    return existing !== null;
  }
}
