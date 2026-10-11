

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

export interface IDocumentIngestionPort {
  upload(ctx: DocIngestAuthContext, input: DocIngestInput): Promise<void>;
  /**
   * Re-points every document this channel produced at `targetProjectId` and
   * relocates it in Dropbox, the same way move-to-project does. Returns how many
   * moved; documents already on the target are left alone, so calling this when
   * nothing changed is a no-op. Optional so older port implementations still
   * satisfy the interface.
   */
  moveChannelDocuments?(channelId: string, targetProjectId: string): Promise<number>;
}


export class LoggingDocumentIngestionPort implements IDocumentIngestionPort {
  public async upload(_ctx: DocIngestAuthContext, input: DocIngestInput): Promise<void> {
    console.log(
      `[teams→doc-pipeline] would ingest project=${input.projectId} ` +
        `name="${input.file.originalName}" type=${input.documentType} ` +
        `mime=${input.file.mimeType} bytes=${input.file.buffer.length}`,
    );
  }

  public async moveChannelDocuments(
    channelId: string,
    targetProjectId: string,
  ): Promise<number> {
    console.log(
      `[teams→doc-pipeline] would move documents of channel=${channelId} ` +
        `to project=${targetProjectId}`,
    );
    return 0;
  }
}
