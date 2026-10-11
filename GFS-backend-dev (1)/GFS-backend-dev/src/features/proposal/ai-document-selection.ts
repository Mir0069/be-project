import { DocumentTypeTag } from '@db/models/document.model';

/**
 * Which project documents a Stage 0 extraction may hand to the AI.
 *
 * Proposals GFS generated are output, not input, and the AI pipeline cannot
 * read spreadsheets at all: an extraction whose only new file is an .xlsx
 * stops with "no processable documents" and never reports back, leaving the
 * project stuck at PROCESSING.
 */

/** Spreadsheet formats the AI pipeline skips. */
const SPREADSHEET_EXTENSION = /\.(xlsx|xlsm|xls|csv)$/i;

export type AiDocumentExclusion = 'proposal' | 'spreadsheet';

export interface AiDocumentCandidate {
  documentType?: string | null;
  originalName?: string | null;
}

/**
 * `listed` sends only the documents the caller named, so an approval can never
 * pull in files from other, unapproved sources. `listed-or-all` falls back to
 * every active document when none are named or found (manual re-runs).
 */
export type ExtractionDocumentScope = 'listed' | 'listed-or-all';

/** Why a document must not reach the AI, or null when it may be sent. */
export const aiDocumentExclusion = (doc: AiDocumentCandidate): AiDocumentExclusion | null => {
  if (doc.documentType === DocumentTypeTag.QUOTE) return 'proposal';
  if (SPREADSHEET_EXTENSION.test(doc.originalName ?? '')) return 'spreadsheet';
  return null;
};

/** Splits documents into those the AI may read and those kept back, with the reason. */
export const partitionAiDocuments = <T extends AiDocumentCandidate>(documents: readonly T[]): {
  sendable: T[];
  excluded: Array<{ document: T; reason: AiDocumentExclusion }>;
} => {
  const sendable: T[] = [];
  const excluded: Array<{ document: T; reason: AiDocumentExclusion }> = [];
  for (const document of documents) {
    const reason = aiDocumentExclusion(document);
    if (reason) excluded.push({ document, reason });
    else sendable.push(document);
  }
  return { sendable, excluded };
};
