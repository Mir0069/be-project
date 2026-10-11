import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type { PendingApprovalService } from './pending-approval.service';
import type { IProposalExtractionTrigger } from './pending-approval.service';

function getStringParam(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return '';
}

export class PendingApprovalController {
  constructor(
    private readonly service: PendingApprovalService,
    private readonly proposalExtractionTrigger: IProposalExtractionTrigger,
  ) {}

  /**
   * Get all pending approvals for a project
   */
  getPendingApprovals = async (req: Request, res: Response) => {
    const projectId = getStringParam(req.params['projectId']);
    
    const approvals = await this.service.getPendingApprovals(projectId);
    
    res.status(StatusCodes.OK).json({
      success: true,
      data: approvals,
      count: approvals.length,
    });
  };

  /**
   * Get a specific pending approval by ID
   */
  getPendingApproval = async (req: Request, res: Response) => {
    const id = getStringParam(req.params['id']);
    
    const approval = await this.service.getPendingApproval(id);
    
    res.status(StatusCodes.OK).json({
      success: true,
      data: approval,
    });
  };

  /**
   * Approve a pending change and trigger re-processing
   */
  approveChange = async (req: Request, res: Response) => {
    const id = getStringParam(req.params['id']);
    const { userId } = req.user!;
    
    const approval = await this.service.approveChange(id, userId);
    
    res.status(StatusCodes.OK).json({
      success: true,
      data: approval,
      message: 'Change approved and re-processing triggered',
    });
  };

  /**
   * Reject a pending change
   */
  rejectChange = async (req: Request, res: Response) => {
    const id = getStringParam(req.params['id']);
    const { userId } = req.user!;
    const { rejectionReason } = req.body;
    
    const approval = await this.service.rejectChange(id, userId, rejectionReason);
    
    res.status(StatusCodes.OK).json({
      success: true,
      data: approval,
      message: 'Change rejected',
    });
  };

  /**
   * Get count of pending approvals for a project
   */
  getPendingCount = async (req: Request, res: Response) => {
    const projectId = getStringParam(req.params['projectId']);
    
    const count = await this.service.getPendingCount(projectId);
    
    res.status(StatusCodes.OK).json({
      success: true,
      data: { count },
    });
  };

  /**
   * Manual re-trigger - bypasses approval system for explicit user requests
   * This is used when a user explicitly clicks a "Re-trigger" button
   */
  manualRetrigger = async (req: Request, res: Response) => {
    const projectId = getStringParam(req.params['projectId']);
    const { documentIds } = req.body;
    const { userId } = req.user!;
    
    const docsToTrigger = Array.isArray(documentIds) ? documentIds : [];
    
    console.log(`\n======================================================`);
    console.log(`⚡ [Manual Re-trigger] User ${userId} requested manual re-trigger for Project ${projectId}`);
    console.log(`Explicit Documents: ${docsToTrigger.length > 0 ? docsToTrigger.join(', ') : 'All active project documents'}`);
    console.log(`🚀 [Manual Re-trigger] Triggering Stage 0 AI Extraction...`);
    console.log(`======================================================\n`);

    try {
      await this.proposalExtractionTrigger.triggerStage0Extraction(
        projectId,
        docsToTrigger,
        {
          subject: 'Manual re-trigger',
          fromAddress: `User ${userId}`,
          correlationId: `manual:${projectId}:${Date.now()}`,
          origin: 'MANUAL',
        }
      );
      
      res.status(StatusCodes.OK).json({
        success: true,
        message: 'Manual re-trigger initiated successfully',
      });
    } catch (error) {
      throw new AppError(
        'Failed to initiate manual re-trigger',
        StatusCodes.INTERNAL_SERVER_ERROR,
        true,
        { code: ErrorCode.INTERNAL_SERVER_ERROR, details: error }
      );
    }
  };
}


