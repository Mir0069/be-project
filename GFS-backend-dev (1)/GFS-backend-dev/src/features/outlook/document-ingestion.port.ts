export type DocumentTypeTag = 'drawing' | 'spec' | 'transcript' | 'quote' | 'photo' | 'other';

export interface DocIngestAuthContext {
  userId: string;
  roles?: string[];
}

export interface DocIngestFile {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface DocIngestInput {
  projectId: string;
  file: DocIngestFile;
  uploadedBy: string;
  documentType: DocumentTypeTag;
  metadata?: Record<string, string | number | boolean | null>;
}

// ----- Unified email package (Outlook → document-ingestion) -----
// Outlook stages every attachment to blob and mints a SAS URL, then hands the
// whole email across in ONE call as a lightweight (no buffers) bundle. The
// document-ingestion side fires a single AI-queue message with full context.
// Agreed interface — attachments carry SAS URLs, not raw bytes.

export interface EmailPackageAttachment {
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string; // blob key (Outlook staged it)
  downloadUrl: string; // SAS URL (Outlook minted it)
}

export interface IEmailPackageBundle {
  correlationId: string; // outlookEmail:<_id> — for AI result mapping
  messageId: string;
  conversationId?: string | null; // threading
  sender: string;
  to: string[];
  subject: string;
  bodyText: string;
  receivedDateTime: string;
  attachments: EmailPackageAttachment[];
}

export interface IDocumentIngestionPort {
  upload(ctx: DocIngestAuthContext, input: DocIngestInput): Promise<void>;
  ingestEmailPackage(bundle: IEmailPackageBundle): Promise<void>;
}

export class LoggingDocumentIngestionPort implements IDocumentIngestionPort {
  public async upload(_ctx: DocIngestAuthContext, input: DocIngestInput): Promise<void> {
    console.log(
      `[outlook→doc-pipeline] would ingest project=${input.projectId} ` +
        `name="${input.file.originalName}" type=${input.documentType} ` +
        `mime=${input.file.mimeType} bytes=${input.file.buffer.length}`,
    );
  }

  public async ingestEmailPackage(bundle: IEmailPackageBundle): Promise<void> {
    console.log(
      `[outlook→doc-pipeline] email package ${bundle.correlationId} ` +
        `from=${bundle.sender} subject="${bundle.subject}" ` +
        `attachments=${bundle.attachments.length} (SAS URLs)`,
    );
  }
}
