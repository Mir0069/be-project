import mongoose from 'mongoose';
import { DocumentModel, IDocument, DocumentTypeTag } from '@db/models/document.model';
import { DocumentRecord, DocumentRepository, isEmailBodyDocument } from '@features/document-ingestion/document-ingestion.types';

export class MongooseDocumentRepository implements DocumentRepository {  
private toDomain(doc: IDocument): DocumentRecord {
    return {
      id: doc._id.toString(),
      projectId: doc.projectId ? doc.projectId.toString() : null,
      rootDocumentId: doc.rootDocumentId,
      previousVersionId: doc.previousVersionId ?? undefined,
      version: doc.version,
      isLatest: doc.isLatest,
      isDeleted: !doc.isActive,
      isFinalInput: doc.isFinalInput,
      isInternal: doc.isInternal ?? false,
      documentType: doc.documentType as any,
      status: doc.status as any,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      extension: doc.extension,
      storageKey: doc.storageKey,
      blobUrl: doc.blobUrl,
      sha256: doc.sha256,
      byteSize: doc.byteSize,
      uploadedBy: doc.uploadedBy,
      uploadedAt: doc.uploadedAt,
      updatedAt: doc.updatedAt,
      
      processedAt: doc.processedAt ?? undefined,
      deletedAt: doc.deletedAt ?? undefined,
      deletedBy: doc.deletedBy ?? undefined,
      errorMessage: doc.errorMessage ?? undefined,
      metadata: doc.metadata instanceof Map ? Object.fromEntries(doc.metadata) : doc.metadata || {},
      parentArchiveId: doc.parentArchiveId ?? undefined,
      // Document deduplication fields
      contentHash: doc.contentHash ?? undefined,
      contentHashCachedAt: doc.contentHashCachedAt ?? undefined,
      cachedAiResultRef: doc.cachedAiResultRef ?? undefined
    };
  }

  public async create(record: DocumentRecord): Promise<DocumentRecord> {
    const documentData = {
      ...record,
      _id: record.id 
    };
    
    const doc = new DocumentModel(documentData);
    await doc.save();
    return this.toDomain(doc);
  }

  public async update(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord> {
    const dbPatch: any = { ...patch };
    const update: any = { $set: dbPatch };
    if (patch.isDeleted !== undefined) {
      dbPatch.isActive = !patch.isDeleted;
      delete dbPatch.isDeleted; 

      if (patch.isDeleted === false) {
        update.$unset = { deletedAt: 1, deletedBy: 1 };
      }
    }
    const doc = await DocumentModel.findByIdAndUpdate(
      id, 
      update,
      { new: true } 
    ).exec();

    if (!doc) throw new Error('Document not found during update');
    return this.toDomain(doc);
  }

  public async findById(id: string): Promise<DocumentRecord | null> {
    const isObjectId = mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    const doc = isObjectId
      ? await DocumentModel.findOne({ $or: [{ _id: id }, { storageKey: id }] }).exec()
      : await DocumentModel.findOne({ storageKey: id }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  /**
   * Finds a document by its content hash for deduplication purposes.
   * Returns the first active document with matching content hash.
   */
  public async findByContentHash(contentHash: string): Promise<DocumentRecord | null> {
    const doc = await DocumentModel.findOne({
      contentHash,
      isActive: true
    }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  public async findLatestByRoot(projectId: string, rootDocumentId: string): Promise<DocumentRecord | null> {
    const doc = await DocumentModel.findOne({
      projectId,
      rootDocumentId,
      isLatest: true,
      isActive: true 
    }).exec();

    return doc ? this.toDomain(doc) : null;
  }

  public async listDeletedBefore(cutoff: Date): Promise<DocumentRecord[]> {
    const docs = await DocumentModel.find({
      isActive: false,
      deletedAt: { $ne: null, $lte: cutoff },
    })
      .sort({ deletedAt: 1 })
      .exec();

    return docs.map((doc) => this.toDomain(doc));
  }

  public async deletePermanently(id: string): Promise<void> {
    await DocumentModel.deleteOne({ _id: id, isActive: false }).exec();
  }

  public async listByProject(projectId: string, includeInactive = false): Promise<DocumentRecord[]> {
    const query: any = {
      projectId,
      isInternal: { $ne: true },
      documentType: { $ne: DocumentTypeTag.QUOTE },
      'metadata.source': { $ne: 'proposal-generator' },
      'metadata.isEmailBody': { $ne: true },
      originalName: { $not: /(^email-.*\.txt$|Glass Flooring Systems Proposal.*\.xlsx$)/i },
    };

    if (!includeInactive) {
      query.isActive = true;
    }

    const docs = await DocumentModel.find(query)
      .sort({ uploadedAt: -1 })
      .exec();

    // Keep AI-only email body text out of the customer-facing Documents tab.
    return docs
      .map(doc => this.toDomain(doc))
      .filter(doc => !isEmailBodyDocument(doc));
  }

  public async listByTeamsChannelIds(
    channelIds: string[],
    includeInactive = false,
  ): Promise<DocumentRecord[]> {
    if (channelIds.length === 0) return [];
    const query: any = {
      'metadata.source': 'teams',
      'metadata.channelId': { $in: channelIds },
      // Never surface chat-message-as-document records — only real shared files.
      'metadata.kind': { $ne: 'channel-message' },
    };
    if (!includeInactive) query.isActive = true;

    const docs = await DocumentModel.find(query).sort({ uploadedAt: -1 }).exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  public async listByTeamsMessageIds(messageIds: string[]): Promise<DocumentRecord[]> {
    if (messageIds.length === 0) return [];
    const docs = await DocumentModel.find({
      isActive: true,
      'metadata.source': 'teams',
      'metadata.messageId': { $in: messageIds },
      'metadata.kind': { $ne: 'channel-message' },
    })
      .sort({ uploadedAt: -1 })
      .exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  public async listByTeamsTranscriptId(transcriptId: string): Promise<DocumentRecord[]> {
    const docs = await DocumentModel.find({
      isActive: true,
      'metadata.source': 'teams',
      'metadata.transcriptId': transcriptId,
    })
      .sort({ uploadedAt: -1 })
      .exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  public async listByProjectAndParentMessageId(
    projectId: string,
    parentMessageId: string,
  ): Promise<DocumentRecord[]> {
    const docs = await DocumentModel.find({
      projectId,
      isActive: true,
      'metadata.source': 'teams',
      'metadata.parentMessageId': parentMessageId,
    })
      .sort({ uploadedAt: -1 })
      .exec();

    return docs.map(doc => this.toDomain(doc));
  }

  public async markPriorVersionsNotLatest(projectId: string, rootDocumentId: string, exceptId: string): Promise<void> {
    // Version History Handling with atomic update to all previous files
    await DocumentModel.updateMany(
      { 
        projectId, 
        rootDocumentId, 
        _id: { $ne: exceptId } 
      },
      { 
        $set: { 
          isLatest: false, 
          updatedAt: new Date() 
        } 
      }
    ).exec();
  }
}
