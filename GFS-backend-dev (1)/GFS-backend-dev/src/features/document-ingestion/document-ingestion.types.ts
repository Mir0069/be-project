export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'STAGING' | 'DELETED';

export type DocumentTypeTag = 'drawing' | 'spec' | 'transcript' | 'quote' | 'photo' | 'other';

export interface AuthContext {
  userId: string;
  tenantId?: string;
  roles?: string[];
}

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  buffer?: Buffer;
  path?: string;
  size?: number;
}

export interface IngestDocumentInput {
  projectId: string;
  file: UploadedFile;
  uploadedBy: string;
  documentType: DocumentTypeTag;
  markAsFinalInput?: boolean;
  replaceDocumentId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface IEmailPackageBundle {
  correlationId: string;          // outlookEmail:<_id>
  messageId: string;
  conversationId?: string | null;
  sender: string;
  to: string[];
  subject: string;
  bodyText: string;
  receivedDateTime: string;
  attachments: {
    originalName: string;
    mimeType: string;
    size: number;
    storageKey: string;           // blob key (Outlook staged it)
    downloadUrl: string;          // SAS URL (Outlook minted it)
  }[];
}

export interface StoredBlob {
  storageKey: string;
  blobUrl: string;
  sha256: string;
  byteSize: number;
}

export interface DocumentRecord {
  id: string;
  projectId: string | null;
  rootDocumentId: string;
  previousVersionId?: string;
  version: number;
  isLatest: boolean;
  isDeleted: boolean;
  isFinalInput: boolean;
  isInternal?: boolean;
  documentType: DocumentTypeTag;
  status: DocumentStatus;
  originalName: string;
  mimeType: string;
  extension: string;
  storageKey: string;
  blobUrl: string;
  sha256: string;
  byteSize: number;
  uploadedBy: string;
  uploadedAt: Date;
  updatedAt: Date;
  processedAt?: Date;
  deletedAt?: Date;
  deletedBy?: string;
  errorMessage?: string;
  metadata: Record<string, string | number | boolean | null>;
  parentArchiveId?: string;
  // Document deduplication fields
  contentHash?: string | null;
  contentHashCachedAt?: Date | null;
  cachedAiResultRef?: string | null;
}

type DocumentMetadata = Record<string, string | number | boolean | null> | Map<string, unknown>;

/**
 * Email bodies are staged as tiny text documents so the AI pipeline can read
 * them. They are internal processing inputs, not customer-provided files.
 *
 * The explicit metadata marker covers new records. The filename and metadata
 * fallback keeps older records out of the UI and Dropbox without a migration.
 */
export const isEmailBodyDocument = (document: {
  originalName?: string | null;
  mimeType?: string | null;
  metadata?: DocumentMetadata | null;
}): boolean => {
  const metadata = document.metadata instanceof Map
    ? Object.fromEntries(document.metadata)
    : document.metadata ?? {};
  const kind = String(metadata['kind'] ?? '').toLowerCase();

  if (kind === 'email-body' || kind === 'email_body' || kind === 'emailbody') {
    return true;
  }

  const originalName = String(document.originalName ?? '');
  const mimeType = String(document.mimeType ?? '').toLowerCase();
  const source = String(metadata['source'] ?? '').toLowerCase();
  const hasEmailMetadata = Boolean(metadata['messageId'] || metadata['emailId']);

  return mimeType === 'text/plain'
    && /^email-[^/\\]+\.txt$/i.test(originalName)
    && (hasEmailMetadata || source === 'outlook' || source === 'mail');
};

export interface DocumentRepository {
  create(record: DocumentRecord): Promise<DocumentRecord>;
  update(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord>;
  findById(id: string): Promise<DocumentRecord | null>;
  findByContentHash(contentHash: string): Promise<DocumentRecord | null>;
  findLatestByRoot(projectId: string, rootDocumentId: string): Promise<DocumentRecord | null>;
  listDeletedBefore(cutoff: Date): Promise<DocumentRecord[]>;
  deletePermanently(id: string): Promise<void>;
  listByProject(projectId: string, includeDeleted?: boolean): Promise<DocumentRecord[]>;
  listByTeamsChannelIds(channelIds: string[], includeDeleted?: boolean): Promise<DocumentRecord[]>;
  listByProjectAndParentMessageId(projectId: string, parentMessageId: string): Promise<DocumentRecord[]>;
  // Teams docs shared in specific messages (matched by metadata.messageId) — used
  // to attach a channel chat message's files to the AI payload.
  listByTeamsMessageIds(messageIds: string[]): Promise<DocumentRecord[]>;
  // The staged transcript document for a meeting (matched by metadata.transcriptId).
  listByTeamsTranscriptId(transcriptId: string): Promise<DocumentRecord[]>;
  markPriorVersionsNotLatest(projectId: string, rootDocumentId: string, exceptId: string): Promise<void>;
}

/** Resolves the Teams channel ids a project is linked to, so a shared channel's
 *  documents surface in every linked project's Documents list. */
export type LinkedChannelResolver = (projectId: string) => Promise<string[]>;

export interface BlobStorage {
  put(input: { projectId: string; sha256: string; originalName: string; mimeType: string; buffer: Buffer; }): Promise<StoredBlob>;
  putStream(input: { storageKey: string; mimeType: string; stream: NodeJS.ReadableStream; }): Promise<StoredBlob>;
  delete(storageKey: string): Promise<void>;
  // `inline` overrides the blob's stored content-disposition so the browser
  // renders the file (preview) instead of downloading it.
  createSignedDownloadUrl(
    storageKey: string,
    expiresInMinutes: number,
    options?: { inline?: boolean; fileName?: string },
  ): Promise<string>;
  download(storageKey: string, originalName?: string, blobUrl?: string): Promise<{
    stream: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
    contentDisposition?: string;
  }>;
}


export interface PermissionService {
  assertCanUpload(ctx: AuthContext, projectId: string): Promise<void>;
  assertCanDelete(ctx: AuthContext, document: DocumentRecord): Promise<void>;
  assertCanDownload(ctx: AuthContext, document: DocumentRecord): Promise<void>;
  assertCanUpdate(ctx: AuthContext, document: DocumentRecord): Promise<void>;
}

export interface AuditLogger {
  log(event: { action: string; actorId: string; projectId?: string | null; documentId?: string; details?: Record<string, unknown>; }): Promise<void>;
}
export interface ZipExtractor {
  extract(file: UploadedFile): Promise<UploadedFile[]>;
}
