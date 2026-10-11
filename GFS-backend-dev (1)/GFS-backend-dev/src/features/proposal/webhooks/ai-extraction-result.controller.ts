import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type { PendingApprovalService } from '../pending-approval.service';

/**
 * AI Extraction Result Webhook Controller
 * 
 * Receives extraction results from GFS-AI and updates pending approvals
 * with AI reasoning and extracted data for user review.
 */
function getStringParam(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return '';
}

export class AiExtractionResultController {
  constructor(private readonly pendingApprovalService: PendingApprovalService) {}

  handleExtractionResult = async (req: Request, res: Response) => {
    const correlationId = getStringParam(req.params['correlationId']);
    const payload = req.body;

    console.log(`\n======================================================`);
    console.log(`📥 [AiExtractionResultWebhook] Incoming Extraction Result!`);
    console.log(`======================================================`);
    console.log(`Correlation ID:`, correlationId);
    console.log(`Payload:`, JSON.stringify(payload, null, 2));
    console.log(`======================================================\n`);

    try {
      // Check if there's a pending approval for this correlation
      const existingApproval = await this.pendingApprovalService.getPendingApprovalByCorrelationId(correlationId);
      
      if (!existingApproval) {
        console.log(`[AiExtractionResultWebhook] No pending approval found for correlationId: ${correlationId}`);
        // This might be a new project extraction, not a re-trigger
        return res.status(StatusCodes.OK).json({
          status: 'NO_PENDING_APPROVAL',
          message: 'No pending approval found for this correlation ID'
        });
      }

      if (existingApproval.status !== 'PENDING') {
        console.log(`[AiExtractionResultWebhook] Pending approval already processed: ${existingApproval.status}`);
        return res.status(StatusCodes.OK).json({
          status: 'ALREADY_PROCESSED',
          message: `Pending approval already in status: ${existingApproval.status}`
        });
      }

      // Extract AI reasoning and confidence from the payload
      const aiReasoning = this.extractAiReasoning(payload);
      const aiConfidence = this.extractAiConfidence(payload);
      const extractedData = this.extractExtractedData(payload);

      console.log(`[AiExtractionResultWebhook] AI Reasoning:`, aiReasoning);
      console.log(`[AiExtractionResultWebhook] AI Confidence:`, aiConfidence);

      // Update the pending approval with AI reasoning and extracted data
      await this.pendingApprovalService.enrichPendingApprovalWithAi(correlationId, {
        aiReasoning,
        aiConfidence,
        newExtractedData: extractedData,
      });

      console.log(`[AiExtractionResultWebhook] Pending approval successfully enriched with AI reasoning`);

      return res.status(StatusCodes.OK).json({
        status: 'ACCEPTED',
        message: 'Pending approval updated with AI reasoning'
      });

    } catch (error) {
      console.error(`[AiExtractionResultWebhook] Error processing extraction result:`, error);
      
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'Failed to process AI extraction result',
        StatusCodes.INTERNAL_SERVER_ERROR,
        true,
        { code: ErrorCode.INTERNAL_SERVER_ERROR, details: error }
      );
    }
  };

  private extractAiReasoning(payload: any): string {
    // Try to extract reasoning from various possible locations in the AI response
    if (payload.reasoning) {
      return payload.reasoning;
    }
    
    if (payload.summary) {
      return payload.summary;
    }
    
    if (payload.analysis) {
      return payload.analysis;
    }
    
    if (payload.changes && Array.isArray(payload.changes)) {
      // Build reasoning from change descriptions
      const changeDescriptions = payload.changes
        .map((change: any) => change.description || change.reasoning || '')
        .filter(Boolean);
      
      if (changeDescriptions.length > 0) {
        return `Detected changes: ${changeDescriptions.join('; ')}`;
      }
    }
    
    // If no explicit reasoning, generate a default message
    return 'AI extraction completed. Review the extracted data before approving re-trigger.';
  }

  private extractAiConfidence(payload: any): number {
    // Try to extract confidence score
    if (typeof payload.confidence === 'number') {
      return payload.confidence;
    }
    
    if (typeof payload.confidence === 'string') {
      const parsed = parseFloat(payload.confidence);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    
    // Default confidence if not provided
    return 0.7;
  }

  private extractExtractedData(payload: any): any {
    // Extract the actual extracted data/schema from the AI response
    if (payload.extractedData) {
      return payload.extractedData;
    }
    
    if (payload.schema) {
      return payload.schema;
    }
    
    if (payload.final_result) {
      return payload.final_result;
    }
    
    if (payload.fields_to_show) {
      return payload.fields_to_show;
    }
    
    // Return the payload itself if no specific field is found
    return payload;
  }
}
