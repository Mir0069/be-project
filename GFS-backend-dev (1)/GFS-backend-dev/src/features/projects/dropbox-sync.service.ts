import { env } from '@config/index';
import { DocumentModel, DocumentTypeTag, type IDocument } from '@db/models/document.model';
import type { IDomainProject } from '@repositories/interfaces/i-project.repository';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';
import { isEmailBodyDocument } from '@features/document-ingestion/document-ingestion.types';
import mongoose from 'mongoose';
import crypto from 'crypto';
import path from 'path';
import unzipper from 'unzipper';
import { Readable } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import { CallRecord } from '@db/models/call-record.model';
import axios from 'axios';
import {
  getDropboxAccessToken,
  createDropboxFolder,
  listDropboxPath,
  downloadDropboxFileByPath,
  uploadDropboxFileByPath,
  deleteDropboxFileByPath,
  moveDropboxFileByPath,
  streamToBuffer,
  buildDropboxFolderPath,
  type DropboxEntry,
} from '@shared/utils/dropbox';
import type { PendingApprovalService } from '@features/proposal/pending-approval.service';
import { ChangeSource } from '@db/models/pending-change-approval.model';
import { MongooseProposalRepository } from '@repositories/mongoose/proposal.repository';
import { excelIngestionService } from '@features/proposal/excel/excel-ingestion.service';
import { notificationService } from '@features/notifications/notification.router';
import { azureSpeechService } from '@services/azure-speech.service';

// ── Folder name constants (must match the plan exactly) ──────────────────────
const SUBFOLDER_DRAWINGS = 'Customer Provided Info & Project drawings';
const SUBFOLDER_QUOTES = 'Worksheets and quotes';
const SUBFOLDER_TRANSCRIPTS = 'Telephone Transcripts';

/** Maps a GFS DocumentTypeTag to the correct Dropbox subfolder name. */
function dropboxSubfolder(documentType: DocumentTypeTag): string {
  switch (documentType) {
    case DocumentTypeTag.QUOTE:
      return SUBFOLDER_QUOTES;
    case DocumentTypeTag.TRANSCRIPT:
      return SUBFOLDER_TRANSCRIPTS;
    default:
      return SUBFOLDER_DRAWINGS;
  }
}

/** Maps a Dropbox subfolder name to the GFS DocumentTypeTag for inward sync. */
function gfsDocumentType(subfolderName: string): DocumentTypeTag {
  const norm = (subfolderName || '').trim().toLowerCase();
  if (norm.includes('quote') || norm.includes('worksheet')) {
    return DocumentTypeTag.QUOTE;
  }
  if (norm.includes('transcript') || norm.includes('phone') || norm.includes('telephone')) {
    return DocumentTypeTag.TRANSCRIPT;
  }
  if (norm.includes('drawing') || norm.includes('customer') || norm.includes('info')) {
    return DocumentTypeTag.DRAWING;
  }
  return DocumentTypeTag.OTHER;
}

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
};

const UNSUPPORTED_CAD_EXTENSIONS = new Set(['.dwg', '.dxf', '.cad', '.dwf']);

const AUDIO_VIDEO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.webm', '.wma',
  '.mp4', '.mov', '.mkv', '.avi', '.wmv',
]);
function mimeFromExt(ext: string): string {
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

const STATIC_WEBVTT_HEADER_RE = /^WEBVTT\s*/i;
const STATIC_TIMESTAMP_RE = /\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g;
const STATIC_SEQUENCE_NUM_RE = /^\s*\d+\s*$/gm;
const STATIC_SPEAKER_TAG_RE = /<v\s+([^>]+)>/gi;
const STATIC_HTML_TAGS_RE = /<[^>]+>/g;
const STATIC_COLLAPSE_LINES_RE = /\n\s*\n/g;

function cleanTranscriptText(text: string, ext: string): string {
  if (ext === '.vtt' || ext === '.srt') {
    let cleaned = text.replace(STATIC_WEBVTT_HEADER_RE, '');
    cleaned = cleaned.replace(STATIC_TIMESTAMP_RE, '');
    cleaned = cleaned.replace(STATIC_SEQUENCE_NUM_RE, '');
    cleaned = cleaned.replace(STATIC_SPEAKER_TAG_RE, '$1: ');
    cleaned = cleaned.replace(STATIC_HTML_TAGS_RE, '');
    cleaned = cleaned.replace(STATIC_COLLAPSE_LINES_RE, '\n');
    return cleaned.trim();
  }
  return text;
}

/**
 * Manages 2-way Dropbox sync for all active GFS projects.
 *
 * Loop-prevention: every Document in GFS has two metadata fields:
 *   - `metadata.syncedToDropbox` (boolean) — set true after outward upload
 *   - `metadata.dropboxPath` (string)       — absolute Dropbox path of the file
 */
export class DropboxSyncService {
  private readonly projectRepository: MongooseProjectRepository;
  private readonly proposalRepository: MongooseProposalRepository;
  private readonly blobStorage: AzureContentAddressedBlobStorage;
  private pendingApprovalService?: PendingApprovalService;
  private isPollerRunning = false;
  private pollerTimeout: ReturnType<typeof setTimeout> | null = null;

  public constructor(pendingApprovalService?: PendingApprovalService) {
    this.projectRepository = new MongooseProjectRepository();
    this.proposalRepository = new MongooseProposalRepository();
    this.blobStorage = new AzureContentAddressedBlobStorage({
      connectionString: env.azure.storageConnectionString,
      containerName: env.azure.storageContainerName || 'documents',
    });
    this.pendingApprovalService = pendingApprovalService;
  }

  public setPendingApprovalService(service: PendingApprovalService): void {
    this.pendingApprovalService = service;
  }

  private async getToken(): Promise<string> {
    if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
      return 'mock-test-dropbox-token';
    }
    return getDropboxAccessToken({
      clientId: env.dropbox.clientId,
      clientSecret: env.dropbox.clientSecret,
      refreshToken: env.dropbox.refreshToken,
      accessToken: env.dropbox.accessToken,
    });
  }

  private async resolveDropboxFolder(project: IDomainProject, token: string): Promise<string> {
    let targetPath = project.dropboxFolderPath;
    if (!targetPath) {
      targetPath = buildDropboxFolderPath(project.projectName, project.referenceNumber);
    }

    try {
      await listDropboxPath(targetPath, token);
      return targetPath;
    } catch (err: any) {
      console.warn(`[DropboxSync] Direct folder lookup failed for "${targetPath}": ${err?.message ?? err}. Attempting auto-discovery by reference number ${project.referenceNumber}...`);
    }

    const ref = (project.referenceNumber || '').trim();
    if (ref) {
      const rootPaths = [env.dropbox.rootPath, '/GFS-Projects', '/GFS Projects', ''];
      const searchTerms = [
        ref.toLowerCase(),
        ref.toLowerCase().replace(/-/g, ' '),
        ref.toLowerCase().replace(/-/g, '')
      ];

      for (const root of rootPaths) {
        try {
          const entries = await listDropboxPath(root, token);
          for (const entry of entries) {
            if (entry['.tag'] === 'folder') {
              const nameLower = entry.name.toLowerCase();
              if (searchTerms.some(term => term && nameLower.includes(term))) {
                console.log(`[DropboxSync] Discovered matching Dropbox folder for project ${project.referenceNumber}: "${entry.path_display}"`);
                project.dropboxFolderPath = entry.path_display;
                await this.projectRepository.updateById(project.id, { dropboxFolderPath: entry.path_display }).catch(() => {});
                return entry.path_display;
              }
            }
          }
        } catch {
          // continue to next root candidate
        }
      }
    }

    return targetPath;
  }

  private async ensureSubfolders(folderPath: string, token: string): Promise<boolean> {
    try {
      await createDropboxFolder(folderPath, token);
      await createDropboxFolder(`${folderPath}/${SUBFOLDER_DRAWINGS}`, token);
      await createDropboxFolder(`${folderPath}/${SUBFOLDER_QUOTES}`, token);
      await createDropboxFolder(`${folderPath}/${SUBFOLDER_TRANSCRIPTS}`, token);
      return true;
    } catch (err: any) {
      console.warn(`[DropboxSync] Could not verify/create subfolders for ${folderPath}:`, err?.message ?? err);
      return false;
    }
  }

  private async ensureProjectWorkspace(project: IDomainProject, token: string): Promise<string | null> {
    const folderPath = await this.resolveDropboxFolder(project, token);
    project.dropboxFolderPath = folderPath;
    if (!await this.ensureSubfolders(folderPath, token)) return null;

    const estimatorIds = (project.assignedEstimators ?? []).map(
      (e: any) => (typeof e === 'string' ? e : e?.id ?? e?._id?.toString())
    ).filter(Boolean);

    await notificationService.notifyDropboxWorkspaceCreated({
      projectId: project.id,
      referenceNumber: project.referenceNumber,
      projectName: project.projectName,
      folderPath,
      estimatorIds,
    });
    return folderPath;
  }

  // ── Outward Sync (GFS → Dropbox) ─────────────────────────────────────────

  public async outwardSync(project: IDomainProject): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(project.id)) {
      console.warn(`[DropboxSync] outwardSync skipped — invalid project ID: ${project.id}`);
      return;
    }

    let token: string;
    try {
      token = await this.getToken();
    } catch (err: any) {
      console.warn(`[DropboxSync] outwardSync skipped for project ${project.id} — Dropbox token unavailable: ${err?.message || err}`);
      return;
    }
    const folderPath = await this.ensureProjectWorkspace(project, token);
    if (!folderPath) return;
    const projId = new mongoose.Types.ObjectId(project.id);

    // 1. Deletion Sync (GFS -> Dropbox): Find soft-deleted or non-latest docs that are marked as synced
    const deletedDocs = await DocumentModel.find({
      projectId: { $in: [projId, project.id] },
      $or: [{ isActive: false }, { isLatest: false }],
      'metadata.syncedToDropbox': true,
    });

    for (const doc of deletedDocs) {
      try {
        const dropboxPath = doc.metadata.get ? doc.metadata.get('dropboxPath') : (doc.metadata as any)?.dropboxPath;
        if (dropboxPath) {
          await deleteDropboxFileByPath(dropboxPath, token);
          console.log(`[DropboxSync] Deleted from Dropbox: ${dropboxPath}`);
        }
        await DocumentModel.updateOne(
          { _id: doc._id },
          { $set: { 'metadata.syncedToDropbox': false, 'metadata.dropboxPath': null } }
        );
      } catch (err: any) {
        console.error(`[DropboxSync] outward deletion failed for doc ${String(doc._id)}:`, err?.message ?? err);
      }
    }

    // 2. Active Sync: Find active, latest docs that need syncing (exclude internal system documents)
    const docs = await DocumentModel.find({
      projectId: { $in: [projId, project.id] },
      isActive: true,
      isLatest: true,
      isInternal: { $ne: true },
      originalName: { $not: /^email-.*\.txt$/i },
      status: { $in: ['PROCESSED', 'STAGING'] },
      'metadata.syncedToDropbox': { $ne: true },
      'metadata.isEmailBody': { $ne: true },
    });

    for (const doc of docs) {
      // Email body text is retained for AI extraction only. It must not be
      // copied to Dropbox as if it were a customer-provided project file.
      if (isEmailBodyDocument(doc)) {
        console.log(`[DropboxSync] skipped internal email body: ${doc.originalName}`);
        continue;
      }

      const docExt = path.extname(doc.originalName || '').toLowerCase();
      if (UNSUPPORTED_CAD_EXTENSIONS.has(docExt)) {
        console.log(`[DropboxSync] skipped unsupported CAD/DWG file from outward sync: ${doc.originalName}`);
        continue;
      }

      try {
        const subfolder = dropboxSubfolder(doc.documentType as DocumentTypeTag);
        const dropboxPath = `${project.dropboxFolderPath}/${subfolder}/${doc.originalName}`;

        const signedUrl = await this.blobStorage.createSignedDownloadUrl(doc.storageKey, 30);
        const res = await axios.get(signedUrl, { responseType: 'stream' });
        const stream = res.data as NodeJS.ReadableStream;

        const uploadRes = await uploadDropboxFileByPath(dropboxPath, stream, doc.byteSize, token);

        const updateData: Record<string, any> = {
          'metadata.syncedToDropbox': true,
          'metadata.dropboxPath': dropboxPath,
        };
        if (uploadRes?.rev) {
          updateData['metadata.dropboxRev'] = uploadRes.rev;
        }
        if (uploadRes?.server_modified) {
          updateData['metadata.server_modified'] = uploadRes.server_modified;
        }

        await DocumentModel.updateOne(
          { _id: doc._id },
          { $set: updateData }
        );
        console.log(`[DropboxSync] ↑ "${doc.originalName}" → ${dropboxPath}`);
      } catch (err: any) {
        console.error(`[DropboxSync] outwardSync failed for doc ${String(doc._id)}:`, err?.message ?? err);
      }
    }
  }

  /**
   * Directly uploads an in-memory document (buffer or stream) to Dropbox for a project,
   * avoiding the redundant roundtrip download from Azure Blob Storage.
   */
  public async uploadDirectDocument(
    project: IDomainProject,
    docId: string,
    fileName: string,
    documentType: DocumentTypeTag,
    bufferOrStream: Buffer | NodeJS.ReadableStream,
    byteSize?: number
  ): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(project.id)) {
      console.warn(`[DropboxSync] uploadDirectDocument skipped — invalid project ID: ${project.id}`);
      return;
    }

    const ext = path.extname(fileName || '').toLowerCase();
    if (UNSUPPORTED_CAD_EXTENSIONS.has(ext)) {
      console.log(`[DropboxSync] Skipping direct upload of unsupported CAD/DWG file: "${fileName}"`);
      return;
    }

    try {
      const token = await this.getToken();
      const folderPath = await this.ensureProjectWorkspace(project, token);
      if (!folderPath) return;

      const subfolder = dropboxSubfolder(documentType);
      const dropboxPath = `${project.dropboxFolderPath}/${subfolder}/${fileName}`;

      const stream = Buffer.isBuffer(bufferOrStream) ? Readable.from(bufferOrStream) : bufferOrStream;
      const size = byteSize ?? (Buffer.isBuffer(bufferOrStream) ? bufferOrStream.length : 0);

      const uploadRes = await uploadDropboxFileByPath(dropboxPath, stream, size, token);

      const updateData: Record<string, any> = {
        'metadata.syncedToDropbox': true,
        'metadata.dropboxPath': dropboxPath,
      };
      if (uploadRes?.rev) {
        updateData['metadata.dropboxRev'] = uploadRes.rev;
      }
      if (uploadRes?.server_modified) {
        updateData['metadata.server_modified'] = uploadRes.server_modified;
      }

      await DocumentModel.updateOne(
        { _id: docId },
        { $set: updateData }
      );
      console.log(`[DropboxSync] Direct upload complete: "${fileName}" → ${dropboxPath}`);
    } catch (err: any) {
      console.error(`[DropboxSync] Direct upload failed for doc ${docId}:`, err?.message ?? err);
      // Fallback to regular outwardSync
      await this.outwardSync(project).catch(() => {});
    }
  }

  /**
   * Moves a document's physical file in Dropbox from the source project's folder to the target project's folder.
   * If the file does not exist in the source folder, it falls back to uploading it directly to the target project folder.
   */
  public async moveDocumentInDropbox(
    doc: IDocument,
    _sourceProject?: IDomainProject | null,
    targetProject?: IDomainProject | null
  ): Promise<string | null> {
    if (!targetProject) return null;
    if (isEmailBodyDocument(doc) || doc.isInternal) {
      // Internal email text documents are not synced to Dropbox
      return null;
    }

    const docExt = path.extname(doc.originalName || '').toLowerCase();
    if (UNSUPPORTED_CAD_EXTENSIONS.has(docExt)) {
      console.log(`[DropboxSync] Skipping move of unsupported CAD/DWG file: "${doc.originalName}"`);
      return null;
    }

    try {
      const token = await this.getToken();
      const targetFolderPath = await this.ensureProjectWorkspace(targetProject, token);
      if (!targetFolderPath) return null;

      const subfolder = dropboxSubfolder(doc.documentType as DocumentTypeTag);
      const targetDropboxPath = `${targetFolderPath}/${subfolder}/${doc.originalName}`;

      const currentDropboxPath = doc.metadata instanceof Map
        ? doc.metadata.get('dropboxPath')
        : (doc.metadata as any)?.dropboxPath;

      if (currentDropboxPath && currentDropboxPath !== targetDropboxPath) {
        const movedEntry = await moveDropboxFileByPath(currentDropboxPath, targetDropboxPath, token, true);
        if (movedEntry) {
          const finalPath = movedEntry.path_display || targetDropboxPath;
          await DocumentModel.updateOne(
            { _id: doc._id },
            { $set: { 'metadata.syncedToDropbox': true, 'metadata.dropboxPath': finalPath } }
          );
          console.log(`[DropboxSync] Moved in Dropbox: "${currentDropboxPath}" → "${finalPath}"`);
          return finalPath;
        }
      }

      // If move did not succeed because source file wasn't in Dropbox, upload fresh from Azure Blob Storage
      const signedUrl = await this.blobStorage.createSignedDownloadUrl(doc.storageKey, 30);
      const res = await axios.get(signedUrl, { responseType: 'stream' });
      const stream = res.data as NodeJS.ReadableStream;

      await uploadDropboxFileByPath(targetDropboxPath, stream, doc.byteSize, token);

      await DocumentModel.updateOne(
        { _id: doc._id },
        { $set: { 'metadata.syncedToDropbox': true, 'metadata.dropboxPath': targetDropboxPath } }
      );
      console.log(`[DropboxSync] Uploaded to target project Dropbox: "${doc.originalName}" → "${targetDropboxPath}"`);
      return targetDropboxPath;
    } catch (err: any) {
      console.error(`[DropboxSync] moveDocumentInDropbox failed for doc ${String(doc._id)}:`, err?.message ?? err);
      return null;
    }
  }

  /**
   * Moves multiple documents in Dropbox in sequence.
   */
  public async moveDocumentsInDropbox(
    docs: IDocument[],
    _sourceProject?: IDomainProject | null,
    targetProject?: IDomainProject | null
  ): Promise<void> {
    for (const doc of docs) {
      await this.moveDocumentInDropbox(doc, _sourceProject, targetProject);
    }
  }

  // ── Helper for importing a single Dropbox file ──────────────────────────

  private async importDropboxFile(
    file: DropboxEntry,
    project: IDomainProject,
    docType: DocumentTypeTag,
    token: string,
    activeDropboxPaths: Set<string>,
    newlyCreatedDocumentIds: string[]
  ): Promise<void> {
    const fileExt = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
    if (UNSUPPORTED_CAD_EXTENSIONS.has(fileExt)) {
      console.log(`[DropboxSync] Skipping unsupported CAD/DWG file from Dropbox: "${file.name}" (${file.path_display})`);
      return;
    }

    const dropboxPath = file.path_display;
    const projId = new mongoose.Types.ObjectId(project.id);

    // Check if it is a ZIP file
    if (file.name.toLowerCase().endsWith('.zip')) {
      // Look for any existing extracted documents from this zip file
      const existingExtracted = await DocumentModel.find({
        projectId: projId,
        'metadata.parentZipPath': dropboxPath,
      });

      if (existingExtracted.length > 0) {
        // Zip has already been processed. Add active ones to activeDropboxPaths to avoid soft-deletion.
        for (const doc of existingExtracted) {
          if (doc.isActive) {
            const innerPath = doc.metadata.get('dropboxPath');
            if (innerPath) {
              activeDropboxPaths.add(innerPath);
            }
          }
        }
        return;
      }

      // New zip file, download and recursively extract
      try {
        console.log(`[DropboxSync] Zip file detected. Extracting recursively: ${dropboxPath}`);
        const stream = await downloadDropboxFileByPath(dropboxPath, token);
        
        const extractZipEntry = async (entry: any, relativePath: string): Promise<void> => {
          const entryName = path.basename(entry.path);
          if (
            entry.type === 'Directory' ||
            entryName.startsWith('.') ||
            entry.path.includes('__MACOSX') ||
            entryName.toLowerCase() === 'thumbs.db'
          ) {
            entry.autodrain();
            return;
          }

          const entryExt = entryName.includes('.') ? `.${entryName.split('.').pop()!.toLowerCase()}` : '';
          if (UNSUPPORTED_CAD_EXTENSIONS.has(entryExt)) {
            console.log(`[DropboxSync] Skipping unsupported CAD/DWG entry inside zip: "${entryName}" in ${dropboxPath}`);
            entry.autodrain();
            return;
          }

          if (entryName.toLowerCase().endsWith('.zip')) {
            try {
              const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
              for await (const nestedEntry of nestedParser) {
                await extractZipEntry(nestedEntry, relativePath ? `${relativePath}/${entryName}` : entryName);
              }
            } catch (err: any) {
              console.error(`[DropboxSync] failed to extract nested zip ${entryName} in ${dropboxPath}:`, err.message);
            }
            return;
          }

          try {
            const entryExt = entryName.includes('.') ? `.${entryName.split('.').pop()!.toLowerCase()}` : '';
            const entryMimeType = mimeFromExt(entryExt);
            const isMedia = AUDIO_VIDEO_EXTENSIONS.has(entryExt) || entryMimeType.startsWith('audio/') || entryMimeType.startsWith('video/');

            const entryStorageKey = `projects/${project.id}/dropbox-inbound/${Date.now()}-${entryName}`;
            let stored: any;
            let tempZipFilePath: string | null = null;
            let summaryText = '';

            try {
              if (isMedia) {
                tempZipFilePath = path.join(os.tmpdir(), `gfs-zip-${Date.now()}-${entryName}`);
                // Stream zip entry directly to disk with ZERO RAM overhead
                await streamPipeline(entry, fsSync.createWriteStream(tempZipFilePath));

                stored = await this.blobStorage.putStream({
                  storageKey: entryStorageKey,
                  mimeType: entryMimeType,
                  stream: fsSync.createReadStream(tempZipFilePath),
                });
              } else {
                // Normal non-media file (PDF, drawings, txt)
                const entryBuffer = await streamToBuffer(entry);
                const entrySha256 = crypto.createHash('sha256').update(entryBuffer).digest('hex');
                stored = await this.blobStorage.putStream({
                  storageKey: entryStorageKey,
                  mimeType: entryMimeType,
                  stream: Readable.from(entryBuffer),
                });
                stored.sha256 = entrySha256;
                stored.byteSize = entryBuffer.length;
              }

              const docId = new mongoose.Types.ObjectId().toString();
              const innerDropboxPath = `${dropboxPath}/${relativePath ? relativePath + '/' : ''}${entry.path}`;

              await DocumentModel.create({
                _id: docId,
                projectId: projId,
                rootDocumentId: docId,
                version: 1,
                isLatest: true,
                isActive: true,
                isFinalInput: false,
                documentType: docType,
                status: 'PROCESSED',
                originalName: entryName,
                mimeType: entryMimeType,
                extension: entryExt,
                storageKey: stored.storageKey,
                blobUrl: stored.blobUrl,
                sha256: stored.sha256 || 'dropbox-sync-extracted',
                byteSize: stored.byteSize || 0,
                uploadedBy: 'dropbox',
                uploadedAt: new Date(),
                metadata: {
                  source: 'dropbox',
                  dropboxPath: innerDropboxPath,
                  parentZipPath: dropboxPath,
                  syncedToDropbox: true,
                },
              });

              newlyCreatedDocumentIds.push(docId);
              activeDropboxPaths.add(innerDropboxPath);
              console.log(`[DropboxSync] ↓ imported extracted file "${entryName}" from zip: ${dropboxPath}`);

              if (docType === DocumentTypeTag.TRANSCRIPT) {
                const textExtensions = ['.txt', '.vtt', '.srt'];
                if (textExtensions.includes(entryExt)) {
                  try {
                    const rawText = (await fs.readFile(tempZipFilePath || '')).toString('utf-8');
                    summaryText = cleanTranscriptText(rawText, entryExt);
                  } catch (err: any) {
                    console.error(`[DropboxSync] failed to read transcript text for CallRecord: ${err.message}`);
                  }
                } else if (isMedia && tempZipFilePath) {
                  try {
                    console.log(`[DropboxSync] Transcribing extracted media "${entryName}" from disk...`);
                    summaryText = await azureSpeechService.transcribeFile(tempZipFilePath, entryMimeType, entryName);
                    console.log(`[DropboxSync] Transcribed extracted media "${entryName}" (${summaryText.length} chars)`);

                    if (summaryText.trim()) {
                      const textBuffer = Buffer.from(summaryText, 'utf-8');
                      const textFileName = `${path.parse(entryName).name}-transcript.txt`;
                      const textStorageKey = `projects/${project.id}/dropbox-inbound/${Date.now()}-${textFileName}`;
                      const textStored = await this.blobStorage.putStream({
                        storageKey: textStorageKey,
                        mimeType: 'text/plain',
                        stream: Readable.from(textBuffer),
                      });
                      const textDocId = new mongoose.Types.ObjectId().toString();
                      await DocumentModel.create({
                        _id: textDocId,
                        projectId: projId,
                        rootDocumentId: textDocId,
                        version: 1,
                        isLatest: true,
                        isActive: true,
                        isFinalInput: false,
                        documentType: DocumentTypeTag.TRANSCRIPT,
                        status: 'PROCESSED',
                        originalName: textFileName,
                        mimeType: 'text/plain',
                        extension: '.txt',
                        storageKey: textStored.storageKey,
                        blobUrl: textStored.blobUrl,
                        sha256: crypto.createHash('sha256').update(textBuffer).digest('hex'),
                        byteSize: textBuffer.length,
                        uploadedBy: 'dropbox',
                        uploadedAt: new Date(),
                        metadata: { source: 'dropbox', generatedFrom: entryName, parentZipPath: dropboxPath },
                      });
                      newlyCreatedDocumentIds.push(textDocId);
                      console.log(`[DropboxSync] Registered companion transcript document "${textFileName}" (docId: ${textDocId})`);
                    }
                  } catch (speechErr: any) {
                    console.error(`[DropboxSync] Failed to transcribe extracted audio/video "${entryName}":`, speechErr?.message ?? speechErr);
                  }
                }

                await CallRecord.create({
                  projectId: projId,
                  callDate: new Date(),
                  customerName: project.customerName || 'Unknown Client',
                  summaryText,
                  transcriptFileUrl: stored.blobUrl,
                  transcriptFileName: entryName,
                  aiExtractionStatus: 'NOT_REQUESTED',
                  isActive: true,
                });
                console.log(`[DropboxSync] Created CallRecord for extracted transcript: "${entryName}"`);
              }
            } finally {
              if (tempZipFilePath) {
                await fs.rm(tempZipFilePath, { force: true }).catch(() => {});
              }
            }
          } catch (err: any) {
            entry.autodrain();
            console.error(`[DropboxSync] failed to import zip entry "${entryName}":`, err?.message ?? err);
          }
        };

        const zipParser = stream.pipe(unzipper.Parse({ forceStream: true }));
        for await (const entry of zipParser) {
          await extractZipEntry(entry, '');
        }
      } catch (err: any) {
        console.error(`[DropboxSync] Failed to process zip file "${file.name}":`, err?.message ?? err);
      }
      return;
    }

    // Normal non-ZIP file processing (existing code)
    const existing = await DocumentModel.findOne({
      $or: [
        { 'metadata.dropboxPath': { $in: [dropboxPath, file.path_lower] } },
        { projectId: { $in: [projId, project.id] }, originalName: file.name, isActive: true }
      ]
    });
    if (existing) {
      activeDropboxPaths.add(file.path_display);
      if (file.path_lower) activeDropboxPaths.add(file.path_lower);

      const existingRev = existing.metadata?.get ? existing.metadata.get('dropboxRev') : (existing.metadata as any)?.dropboxRev;

      // Fast-path: if Dropbox rev is recorded and matches, the file is 100% unchanged — skip download completely!
      if (file.rev && existingRev && file.rev === existingRev) {
        return;
      }

      try {
        const fileStream = await downloadDropboxFileByPath(dropboxPath, token);
        const fileBuffer = await streamToBuffer(fileStream);
        const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        // Check if file content is completely identical
        if (existing.sha256 && existing.sha256 === sha256) {
          const currentDropboxPath = existing.metadata?.get ? existing.metadata.get('dropboxPath') : (existing.metadata as any)?.dropboxPath;
          const updatedMeta: Record<string, any> = {};
          if (existing.metadata) {
            if (existing.metadata instanceof Map) {
              existing.metadata.forEach((v, k) => { updatedMeta[k] = v; });
            } else if (typeof existing.metadata === 'object') {
              Object.assign(updatedMeta, existing.metadata);
            }
          }
          
          let needsUpdate = false;
          if (!currentDropboxPath) {
            updatedMeta['dropboxPath'] = file.path_display;
            updatedMeta['syncedToDropbox'] = true;
            needsUpdate = true;
          }
          if (file.rev && updatedMeta['dropboxRev'] !== file.rev) {
            updatedMeta['dropboxRev'] = file.rev;
            needsUpdate = true;
          }
          if (file.server_modified && updatedMeta['server_modified'] !== file.server_modified) {
            updatedMeta['server_modified'] = file.server_modified;
            needsUpdate = true;
          }
          if (!updatedMeta['source'] || updatedMeta['source'] === 'manual') {
            updatedMeta['source'] = 'dropbox';
            needsUpdate = true;
          }

          if (needsUpdate) {
            await DocumentModel.updateOne(
              { _id: existing._id },
              { $set: { uploadedBy: 'dropbox', metadata: updatedMeta } }
            );
            console.log(`[DropboxSync] Linked/updated metadata for "${file.name}" (rev: ${file.rev || 'n/a'})`);
          }
          return;
        }

        // File has changed in Dropbox!
        console.log(`[DropboxSync] Detected MODIFIED file in Dropbox: "${file.name}" (Hash old: ${existing.sha256?.slice(0, 8)}... new: ${sha256.slice(0, 8)}...)`);
        const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
        const mimeType = mimeFromExt(ext);

        // Mark existing document as no longer latest
        await DocumentModel.updateOne({ _id: existing._id }, { $set: { isLatest: false } });

        const storageKey = `projects/${project.id}/dropbox-inbound/${Date.now()}-${file.name}`;
        const stored = await this.blobStorage.putStream({
          storageKey,
          mimeType,
          stream: Readable.from(fileBuffer),
        });

        const docId = new mongoose.Types.ObjectId().toString();
        const newDocVersion = (existing.version || 1) + 1;
        await DocumentModel.create({
          _id: docId,
          projectId: projId,
          rootDocumentId: String(existing.rootDocumentId || existing._id),
          version: newDocVersion,
          isLatest: true,
          isActive: true,
          isFinalInput: false,
          documentType: existing.documentType || docType,
          status: 'PROCESSED',
          originalName: file.name,
          mimeType,
          extension: ext,
          storageKey: stored.storageKey,
          blobUrl: stored.blobUrl,
          sha256,
          byteSize: fileBuffer.length,
          uploadedBy: 'dropbox',
          uploadedAt: new Date(),
          metadata: {
            source: 'dropbox',
            dropboxPath,
            syncedToDropbox: true,
            isRevision: true,
            previousDocumentId: String(existing._id),
            dropboxRev: file.rev,
            server_modified: file.server_modified,
          },
        });

        const isExcel = ext === '.xlsx' || ext === '.xls';
        if (isExcel) {
          try {
            const parsedData = await excelIngestionService.parseProposalExcel(fileBuffer);
            await this.proposalRepository.ensureProposalExists(project.id);
            const currentSchema = await this.proposalRepository.getCurrentSchema(project.id);
            const diffChanges = excelIngestionService.diffWithCurrentSchema(currentSchema, parsedData);

            if (diffChanges.length > 0) {
              if (this.pendingApprovalService) {
                const correlationId = `dropbox-excel:${project.id}:${docId}:${Date.now()}`;
                await this.pendingApprovalService.createPendingApproval({
                  projectId: project.id,
                  source: ChangeSource.DROPBOX,
                  sourceId: docId,
                  correlationId,
                  documentIds: [docId],
                  documentNames: [file.name],
                  detectedChanges: diffChanges,
                  newExtractedData: {
                    excelReingestion: true,
                    excelDocId: docId,
                    parsedData,
                  },
                  subject: `Excel Re-ingestion for ${project.referenceNumber} (${file.name})`,
                  sender: 'Dropbox',
                  messageId: correlationId,
                  aiReasoning: `Detected ${diffChanges.length} modified field(s) in updated Excel file "${file.name}". Review and approve to update the project proposal.`,
                  aiConfidence: 1.0,
                });
                console.log(`[DropboxSync] Created pending approval for modified Excel file "${file.name}" with ${diffChanges.length} change(s) on project ${project.id}`);
              }
            } else {
              console.log(`[DropboxSync] Excel file "${file.name}" updated in Dropbox, but no schema differences detected.`);
            }
            return;
          } catch (err: any) {
            console.warn(`[DropboxSync] Could not parse updated Excel file "${file.name}" for re-ingestion: ${err?.message ?? err}`);
          }
        }

        // Non-Excel or non-proposal modified file
        newlyCreatedDocumentIds.push(docId);
        return;
      } catch (err: any) {
        console.error(`[DropboxSync] failed checking/updating existing file "${file.name}":`, err?.message ?? err);
        return;
      }
    }

    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
    const mimeType = mimeFromExt(ext);
    const isMedia = AUDIO_VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith('audio/') || mimeType.startsWith('video/');

    if (isMedia) {
      const tempFilePath = path.join(os.tmpdir(), `gfs-sync-${Date.now()}-${file.name}`);
      try {
        const fileStream = await downloadDropboxFileByPath(dropboxPath, token);
        // Stream directly to temporary file on disk with ZERO RAM overhead
        await streamPipeline(fileStream, fsSync.createWriteStream(tempFilePath));

        const storageKey = `projects/${project.id}/dropbox-inbound/${Date.now()}-${file.name}`;
        // Stream from disk to Azure Blob Storage (4MB stream chunks)
        const stored = await this.blobStorage.putStream({
          storageKey,
          mimeType,
          stream: fsSync.createReadStream(tempFilePath),
        });

        const docId = new mongoose.Types.ObjectId().toString();
        await DocumentModel.create({
          _id: docId,
          projectId: projId,
          rootDocumentId: docId,
          version: 1,
          isLatest: true,
          isActive: true,
          isFinalInput: false,
          documentType: docType,
          status: 'PROCESSED',
          originalName: file.name,
          mimeType,
          extension: ext,
          storageKey: stored.storageKey,
          blobUrl: stored.blobUrl,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          uploadedBy: 'dropbox',
          uploadedAt: new Date(),
          metadata: { source: 'dropbox', dropboxPath, syncedToDropbox: true, dropboxRev: file.rev, server_modified: file.server_modified },
        });
        console.log(`[DropboxSync] ↓ imported streamed media "${file.name}" from ${dropboxPath}`);

        newlyCreatedDocumentIds.push(docId);

        if (docType === DocumentTypeTag.TRANSCRIPT) {
          let summaryText = '';
          try {
            console.log(`[DropboxSync] Transcribing media file "${file.name}" from disk...`);
            summaryText = await azureSpeechService.transcribeFile(tempFilePath, mimeType, file.name);
            console.log(`[DropboxSync] Transcribed media "${file.name}" (${summaryText.length} chars)`);

            if (summaryText.trim()) {
              const textBuffer = Buffer.from(summaryText, 'utf-8');
              const baseName = path.parse(file.name).name;
              const textFileName = `${baseName}-transcript.txt`;
              const textStorageKey = `projects/${project.id}/dropbox-inbound/${Date.now()}-${textFileName}`;
              const textStored = await this.blobStorage.putStream({
                storageKey: textStorageKey,
                mimeType: 'text/plain',
                stream: Readable.from(textBuffer),
              });
              const textDocId = new mongoose.Types.ObjectId().toString();
              await DocumentModel.create({
                _id: textDocId,
                projectId: projId,
                rootDocumentId: textDocId,
                version: 1,
                isLatest: true,
                isActive: true,
                isFinalInput: false,
                documentType: DocumentTypeTag.TRANSCRIPT,
                status: 'PROCESSED',
                originalName: textFileName,
                mimeType: 'text/plain',
                extension: '.txt',
                storageKey: textStored.storageKey,
                blobUrl: textStored.blobUrl,
                sha256: crypto.createHash('sha256').update(textBuffer).digest('hex'),
                byteSize: textBuffer.length,
                uploadedBy: 'dropbox',
                uploadedAt: new Date(),
                metadata: { source: 'dropbox', generatedFrom: file.name, dropboxPath },
              });
              newlyCreatedDocumentIds.push(textDocId);
              console.log(`[DropboxSync] Registered companion transcript document "${textFileName}" (docId: ${textDocId})`);
            }
          } catch (speechErr: any) {
            console.error(`[DropboxSync] Failed to transcribe media "${file.name}":`, speechErr?.message ?? speechErr);
          }

          await CallRecord.create({
            projectId: projId,
            callDate: file.client_modified ? new Date(file.client_modified) : new Date(),
            customerName: project.customerName || 'Unknown Client',
            summaryText,
            transcriptFileUrl: stored.blobUrl,
            transcriptFileName: file.name,
            aiExtractionStatus: 'NOT_REQUESTED',
            isActive: true,
          });
          console.log(`[DropboxSync] Created CallRecord for transcript: "${file.name}"`);
        }
      } catch (err: any) {
        console.error(`[DropboxSync] inwardSync failed for media "${file.name}":`, err?.message ?? err);
      } finally {
        await fs.rm(tempFilePath, { force: true }).catch(() => {});
      }
      return;
    }

    try {
      const fileStream = await downloadDropboxFileByPath(dropboxPath, token);
      const fileBuffer = await streamToBuffer(fileStream);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const storageKey = `projects/${project.id}/dropbox-inbound/${Date.now()}-${file.name}`;
      const stored = await this.blobStorage.putStream({
        storageKey,
        mimeType,
        stream: Readable.from(fileBuffer),
      });

      const docId = new mongoose.Types.ObjectId().toString();
      await DocumentModel.create({
        _id: docId,
        projectId: projId,
        rootDocumentId: docId,
        version: 1,
        isLatest: true,
        isActive: true,
        isFinalInput: false,
        documentType: docType,
        status: 'PROCESSED',
        originalName: file.name,
        mimeType,
        extension: ext,
        storageKey: stored.storageKey,
        blobUrl: stored.blobUrl,
        sha256,
        byteSize: fileBuffer.length,
        uploadedBy: 'dropbox',
        uploadedAt: new Date(),
        metadata: { source: 'dropbox', dropboxPath, syncedToDropbox: true, dropboxRev: file.rev, server_modified: file.server_modified },
      });
      console.log(`[DropboxSync] ↓ imported "${file.name}" from ${dropboxPath}`);

      const isExcel = ext === '.xlsx' || ext === '.xls';
      if (isExcel) {
        try {
          const parsedData = await excelIngestionService.parseProposalExcel(fileBuffer);
          await this.proposalRepository.ensureProposalExists(project.id);
          const currentSchema = await this.proposalRepository.getCurrentSchema(project.id);
          const diffChanges = excelIngestionService.diffWithCurrentSchema(currentSchema, parsedData);

          if (diffChanges.length > 0 && this.pendingApprovalService) {
            const correlationId = `dropbox-excel:${project.id}:${docId}:${Date.now()}`;
            await this.pendingApprovalService.createPendingApproval({
              projectId: project.id,
              source: ChangeSource.DROPBOX,
              sourceId: docId,
              correlationId,
              documentIds: [docId],
              documentNames: [file.name],
              detectedChanges: diffChanges,
              newExtractedData: {
                excelReingestion: true,
                excelDocId: docId,
                parsedData,
              },
              subject: `Excel Ingestion for ${project.referenceNumber} (${file.name})`,
              sender: 'Dropbox',
              messageId: correlationId,
              aiReasoning: `Detected ${diffChanges.length} field(s) from Excel workbook "${file.name}". Review and approve to update the project proposal.`,
              aiConfidence: 1.0,
            });
            console.log(`[DropboxSync] Created pending approval for new Excel file "${file.name}" with ${diffChanges.length} change(s) on project ${project.id}`);
            const assignedEstimatorIds = (project.assignedEstimators ?? []).map(
              (e: any) => (typeof e === 'string' ? e : e?.id ?? e?._id?.toString())
            ).filter(Boolean);
            await notificationService.notifyDocumentAdded({
              projectId: project.id,
              referenceNumber: project.referenceNumber,
              projectName: project.projectName,
              fileNames: [file.name],
              estimatorIds: assignedEstimatorIds,
              source: 'dropbox',
            });
            return;
          }
        } catch (excelErr: any) {
          console.log(`[DropboxSync] Excel file "${file.name}" is not a proposal workbook (${excelErr?.message}), continuing standard ingestion.`);
        }
      }

      newlyCreatedDocumentIds.push(docId);

      if (docType === DocumentTypeTag.TRANSCRIPT) {
        // Also create a CallRecord so it shows up in the Call Records tab
        let summaryText = '';
        const textExtensions = ['.txt', '.vtt', '.srt'];
        if (textExtensions.includes(ext)) {
          try {
            const rawText = fileBuffer.toString('utf-8');
            summaryText = cleanTranscriptText(rawText, ext);
          } catch (err: any) {
            console.error(`[DropboxSync] failed to read transcript text for CallRecord: ${err.message}`);
          }
        }

        await CallRecord.create({
          projectId: projId,
          callDate: file.client_modified ? new Date(file.client_modified) : new Date(),
          customerName: project.customerName || 'Unknown Client',
          summaryText,
          transcriptFileUrl: stored.blobUrl,
          transcriptFileName: file.name,
          aiExtractionStatus: 'NOT_REQUESTED',
          isActive: true,
        });
        console.log(`[DropboxSync] Created CallRecord for transcript: "${file.name}"`);
      }
    } catch (err: any) {
      console.error(`[DropboxSync] inwardSync failed for "${file.name}":`, err?.message ?? err);
    }
  }

  // ── Inward Sync (Dropbox → GFS) ──────────────────────────────────────────

  private async syncFolderRecursively(
    folderPath: string,
    project: IDomainProject,
    docType: DocumentTypeTag,
    token: string,
    activeDropboxPaths: Set<string>,
    newlyCreatedDocumentIds: string[]
  ): Promise<void> {
    let entries: DropboxEntry[];
    try {
      entries = await listDropboxPath(folderPath, token);
    } catch (err: any) {
      console.error(`[DropboxSync] listDropboxPath failed for recursive sync at ${folderPath}:`, err?.message ?? err);
      return;
    }

    for (const entry of entries) {
      if (entry['.tag'] === 'file') {
        activeDropboxPaths.add(entry.path_display);
        await this.importDropboxFile(entry, project, docType, token, activeDropboxPaths, newlyCreatedDocumentIds);
      } else if (entry['.tag'] === 'folder') {
        await this.syncFolderRecursively(entry.path_display, project, docType, token, activeDropboxPaths, newlyCreatedDocumentIds);
      }
    }
  }

  public async inwardSync(project: IDomainProject): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(project.id)) {
      console.warn(`[DropboxSync] inwardSync skipped — invalid project ID: ${project.id}`);
      return;
    }

    const token = await this.getToken();
    project.dropboxFolderPath = await this.resolveDropboxFolder(project, token);
    const activeDropboxPaths = new Set<string>();
    const newlyCreatedDocumentIds: string[] = [];

    let topLevel: DropboxEntry[];
    try {
      topLevel = await listDropboxPath(project.dropboxFolderPath, token);
    } catch (err: any) {
      console.error(`[DropboxSync] listDropboxPath failed for ${project.dropboxFolderPath}:`, err?.message ?? err);
      return;
    }

    for (const entry of topLevel) {
      if (entry['.tag'] === 'file') {
        activeDropboxPaths.add(entry.path_display);
        if (entry.path_lower) activeDropboxPaths.add(entry.path_lower);
        await this.importDropboxFile(entry, project, DocumentTypeTag.OTHER, token, activeDropboxPaths, newlyCreatedDocumentIds);
      } else if (entry['.tag'] === 'folder') {
        const docType = gfsDocumentType(entry.name);
        await this.syncFolderRecursively(entry.path_display, project, docType, token, activeDropboxPaths, newlyCreatedDocumentIds);
      }
    }

    // 2. Deletion Sync (Dropbox -> GFS): Check for active GFS docs synced to Dropbox that are no longer there
    try {
      const projId = new mongoose.Types.ObjectId(project.id);

      const syncedDocs = await DocumentModel.find({
        projectId: { $in: [projId, project.id] },
        isActive: true,
        'metadata.dropboxPath': { $exists: true, $ne: null },
      });

      for (const doc of syncedDocs) {
        // Protect non-Dropbox documents: do NOT delete documents uploaded via Outlook, email, or RFQ
        const docMeta = doc.metadata as any;
        if (
          docMeta?.source === 'outlook' ||
          docMeta?.source === 'email' ||
          (doc as any).source === 'customer_rfq' ||
          (doc as any).source === 'outlook' ||
          !docMeta?.dropboxPath
        ) {
          continue;
        }

        const path = doc.metadata.get ? doc.metadata.get('dropboxPath') : (doc.metadata as any)?.dropboxPath;
        const isPathActive = path && (activeDropboxPaths.has(path) || activeDropboxPaths.has(path.toLowerCase()));
        if (path && !isPathActive) {
          await DocumentModel.updateOne(
            { _id: doc._id },
            { $set: { isActive: false, deletedAt: new Date(), deletedBy: 'dropbox-sync-inbound' } }
          );
          console.log(`[DropboxSync] Deleted from GFS: "${doc.originalName}" (removed in Dropbox)`);

          // Also delete the corresponding CallRecord if this is a transcript document
          if (doc.documentType === DocumentTypeTag.TRANSCRIPT) {
            try {
              await CallRecord.updateOne(
                { projectId: doc.projectId, transcriptFileName: doc.originalName, isActive: true },
                { $set: { isActive: false } }
              );
              console.log(`[DropboxSync] Deleted CallRecord for transcript: "${doc.originalName}"`);
            } catch (err: any) {
              console.error(`[DropboxSync] failed to delete CallRecord for "${doc.originalName}":`, err.message);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[DropboxSync] inward deletion sync failed for project ${project.id}:`, err?.message ?? err);
    }

    // 3. Create pending approval for whatever new documents this sync pass brought in.
    // Only the IDs collected above — never a re-fetch of every active document on the
    // project — so a later sync (with nothing new) doesn't reprocess everything again.
    if (newlyCreatedDocumentIds.length > 0) {
      try {
        const documentNames = await DocumentModel.find({
          _id: { $in: newlyCreatedDocumentIds }
        }).select('originalName').lean().then(docs => docs.map(d => d.originalName));

        const assignedEstimatorIds = (project.assignedEstimators ?? []).map(
          (e: any) => (typeof e === 'string' ? e : e?.id ?? e?._id?.toString())
        ).filter(Boolean);

        await notificationService.notifyDocumentAdded({
          projectId: project.id,
          referenceNumber: project.referenceNumber,
          projectName: project.projectName,
          fileNames: documentNames.length > 0 ? documentNames : ['Dropbox file'],
          estimatorIds: assignedEstimatorIds,
          source: 'dropbox',
        });
      } catch (notifyErr: any) {
        console.error(`[DropboxSync] Failed to emit document added notification for project ${project.id}:`, notifyErr?.message ?? notifyErr);
      }

      try {
        if (this.pendingApprovalService) {
          const correlationId = `dropbox:${project.id}:${Date.now()}`;
          const alreadyProcessed = await this.pendingApprovalService.isSourceProcessed(
            correlationId,
            ChangeSource.DROPBOX
          );
          
          if (!alreadyProcessed) {
            // Get document names
            const documentNames = await DocumentModel.find({
              _id: { $in: newlyCreatedDocumentIds }
            }).select('originalName').lean().then(docs => docs.map(d => d.originalName));
            
            await this.pendingApprovalService.createPendingApproval({
              projectId: project.id,
              source: ChangeSource.DROPBOX,
              sourceId: correlationId,
              correlationId,
              documentIds: newlyCreatedDocumentIds,
              documentNames: documentNames.length > 0 ? documentNames : ['Dropbox file'],
              newExtractedData: {}, // Will be extracted after approval
              subject: `Dropbox sync for ${project.referenceNumber}`,
              sender: 'Dropbox',
              messageId: correlationId,
            });
            
            console.log(`[DropboxSync] Created pending approval for ${newlyCreatedDocumentIds.length} document(s) from Dropbox sync on project ${project.id}`);
          }
        } else {
          // Fallback to old automatic behavior if service not available
          console.warn(`[DropboxSync] Pending approval service not available, falling back to automatic extraction`);
          const { proposalService } = await import('../proposal/proposal.router.js');
          await proposalService.triggerStage0Extraction(project.id, newlyCreatedDocumentIds, {
            correlationId: `dropbox:${project.id}:${Date.now()}`,
          });
        }
      } catch (err: any) {
        console.error(`[DropboxSync] Failed to create pending approval for project ${project.id}:`, err?.message ?? err);
        // Fallback to automatic extraction on error
        try {
          const { proposalService } = await import('../proposal/proposal.router.js');
          await proposalService.triggerStage0Extraction(project.id, newlyCreatedDocumentIds, {
            correlationId: `dropbox:${project.id}:${Date.now()}`,
          });
        } catch (fallbackErr: any) {
          console.error(`[DropboxSync] Fallback extraction also failed for project ${project.id}:`, fallbackErr?.message ?? fallbackErr);
        }
      }
    }
  }

  // ── Full bi-directional sync ──────────────────────────────────────────────

  public async syncProject(projectId: string): Promise<void> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) throw new Error(`[DropboxSync] project ${projectId} not found`);
    console.log(`[DropboxSync] syncing ${project.referenceNumber} (${projectId})`);

    try {
      await this.outwardSync(project);
    } catch (err: any) {
      console.error(`[DropboxSync] outwardSync error for ${project.referenceNumber}:`, err?.message ?? err);
    }

    try {
      await this.inwardSync(project);
    } catch (err: any) {
      console.error(`[DropboxSync] inwardSync error for ${project.referenceNumber}:`, err?.message ?? err);
    }

    console.log(`[DropboxSync] sync complete for ${project.referenceNumber}`);
  }

  // ── Background Poller ────────────────────────────────────────────────────

  public startPoller(intervalMs = env.dropbox.syncIntervalMs): void {
    if (!env.dropbox.pollingEnabled) {
      console.log('[DropboxSync] poller disabled (set DROPBOX_POLLING_ENABLED=true to enable)');
      return;
    }
    if (this.isPollerRunning || this.pollerTimeout) return;
    console.log(`[DropboxSync] poller started — interval ${intervalMs / 60000} min`);

    const run = async () => {
      this.isPollerRunning = true;
      try {
        const projectStream = this.projectRepository.listActiveCursor
          ? this.projectRepository.listActiveCursor()
          : await this.projectRepository.listActive();

        for await (const project of projectStream) {
          if (!project.dropboxFolderPath) continue;
          try {
            await this.outwardSync(project);
            await this.inwardSync(project);
          } catch (err: any) {
            console.error(`[DropboxSync] poller error for ${project.id}:`, err?.message ?? err);
          }
        }
      } catch (err: any) {
        console.error('[DropboxSync] poller tick failed:', err?.message ?? err);
      } finally {
        this.isPollerRunning = false;
        // Schedule next run recursively
        this.pollerTimeout = setTimeout(run, intervalMs);
        if (this.pollerTimeout.unref) this.pollerTimeout.unref();
      }
    };

    // Schedule first run recursively
    this.pollerTimeout = setTimeout(run, intervalMs);
    if (this.pollerTimeout.unref) this.pollerTimeout.unref();
  }

  public stopPoller(): void {
    if (this.pollerTimeout) {
      clearTimeout(this.pollerTimeout);
      this.pollerTimeout = null;
    }
    this.isPollerRunning = false;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
export const dropboxSyncService = new DropboxSyncService();
