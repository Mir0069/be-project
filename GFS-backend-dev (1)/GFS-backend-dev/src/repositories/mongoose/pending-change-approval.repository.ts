import {
  IPendingChangeApproval,
  PendingChangeApprovalModel,
  ChangeSource,
  ApprovalStatus,
} from '@db/models/pending-change-approval.model';
import type {
  IPendingChangeApprovalRepository,
  CreatePendingChangeApprovalInput,
} from '@repositories/interfaces/i-pending-change-approval.repository';

export class MongoosePendingChangeApprovalRepository implements IPendingChangeApprovalRepository {
  async create(input: CreatePendingChangeApprovalInput): Promise<IPendingChangeApproval> {
    const approval = new PendingChangeApprovalModel({
      ...input,
      status: ApprovalStatus.PENDING,
    });
    return await approval.save();
  }

  async findById(id: string): Promise<IPendingChangeApproval | null> {
    return await PendingChangeApprovalModel.findById(id).lean();
  }

  async findByCorrelationId(correlationId: string): Promise<IPendingChangeApproval | null> {
    return await PendingChangeApprovalModel.findOne({ correlationId }).lean();
  }

  async findByProjectId(projectId: string): Promise<IPendingChangeApproval[]> {
    return await PendingChangeApprovalModel
      .find({ projectId })
      .sort({ createdAt: -1 })
      .lean();
  }

  async findPendingByProjectId(projectId: string): Promise<IPendingChangeApproval[]> {
    return await PendingChangeApprovalModel
      .find({ 
        projectId, 
        status: ApprovalStatus.PENDING 
      })
      .sort({ createdAt: -1 })
      .lean();
  }

  async findBySource(sourceId: string, source: ChangeSource): Promise<IPendingChangeApproval | null> {
    return await PendingChangeApprovalModel.findOne({ sourceId, source }).lean();
  }

  async updateStatus(
    id: string,
    status: ApprovalStatus,
    metadata?: {
      approvedBy?: string;
      rejectedBy?: string;
      rejectionReason?: string;
      processingError?: string;
    }
  ): Promise<IPendingChangeApproval | null> {
    const updateData: any = { status, updatedAt: new Date() };
    
    if (status === ApprovalStatus.APPROVED) {
      updateData.approvedAt = new Date();
      if (metadata?.approvedBy) updateData.approvedBy = metadata.approvedBy;
    }
    
    if (status === ApprovalStatus.REJECTED) {
      updateData.rejectedAt = new Date();
      if (metadata?.rejectedBy) updateData.rejectedBy = metadata.rejectedBy;
      if (metadata?.rejectionReason) updateData.rejectionReason = metadata.rejectionReason;
    }
    
    if (status === ApprovalStatus.FAILED && metadata?.processingError) {
      updateData.processingError = metadata.processingError;
    }

    return await PendingChangeApprovalModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).lean();
  }

  async updateProcessingTimestamps(
    id: string,
    timestamps: {
      processingStartedAt?: Date;
      processingCompletedAt?: Date;
    }
  ): Promise<IPendingChangeApproval | null> {
    return await PendingChangeApprovalModel.findByIdAndUpdate(
      id,
      { $set: { ...timestamps, updatedAt: new Date() } },
      { new: true }
    ).lean();
  }

  async updateAiEnrichment(
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
  ): Promise<IPendingChangeApproval | null> {
    const updateData: any = { updatedAt: new Date() };
    if (enrichment.reasoning !== undefined) updateData.reasoning = enrichment.reasoning;
    if (enrichment.confidence !== undefined) updateData.confidence = enrichment.confidence;
    if (enrichment.detectedChanges !== undefined) updateData.detectedChanges = enrichment.detectedChanges;
    if (enrichment.documentIds !== undefined && enrichment.documentIds.length > 0) updateData.documentIds = enrichment.documentIds;
    if (enrichment.documentNames !== undefined && enrichment.documentNames.length > 0) updateData.documentNames = enrichment.documentNames;

    return await PendingChangeApprovalModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).lean();
  }

  async delete(id: string): Promise<boolean> {
    const result = await PendingChangeApprovalModel.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async countPendingByProjectId(projectId: string): Promise<number> {
    return await PendingChangeApprovalModel.countDocuments({
      projectId,
      status: ApprovalStatus.PENDING,
    });
  }
}
