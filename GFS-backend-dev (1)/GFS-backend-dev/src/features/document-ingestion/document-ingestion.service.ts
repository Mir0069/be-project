import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { Readable, PassThrough } from 'stream';
import mongoose from 'mongoose';
import { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters } from '@azure/storage-blob';
import { IQueueAdapter } from '@shared/queues/queue.types';
import { createQueueAdapter } from '@shared/queues/queue.factory';
import { AppError } from '@shared/errors/app.error';
import {
  AuthContext, UploadedFile, IngestDocumentInput, StoredBlob, DocumentRecord, IEmailPackageBundle,
  DocumentRepository, BlobStorage, PermissionService, AuditLogger, ZipExtractor, LinkedChannelResolver, DocumentTypeTag } from './document-ingestion.types';
import { DocumentModel } from '@db/models/document.model';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/vtt', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed',
]);

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.txt', '.vtt', '.zip']);

const DELETED_DOCUMENT_RETENTION_MS = 24 * 60 * 60 * 1000;

const EXTENSION_TO_MIME_HINTS: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.txt': ['text/plain'],
  '.vtt': ['text/vtt', 'text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

// --- Helpers ---
const hashSha256 = (buffer: Buffer): string => crypto.createHash('sha256').update(buffer).digest('hex');

const hashFileSha256 = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

/**
 * Calculates SHA-256 content hash for document deduplication.
 * This is separate from the existing sha256 field to allow for different hashing strategies
 * and to maintain backwards compatibility.
 */
const calculateContentHash = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

const getSafeExtension = (fileName: string): string => {
  const extension = path.extname(fileName).toLowerCase();
  if (!extension || extension.includes('/') || extension.includes('\\')) throw new DocumentIngestionError('File must have a supported extension', 415);
  return extension;
};
const sanitizeFileName = (fileName: string): string => path.basename(fileName).replace(/[^a-zA-Z0-9._ -]/g, '_');
const sanitizePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_');
const sanitizeMetadataValue = (value: string): string => value.replace(/[^\x20-\x7E]/g, '').slice(0, 256);
const sanitizeZipEntryName = (entryName: string): string => {
  const normalized = entryName.replace(/\\/g, '/');
  const baseName = path.basename(normalized);
  if (!baseName || baseName === '.' || baseName === '..') throw new DocumentIngestionError(`Invalid ZIP entry: ${entryName}`, 422);
  return baseName;
};
const mimeTypeFromExtension = (extension: string): string => {
  switch (extension) {
    case '.pdf': return 'application/pdf';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt': return 'text/plain';
    case '.vtt': return 'text/vtt';
    case '.zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
};
export class DocumentIngestionError extends AppError {
  public constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}

export interface DocumentIngestionPipelineOptions {
  repository: DocumentRepository;
  storage: BlobStorage;
  queue?: IQueueAdapter<any>;
  permissions: PermissionService;
  audit: AuditLogger;
  zipExtractor?: ZipExtractor;
  now?: () => Date;
  idFactory?: () => string;
  // Optional: surfaces documents from Teams channels a project shares. Keeps
  // this feature decoupled from Teams — it's just a function.
  linkedChannelResolver?: LinkedChannelResolver;
  // NEW: fired after upload() successfully creates document record(s) for a
  // KNOWN project (Teams, manual upload, or anything else routed through
  // upload()/ingestOne() rather than the email classification path).
  // Kept as a plain optional callback — same decoupling pattern as
  // linkedChannelResolver — so this module never imports the proposal
  // feature directly. The real implementation (calling
  // proposalService.triggerStage0Extraction) is wired in wherever this
  // pipeline gets constructed, not here.
  onDocumentIngested?: (projectId: string, documentIds: string[]) => Promise<void>;
  // maxAttempts?: number; // Azure Handles
}

export class DocumentIngestionPipeline {
  private readonly repository: DocumentRepository;
  private readonly storage: BlobStorage;
  private readonly permissions: PermissionService;
  private readonly audit: AuditLogger;
  private readonly queue: IQueueAdapter<any>;
  
  private readonly zipExtractor: ZipExtractor;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly linkedChannelResolver?: LinkedChannelResolver;
  // NEW
  private readonly onDocumentIngested?: (projectId: string, documentIds: string[]) => Promise<void>;

  public constructor(options: DocumentIngestionPipelineOptions) {
    this.repository = options.repository;
    this.storage = options.storage;
    this.queue = options.queue ?? createQueueAdapter(process.env['AZURE_SERVICE_BUS_AI_QUEUE_NAME'] || 'ai-ocr-ingestion');
    this.permissions = options.permissions;
    this.audit = options.audit;
    this.zipExtractor = options.zipExtractor ?? new AdmZipExtractor();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => new mongoose.Types.ObjectId().toString());
    this.linkedChannelResolver = options.linkedChannelResolver;
    this.onDocumentIngested = options.onDocumentIngested; // NEW
  }

  // ==========================================
  // EXTERNAL BUNDLE HANDLER (Outlook -> AI Queue)
  // ==========================================
  // public async ingestExternalPackage(ctx: AuthContext, bundle: IEmailPackageBundle): Promise<DocumentRecord[]> {
  //   const uploadedRecords: DocumentRecord[] = [];
  //   const uploadedAt = this.now();

  //   // 1. Process the plain text email body
  //   const bodyBuffer = Buffer.from(bundle.bodyText, 'utf-8');
  //   const bodyDoc = await this.stageSingleFile(ctx, {
  //     originalName: `email-${bundle.messageId}.txt`,
  //     mimeType: 'text/plain',
  //     buffer: bodyBuffer
  //   }, bundle, uploadedAt);
  //   uploadedRecords.push(bodyDoc);

  //   // 2. Process all attachments
  //   for (const att of bundle.attachments) {
  //     const attDoc = await this.stageSingleFile(ctx, att, bundle, uploadedAt);
  //     uploadedRecords.push(attDoc);
  //   }

  //   const aiDocumentPayloads = await Promise.all(uploadedRecords.map(async (doc) => ({
  //     documentId: doc.id,
  //     blobUrl: await this.storage.createSignedDownloadUrl(doc.storageKey, 60), // Swap private URL for temporary SAS
  //     originalName: doc.originalName
  //   })));

  //   // 3. For Outlook emails, One Unified payload to AI queue
  //   await this.queue.publish({
  //     jobType: 'EMAIL_PROPOSAL',
  //     correlationId: `outlookEmail:${bundle.messageId}`,
  //     payload: {
  //       subject: bundle.subject,
  //       sender: bundle.sender,
  //       documents: aiDocumentPayloads
  //     }
  //   });

  //   return uploadedRecords;
  // }

// ==========================================
  // EXTERNAL BUNDLE HANDLER (Outlook -> AI Queue)
  // ==========================================
  public async ingestExternalPackage(ctx: AuthContext, bundle: IEmailPackageBundle): Promise<DocumentRecord[]> {
    const uploadedRecords: DocumentRecord[] = [];
    const aiDocumentPayloads = [];
    const uploadedAt = this.now();

    // 1. Process the plain text email body (We still stage this ourselves since it's just tiny text)
    const cleanBodyText = bundle.bodyText && bundle.bodyText.trim() ? bundle.bodyText : '(No content)';
    const bodyBuffer = Buffer.from(cleanBodyText, 'utf-8');
    const bodyDoc = await this.stageSingleFile(ctx, {
      originalName: `email-${bundle.messageId}.txt`,
      mimeType: 'text/plain',
      buffer: bodyBuffer
    }, bundle, uploadedAt);
    uploadedRecords.push(bodyDoc);

    // Generate our own 1-hour SAS URL for the text body we just staged
    aiDocumentPayloads.push({
      documentId: bodyDoc.id,
      blobUrl: await this.storage.createSignedDownloadUrl(bodyDoc.storageKey, 60),
      originalName: bodyDoc.originalName
    });

    // 2. Process all PRE-STAGED attachments from Pradeep
    for (const att of bundle.attachments) {
      let existing = null;
      try {
        existing = await mongoose.model('Document').findOne({ storageKey: att.storageKey });
      } catch (err) {
        // Schema not registered in unit tests, skip check
      }

      if (existing) {
        const docObject = existing.toObject ? existing.toObject() : existing;
        uploadedRecords.push({
          id: docObject._id ? docObject._id.toString() : docObject.id,
          ...docObject
        });

        aiDocumentPayloads.push({
          documentId: docObject._id ? docObject._id.toString() : docObject.id,
          blobUrl: att.downloadUrl,
          originalName: docObject.originalName
        });
        continue;
      }

      const documentId = this.idFactory();
      const extension = getSafeExtension(att.originalName);
      
      // Strip the "?sv=..." SAS token to store the clean, private URL in the database
      const privateBlobUrl = att.downloadUrl.split('?')[0] || att.downloadUrl;

      const record: DocumentRecord = {
        id: documentId,
        projectId: null, // Bypasses project requirement due to STAGING status
        rootDocumentId: documentId,
        version: 1,
        isLatest: true,
        isDeleted: false,
        isFinalInput: false,
        documentType: 'other', 
        status: 'STAGING',
        originalName: att.originalName,
        mimeType: att.mimeType,
        extension,
        storageKey: att.storageKey,
        blobUrl: privateBlobUrl, 
        
        // DEMO FIX: Generate a dummy hash using the storage key to satisfy Mongoose
        sha256: crypto.createHash('sha256').update(att.storageKey).digest('hex'),
        
        byteSize: att.size,
        uploadedBy: ctx.userId,
        uploadedAt,
        updatedAt: uploadedAt,
        metadata: {
          source: 'outlook',
          messageId: bundle.messageId,
          conversationId: bundle.conversationId ?? null
        },
      };

      const created = await this.repository.create(record);
      uploadedRecords.push(created);

      await this.audit.log({
        action: 'document.staged.pre_uploaded',
        actorId: ctx.userId,
        projectId: null,
        documentId,
        details: { messageId: bundle.messageId, storageKey: att.storageKey }
      });

      // Pass Outlook's pre-minted SAS URL directly to AI's JSON array
      aiDocumentPayloads.push({
        documentId: created.id,
        blobUrl: att.downloadUrl, 
        originalName: created.originalName
      });
    }

    // 3. Fire ONE unified payload to AI queue
    await this.queue.publish({
      jobType: 'EMAIL_PROPOSAL',
      correlationId: bundle.correlationId, 
      payload: {
        subject: bundle.subject,
        sender: bundle.sender,
        documents: aiDocumentPayloads // Contains the body text + all attachments
      }
    });

    return uploadedRecords;
  }

  /**
   * Directly ingests a pre-staged file (e.g. resolved from cloud links) into MongoDB
   * with a STAGING status and records audit log.
   */
  public async ingestStagedFile(
    ctx: AuthContext,
    input: {
      projectId: string | null;
      originalName: string;
      mimeType: string;
      storageKey: string;
      blobUrl: string;
      byteSize: number;
      uploadedBy: string;
      documentType: DocumentTypeTag;
      metadata?: Record<string, string | number | boolean | null>;
    }
  ): Promise<DocumentRecord> {
    const documentId = this.idFactory();
    const extension = getSafeExtension(input.originalName);
    const uploadedAt = this.now();

    // Strip any SAS token from URL for storing clean private URL
    const privateBlobUrl = input.blobUrl.split('?')[0] || input.blobUrl;

    const record: DocumentRecord = {
      id: documentId,
      projectId: input.projectId ? new mongoose.Types.ObjectId(input.projectId) as any : null,
      rootDocumentId: documentId,
      version: 1,
      isLatest: true,
      isDeleted: false,
      isFinalInput: false,
      documentType: input.documentType,
      status: 'STAGING' as any, // Always STAGING for pre-staged cloud links
      originalName: input.originalName,
      mimeType: input.mimeType,
      extension,
      storageKey: input.storageKey,
      blobUrl: privateBlobUrl,
      sha256: crypto.createHash('sha256').update(input.storageKey).digest('hex'),
      byteSize: input.byteSize,
      uploadedBy: input.uploadedBy,
      uploadedAt,
      updatedAt: uploadedAt,
      metadata: input.metadata ? new Map(Object.entries(input.metadata)) : new Map(),
    } as any;

    const created = await this.repository.create(record);

    await this.audit.log({
      action: 'document.staged.pre_uploaded',
      actorId: ctx.userId,
      projectId: input.projectId,
      documentId,
      details: { storageKey: input.storageKey, source: 'cloud-link' }
    });

    return created;
  }

  private async stageSingleFile(
    ctx: AuthContext, 
    file: UploadedFile,
    bundle: IEmailPackageBundle,
    uploadedAt: Date
  ): Promise<DocumentRecord> {
    this.validateFile(file); 
    const extension = getSafeExtension(file.originalName);
    const sha256 = file.path ? await hashFileSha256(file.path) : hashSha256(file.buffer!);
    const documentId = this.idFactory();

    // Store in Azure 'staging' path
    const stored = file.path
      ? await this.storage.putStream({
          storageKey: `projects/staging/documents/${sanitizeFileName(file.originalName)}`,
          mimeType: file.mimeType,
          stream: fs.createReadStream(file.path),
        })
      : await this.storage.put({
          projectId: 'staging', 
          sha256,
          originalName: file.originalName,
          mimeType: file.mimeType,
          buffer: file.buffer!,
        });

    const record: DocumentRecord = {
      id: documentId,
      projectId: null, // Bypasses project requirement due to STAGING status
      rootDocumentId: documentId,
      version: 1,
      isLatest: true,
      isDeleted: false,
      isFinalInput: false,
      isInternal: true,
      documentType: 'other', 
      status: 'STAGING',
      originalName: file.originalName,
      mimeType: file.mimeType,
      extension,
      storageKey: stored.storageKey,
      blobUrl: stored.blobUrl,
      sha256: stored.sha256,
      byteSize: stored.byteSize,
      uploadedBy: ctx.userId,
      uploadedAt,
      updatedAt: uploadedAt,
      metadata: {
        source: 'outlook',
        isEmailBody: true,
        messageId: bundle.messageId
      },
    };

    const created = await this.repository.create(record);

    await this.audit.log({
      action: 'document.staged',
      actorId: ctx.userId,
      projectId: null, // Handles the nullable string requirement
      documentId,
      details: { messageId: bundle.messageId, storageKey: stored.storageKey }
    });

    return created;
  }

  // ==========================================
  // STANDARD MANUAL UPLOADS (Frontend -> Workspace)
  // ==========================================
  public async upload(authCtx: AuthContext, input: IngestDocumentInput): Promise<DocumentRecord[]> {
    await this.permissions.assertCanUpload(authCtx, input.projectId);
    this.validateFile(input.file);

    if (this.isZip(input.file)) {
      const extractedFiles = await this.zipExtractor.extract(input.file);
      if (extractedFiles.length === 0) {
        throw new DocumentIngestionError('ZIP archive did not contain supported files', 422);
      }

      const archive = await this.ingestOne(authCtx, input, undefined);
      const children: DocumentRecord[] = [];
      for (const childFile of extractedFiles) {
        this.validateFile(childFile);
        children.push(await this.ingestOne(authCtx, { ...input, file: childFile }, archive.id));
      }
      const records = [archive, ...children];

      this.triggerOutwardSync(input.projectId);
      // NEW: trigger Stage 0 extraction for every newly-created document (archive + children)
      this.fireOnDocumentIngested(input.projectId, records.map((r) => r.id));

      return records;
    }

    const records = [await this.ingestOne(authCtx, input, undefined)];

    this.triggerOutwardSync(input.projectId);
    // NEW: trigger Stage 0 extraction for the newly-created document
    this.fireOnDocumentIngested(input.projectId, records.map((r) => r.id));

    return records;
  }

  // NEW: small wrapper so upload()'s two call sites don't duplicate the
  // null-check / fire-and-forget / error-logging boilerplate.
  private fireOnDocumentIngested(projectId: string | null | undefined, documentIds: string[]): void {
    if (!this.onDocumentIngested || !projectId || documentIds.length === 0) return;
    this.onDocumentIngested(projectId, documentIds).catch((err) =>
      console.error(`[DocumentIngestion] onDocumentIngested callback failed for project ${projectId}:`, err)
    );
  }

  private triggerOutwardSync(projectId: string | null | undefined): void {
    if (!projectId) return;
    const projRepo = new MongooseProjectRepository();
    projRepo.findById(projectId).then((proj) => {
      if (proj) {
        (import('../projects/dropbox-sync.service.js' as any) as Promise<any>)
          .then(({ dropboxSyncService }) => {
            if (dropboxSyncService && typeof dropboxSyncService.outwardSync === 'function') {
              dropboxSyncService.outwardSync(proj).catch((err: any) =>
                console.error(`[DocumentIngestion] outwardSync failed for project ${projectId}:`, err?.message ?? err)
              );
            }
          })
          .catch((err: any) =>
            console.error(`[DocumentIngestion] Failed to load dropboxSyncService:`, err?.message ?? err)
          );
      }
    }).catch(() => {});
  }

  public async replace(authCtx: AuthContext, input: IngestDocumentInput & { replaceDocumentId: string }): Promise<DocumentRecord> {
    const current = await this.requireDocument(input.replaceDocumentId);
    await this.permissions.assertCanUpdate(authCtx, current);

    if (current.projectId !== input.projectId) {
      throw new DocumentIngestionError('Replacement project does not match the existing document', 409);
    }

    const [replacement] = await this.upload(authCtx, {
      ...input,
      replaceDocumentId: current.rootDocumentId,
    });

    if (!replacement) {
      throw new DocumentIngestionError('Critical failure: Upload process did not return a replacement document', 500);
    }

    return replacement;
  }

  public async list(projectId: string, includeDeleted = false): Promise<DocumentRecord[]> {
    const own = await this.repository.listByProject(projectId, includeDeleted);

    // Also surface documents shared via a Teams channel this project is linked
    // to (the channel's files live under whichever project first ingested them).
    let shared: DocumentRecord[] = [];
    if (this.linkedChannelResolver) {
      try {
        const channelIds = await this.linkedChannelResolver(projectId);
        if (channelIds.length > 0) {
          const byChannel = await this.repository.listByTeamsChannelIds(channelIds, includeDeleted);
          const ownIds = new Set(own.map((d) => d.id));
          shared = byChannel.filter((d) => d.projectId !== projectId && !ownIds.has(d.id));
        }
      } catch {
        // Sharing is best-effort; never fail the documents list over it.
      }
    }

    return [...own, ...shared].sort(
      (left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime(),
    );
  }

  public async markAsFinalInput(authCtx: AuthContext, documentId: string, isFinalInput: boolean): Promise<DocumentRecord> {
    const document = await this.requireDocument(documentId);
    await this.permissions.assertCanUpdate(authCtx, document);

    const updated = await this.repository.update(documentId, {
      isFinalInput,
      updatedAt: this.now(),
    });

    await this.audit.log({
      action: isFinalInput ? 'document.mark_final_input' : 'document.unmark_final_input',
      actorId: authCtx.userId,
      projectId: document.projectId,
      documentId,
    });

    return updated;
  }

  public async delete(authCtx: AuthContext, documentId: string): Promise<DocumentRecord> {
    const document = await this.requireDocument(documentId);
    await this.permissions.assertCanDelete(authCtx, document);

    if (document.isDeleted) return document;

    // Keep the blob during the recovery window so the UI can offer Undo. A
    // scheduled purge removes expired deleted records and their bytes later.
    const deleted = await this.repository.update(documentId, {
      isDeleted: true,
      isLatest: false,
      deletedAt: this.now(),
      deletedBy: authCtx.userId,
      updatedAt: this.now(),
    });

    await this.audit.log({
      action: 'document.delete',
      actorId: authCtx.userId,
      projectId: document.projectId,
      documentId,
      details: { storageKey: document.storageKey, sha256: document.sha256, version: document.version },
    });

    return deleted;
  }

  public async restore(authCtx: AuthContext, documentId: string): Promise<DocumentRecord> {
    const document = await this.requireDocument(documentId);
    await this.permissions.assertCanDelete(authCtx, document);

    if (!document.isDeleted) return document;

    const deletedAt = document.deletedAt?.getTime();
    if (deletedAt && this.now().getTime() - deletedAt > DELETED_DOCUMENT_RETENTION_MS) {
      throw new DocumentIngestionError('The document recovery window has expired.', 410);
    }

    const restored = await this.repository.update(documentId, {
      isDeleted: false,
      isLatest: true,
      updatedAt: this.now(),
    });

    await this.audit.log({
      action: 'document.restore',
      actorId: authCtx.userId,
      projectId: document.projectId,
      documentId,
      details: { storageKey: document.storageKey, version: document.version },
    });

    return restored;
  }

  public async purgeExpiredDeletedDocuments(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - DELETED_DOCUMENT_RETENTION_MS);
    const expired = await this.repository.listDeletedBefore(cutoff);
    let purged = 0;

    for (const document of expired) {
      const current = await this.repository.findById(document.id);
      if (!current?.isDeleted || !current.deletedAt || current.deletedAt > cutoff) continue;

      try {
        await this.storage.delete(current.storageKey);
      } catch (err) {
        console.error(
          `[DocumentIngestion] failed to purge blob for expired document ${current.id}:`,
          err,
        );
      }

      await this.repository.deletePermanently(current.id);
      await this.audit.log({
        action: 'document.purged',
        actorId: 'system',
        projectId: current.projectId,
        documentId: current.id,
        details: { storageKey: current.storageKey, deletedAt: current.deletedAt },
      });
      purged += 1;
    }

    return purged;
  }

  public async createDownloadUrl(
    authCtx: AuthContext,
    documentId: string,
    expiresInMinutes = 15,
    inline = false,
  ): Promise<string> {
    const document = await this.requireDocument(documentId);
    await this.permissions.assertCanDownload(authCtx, document);

    if (document.isDeleted) throw new DocumentIngestionError('Document has been deleted', 410);

    await this.audit.log({
      action: 'document.download_url',
      actorId: authCtx.userId,
      projectId: document.projectId,
      documentId,
      details: { expiresInMinutes, inline },
    });

    return this.storage.createSignedDownloadUrl(document.storageKey, expiresInMinutes, {
      inline,
      fileName: document.originalName,
    });
  }

  /** Streams an authorized document through the API without exposing its
   * Azure storage path or project identifier to the browser address bar. */
  public async download(authCtx: AuthContext, documentId: string): Promise<{
    document: DocumentRecord;
    stream: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
    contentDisposition?: string;
  }> {
    const document = await this.requireDocument(documentId);
    await this.permissions.assertCanDownload(authCtx, document);

    if (document.isDeleted) throw new DocumentIngestionError('Document has been deleted', 410);

    let file: {
      stream: NodeJS.ReadableStream;
      contentType?: string;
      contentLength?: number;
      contentDisposition?: string;
    };

    try {
      file = await this.storage.download(document.storageKey, document.originalName, document.blobUrl);
    } catch (storageErr: any) {
      if (document.metadata?.['source'] === 'outlook' && document.metadata?.['messageId']) {
        try {
          const { outlookService } = require('../outlook/outlook.router');
          const recovered = typeof outlookService?.recoverDocumentStream === 'function'
            ? await outlookService.recoverDocumentStream(
                String(document.metadata['messageId']),
                document.originalName,
                document.storageKey,
              )
            : null;
          if (recovered) {
            file = {
              stream: recovered.stream,
              contentType: recovered.contentType || document.mimeType || 'application/pdf',
              contentLength: recovered.contentLength || document.byteSize,
              contentDisposition: `inline; filename="${document.originalName.replace(/"/g, '')}"`,
            };
          } else {
            throw storageErr;
          }
        } catch {
          throw storageErr;
        }
      } else {
        throw storageErr;
      }
    }

    await this.audit.log({
      action: 'document.download',
      actorId: authCtx.userId,
      projectId: document.projectId,
      documentId,
    });

    return { document, ...file };
  }

  /**
   * Ids of the still-active documents a Teams channel put into projects other
   * than `excludeProjectId`. Both channel attachments and files pulled from
   * Dropbox links in a message carry metadata.source 'teams' plus the channel
   * id, so one query covers everything that channel produced.
   */
  public async listTeamsChannelDocumentIds(
    channelId: string,
    excludeProjectId: string
  ): Promise<string[]> {
    if (!channelId || !mongoose.Types.ObjectId.isValid(excludeProjectId)) return [];
    const excluded = new mongoose.Types.ObjectId(excludeProjectId);
    const docs = await DocumentModel.find({
      'metadata.source': 'teams',
      'metadata.channelId': channelId,
      isActive: true,
      projectId: { $nin: [excluded, excludeProjectId] },
    }).select('_id');
    return docs.map((doc: any) => String(doc._id));
  }

  public async moveDocuments(
    authCtx: AuthContext,
    documentIds: string[],
    targetProjectId: string,
    options?: { runExtraction?: boolean }
  ): Promise<{ movedCount: number; documentIds: string[] }> {
    if (!documentIds || documentIds.length === 0) {
      throw new DocumentIngestionError('documentIds array cannot be empty', 400);
    }
    if (!targetProjectId) {
      throw new DocumentIngestionError('targetProjectId is required', 400);
    }

    const { projectRepository } = require('../../repositories/index');
    const { dropboxSyncService } = require('../projects/dropbox-sync.service');
    const targetProject = await projectRepository.findById(targetProjectId);
    if (!targetProject) {
      throw new DocumentIngestionError('Target project not found', 404);
    }

    const targetProjectObjId = new mongoose.Types.ObjectId(targetProjectId);
    const docs = await DocumentModel.find({ _id: { $in: documentIds.map((id: string) => new mongoose.Types.ObjectId(id)) } });
    if (docs.length === 0) {
      throw new DocumentIngestionError('No matching documents found to move', 404);
    }

    const sourceProjectIds = [...new Set(docs.map((d: any) => d.projectId?.toString()).filter(Boolean))];
    let sourceProject = null;
    if (sourceProjectIds.length === 1 && sourceProjectIds[0]) {
      sourceProject = await projectRepository.findById(sourceProjectIds[0]);
    }

    // 1. Update in MongoDB
    await DocumentModel.updateMany(
      { _id: { $in: docs.map((d: any) => d._id) } },
      { $set: { projectId: targetProjectObjId, status: 'PROCESSED', isActive: true } }
    );

    // 2. Move in Dropbox
    dropboxSyncService.moveDocumentsInDropbox(docs, sourceProject, targetProject).catch((err: any) =>
      console.error(`[DocumentIngestion] Failed to move documents in Dropbox to ${targetProjectId}:`, err)
    );

    // 3. AI Extraction vs Pending Approvals
    if (options?.runExtraction !== false) {
      // Re-run AI analysis immediately
      this.fireOnDocumentIngested(targetProjectId, docs.map((d: any) => String(d._id)));
    } else {
      // Place in Pending Approvals for human review on target project
      try {
        const { PendingChangeApprovalModel, ChangeSource, ApprovalStatus } = require('../../db/models/pending-change-approval.model');
        const firstDocId = String(docs[0]!._id);
        const correlationId = `docMove:${firstDocId}`;
        await PendingChangeApprovalModel.create({
          projectId: targetProjectId,
          source: ChangeSource.MANUAL,
          sourceId: firstDocId,
          correlationId,
          documentIds: docs.map((d: any) => String(d._id)),
          documentNames: docs.map((d: any) => d.originalName),
          reasoning: `${docs.length} document(s) moved to this project. Review & approve to run AI parameter extraction.`,
          confidence: 0.8,
          status: ApprovalStatus.PENDING,
          detectedChanges: [],
        });
        console.log(`[DocumentIngestion] Created pending approval for ${docs.length} moved document(s) on project ${targetProjectId}`);
      } catch (err: any) {
        console.error(`[DocumentIngestion] Failed to create pending approval for moved documents:`, err);
      }
    }

    // 4. Audit log
    for (const doc of docs) {
      await this.audit.log({
        action: 'document.moved',
        actorId: authCtx.userId,
        projectId: targetProjectId,
        documentId: String(doc._id),
        details: { fromProjectId: doc.projectId?.toString(), toProjectId: targetProjectId },
      });
    }

    return {
      movedCount: docs.length,
      documentIds: docs.map((d: any) => String(d._id)),
    };
  }

  public async markProcessing(documentId: string): Promise<DocumentRecord> {
    return this.repository.update(documentId, { status: 'PROCESSING', errorMessage: undefined, updatedAt: this.now() });
  }

  public async markProcessed(documentId: string): Promise<DocumentRecord> {
    return this.repository.update(documentId, { status: 'PROCESSED', processedAt: this.now(), errorMessage: undefined, updatedAt: this.now() });
  }

  public async markFailed(documentId: string, errorMessage: string): Promise<DocumentRecord> {
    return this.repository.update(documentId, { status: 'FAILED', errorMessage, updatedAt: this.now() });
  }

  private async ingestOne(ctx: AuthContext, input: IngestDocumentInput, parentArchiveId: string | undefined): Promise<DocumentRecord> {
    const extension = getSafeExtension(input.file.originalName);
    const uploadedAt = this.now();
    const documentId = this.idFactory();
    const rootDocumentId = input.replaceDocumentId ?? documentId;
    const latest = input.replaceDocumentId ? await this.repository.findLatestByRoot(input.projectId, rootDocumentId) : null;
    const version = latest ? latest.version + 1 : 1;
    let sha256: string;
    let contentHash: string;
    if (input.file.path) {
      sha256 = await hashFileSha256(input.file.path);
      contentHash = sha256;
    } else {
      sha256 = hashSha256(input.file.buffer!);
      contentHash = calculateContentHash(input.file.buffer!);
    }

    // Check for existing document with same content hash (cache lookup)
    let cachedDocument: DocumentRecord | null = null;
    let isCacheHit = false;

    try {
      cachedDocument = await this.repository.findByContentHash(contentHash);
      if (cachedDocument && cachedDocument.cachedAiResultRef) {
        isCacheHit = true;
        console.log(`[Deduplication] Cache hit for contentHash=${contentHash}, reusing AI result from document ${cachedDocument.id}`);
      }
    } catch (error) {
      // If cache lookup fails, proceed with normal processing
      console.warn(`[Deduplication] Cache lookup failed for contentHash=${contentHash}, proceeding with normal processing:`, error);
    }

    let stored: StoredBlob;
    
    if (isCacheHit && cachedDocument) {
      // Reuse existing storage from cached document
      stored = {
        storageKey: cachedDocument.storageKey,
        blobUrl: cachedDocument.blobUrl,
        sha256: cachedDocument.sha256,
        byteSize: cachedDocument.byteSize
      };
    } else if (input.file.path) {
      const storageKey = `projects/${sanitizePathSegment(input.projectId)}/documents/${sanitizeFileName(input.file.originalName)}`;
      stored = await this.storage.putStream({
        storageKey,
        mimeType: input.file.mimeType,
        stream: fs.createReadStream(input.file.path),
      });
    } else {
      // Normal storage upload
      stored = await this.storage.put({
        projectId: input.projectId,
        sha256,
        originalName: input.file.originalName,
        mimeType: input.file.mimeType,
        buffer: input.file.buffer!,
      });
    }

    const record: DocumentRecord = {
      id: documentId,
      projectId: input.projectId,
      rootDocumentId,
      previousVersionId: latest?.id,
      version,
      isLatest: true,
      isDeleted: false,
      isFinalInput: Boolean(input.markAsFinalInput),
      documentType: input.documentType,
      status: 'PENDING',
      originalName: input.file.originalName,
      mimeType: input.file.mimeType,
      extension,
      storageKey: stored.storageKey,
      blobUrl: stored.blobUrl,
      sha256: stored.sha256,
      byteSize: stored.byteSize,
      uploadedBy: input.uploadedBy,
      uploadedAt,
      updatedAt: uploadedAt,
      metadata: input.metadata ?? {},
      parentArchiveId,
      // Document deduplication fields
      contentHash,
      contentHashCachedAt: uploadedAt,
      cachedAiResultRef: isCacheHit ? cachedDocument?.cachedAiResultRef : undefined
    };

    const created = await this.repository.create(record);
    await this.repository.markPriorVersionsNotLatest(input.projectId, rootDocumentId, documentId);

    const aiSasUrl = await this.storage.createSignedDownloadUrl(stored.storageKey, 60);

    // Only publish to AI queue if not a cache hit or if cached result is not available
    if (!isCacheHit || !cachedDocument?.cachedAiResultRef) {
      // Normal standard AI payload structure 
      // await this.queue.publish({
      //   jobType: 'DOCUMENT_EXTRACTION',
      //   correlationId: `doc:${documentId}`,
      //   payload: {
      //     projectId: input.projectId,
      //     documentId: documentId,
      //     blobUrl: aiSasUrl,
      //   }
      // });
      
      // For Demo for just Document No Email we will change to standard structure above after Demo
      await this.queue.publish({
        project_id: input.projectId,
        document_id: documentId,
        blob_url: aiSasUrl
      });
    } else {
      console.log(`[Deduplication] Skipping AI queue for document ${documentId} due to cache hit`);
    }

    await this.audit.log({
      action: parentArchiveId ? 'document.zip_child_uploaded' : isCacheHit ? 'document.uploaded_cache_hit' : 'document.uploaded',
      actorId: ctx.userId,
      projectId: input.projectId,
      documentId,
      details: { 
        rootDocumentId, 
        previousVersionId: latest?.id, 
        version, 
        documentType: input.documentType, 
        originalName: input.file.originalName, 
        parentArchiveId, 
        storageKey: stored.storageKey, 
        sha256,
        contentHash,
        isCacheHit,
        cachedFromDocumentId: cachedDocument?.id
      },
    });

    return created;
  }

  private validateFile(file: UploadedFile): void {
    const hasData = (file.buffer && file.buffer.length > 0) || (file.size !== undefined && file.size > 0);
    if (!hasData) throw new DocumentIngestionError('File is empty', 400);
    const extension = getSafeExtension(file.originalName);
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new DocumentIngestionError(`Unsupported file extension: ${extension}`, 415);
    if (!SUPPORTED_MIME_TYPES.has(file.mimeType)) throw new DocumentIngestionError(`Unsupported MIME type: ${file.mimeType}`, 415);
    const allowedMimes = EXTENSION_TO_MIME_HINTS[extension] ?? [];
    if (allowedMimes.length > 0 && !allowedMimes.includes(file.mimeType)) {
      throw new DocumentIngestionError(`MIME type ${file.mimeType} does not match extension ${extension}`, 415);
    }
  }

  private isZip(file: UploadedFile): boolean {
    return getSafeExtension(file.originalName) === '.zip';
  }

  private async requireDocument(documentId: string): Promise<DocumentRecord> {
    let document = await this.repository.findById(documentId);
    if (!document) {
      const doc = await DocumentModel.findOne({
        $or: [{ storageKey: documentId }, { 'metadata.storageKey': documentId }],
      }).exec();
      if (doc) {
        document = (this.repository as any).toDomain(doc);
      }
    }

    if (!document) {
      const email = await OutlookEmail.findOne({
        $or: [
          { 'attachments.storageKey': documentId },
          { 'attachments.id': documentId },
        ],
      }).lean();

      if (email && email.attachments) {
        const att = (email.attachments as any[]).find(
          (a) => a.storageKey === documentId || a.id === documentId
        );
        if (att) {
          const fakeDoc: DocumentRecord = {
            id: String(att.id || documentId),
            projectId: email.projectId ? String(email.projectId) : null,
            rootDocumentId: String(att.id || documentId),
            version: 1,
            isLatest: true,
            isDeleted: false,
            isFinalInput: false,
            isInternal: false,
            documentType: 'other',
            status: 'STAGING',
            originalName: att.name || 'Attachment',
            mimeType: att.contentType || 'application/octet-stream',
            extension: (att.name || '').split('.').pop() || '',
            storageKey: att.storageKey || documentId,
            blobUrl: '',
            sha256: '',
            byteSize: att.size || 0,
            uploadedBy: 'system',
            uploadedAt: email.receivedDateTime || new Date(),
            updatedAt: email.receivedDateTime || new Date(),
            metadata: {},
          };
          return fakeDoc;
        }
      }
    }

    if (!document && (documentId.startsWith('documents/') || documentId.includes('/'))) {
      const fileName = documentId.split('/').pop() || 'document';
      const fakeDoc: DocumentRecord = {
        id: documentId,
        projectId: null,
        rootDocumentId: documentId,
        version: 1,
        isLatest: true,
        isDeleted: false,
        isFinalInput: false,
        isInternal: false,
        documentType: 'other',
        status: 'STAGING',
        originalName: fileName,
        mimeType: 'application/octet-stream',
        extension: fileName.split('.').pop() || '',
        storageKey: documentId,
        blobUrl: '',
        sha256: '',
        byteSize: 0,
        uploadedBy: 'system',
        uploadedAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      };
      return fakeDoc;
    }

    if (!document) throw new DocumentIngestionError('Document not found', 404);
    return document;
  }
}

export class AzureContentAddressedBlobStorage implements BlobStorage {
  private readonly serviceClient: BlobServiceClient;
  private readonly credential?: StorageSharedKeyCredential;
  private readonly containerName: string;

  public constructor(options: { connectionString?: string; accountName?: string; accountKey?: string; containerName: string; }) {
    this.containerName = options.containerName;
    if (options.connectionString) {
      this.serviceClient = BlobServiceClient.fromConnectionString(options.connectionString);
      return;
    }
    if (!options.accountName || !options.accountKey) {
      throw new Error('Azure storage requires connectionString or accountName/accountKey');
    }
    this.credential = new StorageSharedKeyCredential(options.accountName, options.accountKey);
    this.serviceClient = new BlobServiceClient(`https://${options.accountName}.blob.core.windows.net`, this.credential);
  }

  public async putStream(input: { storageKey: string; mimeType: string; stream: NodeJS.ReadableStream; }): Promise<StoredBlob> {
    const container = this.serviceClient.getContainerClient(this.containerName);
    await container.createIfNotExists();
    const blob = container.getBlockBlobClient(input.storageKey);

    const hash = crypto.createHash('sha256');
    const passThrough = new PassThrough();

    (input.stream as Readable).on('data', (chunk) => hash.update(chunk));
    (input.stream as Readable).pipe(passThrough);

    // 4 MB blocks, up to 5 concurrent — constant memory (~20 MB max) regardless of file size (e.g. 1 GB+).
    await blob.uploadStream(passThrough, 4 * 1024 * 1024, 5, {
      blobHTTPHeaders: { blobContentType: input.mimeType },
    });
    const props = await blob.getProperties();
    const computedSha256 = hash.digest('hex');
    return { storageKey: input.storageKey, blobUrl: blob.url, sha256: computedSha256 || 'dropbox-sync-stream', byteSize: props.contentLength ?? 0 };
  }

  public async put(input: { projectId: string; sha256: string; originalName: string; mimeType: string; buffer: Buffer; }): Promise<StoredBlob> {
    const container = this.serviceClient.getContainerClient(this.containerName);
    await container.createIfNotExists();
   // const extension = getSafeExtension(input.originalName);
    const storageKey = `projects/${sanitizePathSegment(input.projectId)}/documents/${sanitizeFileName(input.originalName)}`;
    const blob = container.getBlockBlobClient(storageKey);
    
    await blob.uploadData(input.buffer, {
      blobHTTPHeaders: { blobContentType: input.mimeType, blobContentDisposition: `attachment; filename="${sanitizeFileName(input.originalName)}"` },
      metadata: { projectId: sanitizeMetadataValue(input.projectId), sha256: input.sha256, originalName: sanitizeMetadataValue(input.originalName) },
    });

    return { storageKey, blobUrl: blob.url, sha256: input.sha256, byteSize: input.buffer.length };
  }

  public async delete(storageKey: string): Promise<void> {
    const container = this.serviceClient.getContainerClient(this.containerName);
    await container.getBlockBlobClient(storageKey).deleteIfExists();
  }

  private static discoveredContainersCache: { containers: Set<string>; cachedAt: number } | null = null;

  private async getDiscoveredContainers(): Promise<Set<string>> {
    const now = Date.now();
    if (
      AzureContentAddressedBlobStorage.discoveredContainersCache &&
      now - AzureContentAddressedBlobStorage.discoveredContainersCache.cachedAt < 30 * 60 * 1000
    ) {
      return AzureContentAddressedBlobStorage.discoveredContainersCache.containers;
    }
    const discovered = new Set<string>();
    try {
      for await (const c of this.serviceClient.listContainers()) {
        discovered.add(c.name);
      }
      AzureContentAddressedBlobStorage.discoveredContainersCache = { containers: discovered, cachedAt: now };
    } catch (listErr: any) {
      console.warn('[AzureBlobStorage] Failed to list containers:', listErr?.message || listErr);
    }
    return discovered;
  }

  public async createSignedDownloadUrl(
    storageKey: string,
    expiresInMinutes: number,
    options?: { inline?: boolean; fileName?: string },
  ): Promise<string> {
    let effectiveContainer = this.containerName;
    let effectiveKey = storageKey;

    // Fast path: check default container first
    let found = false;
    try {
      const defaultClient = this.serviceClient.getContainerClient(this.containerName).getBlobClient(storageKey);
      if (await defaultClient.exists()) {
        found = true;
      }
    } catch {}

    if (!found) {
      const candidateContainers = [this.containerName, 'gfsblobstorage001', 'documents'].filter(Boolean) as string[];
      const candidateKeys = [
        storageKey,
        storageKey.startsWith('documents/') ? storageKey.replace(/^documents\//, '') : undefined,
        storageKey.startsWith('staging/') ? storageKey.replace(/^staging\//, '') : undefined,
      ].filter(Boolean) as string[];

      for (const cName of [...new Set(candidateContainers)]) {
        try {
          const container = this.serviceClient.getContainerClient(cName);
          for (const kName of candidateKeys) {
            const blobClient = container.getBlobClient(kName);
            if (await blobClient.exists()) {
              effectiveContainer = cName;
              effectiveKey = kName;
              found = true;
              break;
            }
          }
          if (found) break;
        } catch {}
      }
    }

    const container = this.serviceClient.getContainerClient(effectiveContainer);
    const blob = container.getBlockBlobClient(effectiveKey);
    const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Override the blob's stored `attachment` disposition so previews render
    // inline in the browser instead of downloading.
    const contentDisposition = options?.inline
      ? `inline${options.fileName ? `; filename="${options.fileName.replace(/"/g, '')}"` : ''}`
      : undefined;

    if (this.credential) {
      const sas = generateBlobSASQueryParameters(
        {
          containerName: effectiveContainer,
          blobName: effectiveKey,
          permissions: BlobSASPermissions.parse('r'),
          expiresOn,
          ...(contentDisposition ? { contentDisposition } : {}),
        },
        this.credential,
      ).toString();
      return `${blob.url}?${sas}`;
    }

    return blob.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
      ...(contentDisposition ? { contentDisposition } : {}),
    });
  }

  public async download(storageKey: string, originalName?: string, blobUrl?: string): Promise<{
    stream: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
    contentDisposition?: string;
  }> {
    // 1. Direct download attempt (FAST PATH - 1 Azure call, < 200ms)
    let urlContainer: string | undefined;
    let urlBlobName: string | undefined;
    if (blobUrl) {
      try {
        const parsedUrl = new URL(blobUrl);
        const parts = parsedUrl.pathname.replace(/^\//, '').split('/');
        if (parts.length >= 2) {
          urlContainer = parts[0];
          urlBlobName = parts.slice(1).join('/');
        }
      } catch {}
    }

    const directTargets: { container: string; key: string }[] = [];
    if (urlContainer && urlBlobName) {
      directTargets.push({ container: urlContainer, key: urlBlobName });
    }
    if (storageKey) {
      directTargets.push({ container: this.containerName, key: storageKey });
      if (storageKey.startsWith('documents/')) {
        directTargets.push({ container: this.containerName, key: storageKey.replace(/^documents\//, '') });
      }
    }

    for (const target of directTargets) {
      try {
        const container = this.serviceClient.getContainerClient(target.container);
        const blob = container.getBlobClient(target.key);
        const response = await blob.download();
        if (response.readableStreamBody) {
          return {
            stream: response.readableStreamBody,
            contentType: response.contentType,
            contentLength: response.contentLength,
            contentDisposition: response.contentDisposition,
          };
        }
      } catch (err: any) {
        // Continue to next target or fallback if direct key failed
      }
    }

    // 2. Fast local filesystem check (only in non-production or if direct local file exists)
    if (process.env['NODE_ENV'] !== 'production') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const searchDirs = [
          path.resolve(process.cwd(), 'uploads'),
          path.resolve(process.cwd(), '../uploads'),
        ];
        const targetOrig = originalName ? originalName.toLowerCase() : null;
        for (const sDir of searchDirs) {
          if (!fs.existsSync(sDir)) continue;
          const directFile = path.join(sDir, path.basename(storageKey));
          if (fs.existsSync(directFile)) {
            const stat = fs.statSync(directFile);
            return {
              stream: fs.createReadStream(directFile),
              contentType: 'application/pdf',
              contentLength: stat.size,
              contentDisposition: `inline; filename="${path.basename(directFile)}"`,
            };
          }
          if (targetOrig) {
            const origFile = path.join(sDir, originalName!);
            if (fs.existsSync(origFile)) {
              const stat = fs.statSync(origFile);
              return {
                stream: fs.createReadStream(origFile),
                contentType: 'application/pdf',
                contentLength: stat.size,
                contentDisposition: `inline; filename="${path.basename(origFile)}"`,
              };
            }
          }
        }
      } catch {}
    }

    // 3. Cached container discovery and candidate key fallback
    const discoveredContainers = await this.getDiscoveredContainers();
    const candidateContainers = [
      urlContainer,
      this.containerName,
      'gfsblobstorage001',
      'documents',
    ].filter(Boolean) as string[];

    const validContainers = discoveredContainers.size > 0
      ? candidateContainers.filter((c) => discoveredContainers.has(c))
      : candidateContainers;

    const candidateKeys = [
      urlBlobName,
      urlBlobName ? urlBlobName.replace(/^documents\//, '') : undefined,
      urlBlobName ? urlBlobName.replace(/^staging\//, '') : undefined,
      urlBlobName ? urlBlobName.replace(/^documents\/staging\//, '') : undefined,
      storageKey,
      storageKey.startsWith('documents/') ? storageKey.replace(/^documents\//, '') : undefined,
      storageKey.startsWith('staging/') ? storageKey.replace(/^staging\//, '') : undefined,
      storageKey.includes('staging/') ? storageKey.slice(storageKey.indexOf('staging/')) : undefined,
    ].filter(Boolean) as string[];

    const uniqueKeys = [...new Set(candidateKeys)];
    let lastError: any = null;

    for (const cName of [...new Set(validContainers)]) {
      const container = this.serviceClient.getContainerClient(cName);
      for (const kName of uniqueKeys) {
        try {
          const blob = container.getBlobClient(kName);
          const response = await blob.download();
          if (response.readableStreamBody) {
            return {
              stream: response.readableStreamBody,
              contentType: response.contentType,
              contentLength: response.contentLength,
              contentDisposition: response.contentDisposition,
            };
          }
        } catch (err: any) {
          lastError = err;
        }
      }
    }

    // 4. Direct URL fetch fallback if blobUrl is accessible
    if (blobUrl) {
      try {
        const fetchRes = await fetch(blobUrl);
        if (fetchRes.ok && fetchRes.body) {
          const { Readable } = await import('stream');
          return {
            stream: Readable.fromWeb(fetchRes.body as any),
            contentType: fetchRes.headers.get('content-type') || 'application/pdf',
            contentLength: Number(fetchRes.headers.get('content-length')) || undefined,
            contentDisposition: fetchRes.headers.get('content-disposition') || `inline; filename="${originalName || 'document.pdf'}"`,
          };
        }
      } catch {}
    }

    throw new DocumentIngestionError(`Document content is unavailable: ${lastError?.message || lastError || 'no candidates succeeded'}`, 502);
  }
}

export class ConsoleAuditLogger implements AuditLogger {
  public async log(event: { action: string; actorId: string; projectId: string; documentId?: string; details?: Record<string, unknown>; }): Promise<void> {
    console.info('[document-audit]', JSON.stringify(event));
  }
}

export class AdmZipExtractor implements ZipExtractor {
  public async extract(file: UploadedFile): Promise<UploadedFile[]> {
    const AdmZip = require('adm-zip');
    const zip = file.path ? new AdmZip(file.path) : new AdmZip(file.buffer);
    const output: UploadedFile[] = [];

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const originalName = sanitizeZipEntryName(entry.entryName);
      const extension = getSafeExtension(originalName);
      if (!SUPPORTED_EXTENSIONS.has(extension) || extension === '.zip') continue;

      output.push({ originalName, mimeType: mimeTypeFromExtension(extension), buffer: entry.getData() });
    }
    return output;
  }
}
