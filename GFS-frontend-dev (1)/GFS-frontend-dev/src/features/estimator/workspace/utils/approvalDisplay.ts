import type { ApiDocument } from "@/services/documents";
import type { PendingApproval } from "@/services/proposals";
import type { OutlookEmail } from "@/shared/types/email.types";
import { getDocumentDisplayLabel } from "@/shared/lib/documentLabel";

// Backend placeholders written when an approval has no real file behind it.
const PLACEHOLDER_NAMES = ["email body text", "email attachment", "dropbox file"];

export interface ApprovalDocumentEntry {
  /** Present only when the file resolves to a live project document, which is what makes it openable. */
  id?: string;
  name: string;
}

const isDisplayableName = (name?: string | null): boolean => {
  const trimmed = name?.trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_NAMES.includes(trimmed.toLowerCase())) return false;
  // An empty label means documentLabel classified the name as a generated storage
  // or mail id (email-AAMk....txt), which is noise for an estimator.
  return getDocumentDisplayLabel(trimmed, "") !== "";
};

/**
 * Resolves an approval's documents to real, openable files.
 *
 * Ids are matched against the loaded project documents rather than zipped with
 * documentNames by index: the backend builds documentNames from a $in query whose
 * result order does not follow the id order.
 */
export const resolveApprovalDocuments = (
  approval: Pick<PendingApproval, "documentIds" | "documentNames">,
  documents: Pick<ApiDocument, "id" | "originalName">[],
): ApprovalDocumentEntry[] => {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const resolved: ApprovalDocumentEntry[] = [];
  const unresolvedIds: string[] = [];

  for (const documentId of approval.documentIds ?? []) {
    const doc = byId.get(documentId);
    if (!doc) {
      unresolvedIds.push(documentId);
      continue;
    }
    if (isDisplayableName(doc.originalName)) {
      resolved.push({ id: doc.id, name: doc.originalName });
    }
  }

  // Sales managers never load the project documents, and moved files can leave the
  // list. Fall back to the names captured on the approval, without a preview link.
  if (resolved.length === 0 && (unresolvedIds.length > 0 || (approval.documentIds ?? []).length === 0)) {
    for (const name of approval.documentNames ?? []) {
      if (isDisplayableName(name)) resolved.push({ name });
    }
  }

  return resolved;
};

/** Finds the email a mail approval was raised from, so its body can be shown inline. */
export const findApprovalEmail = (
  approval: Pick<PendingApproval, "sourceId" | "messageId">,
  emails: OutlookEmail[],
): OutlookEmail | undefined => {
  const bySourceId = approval.sourceId
    ? emails.find((email) => email.id === approval.sourceId)
    : undefined;
  if (bySourceId) return bySourceId;

  return approval.messageId
    ? emails.find((email) => email.internetMessageId === approval.messageId)
    : undefined;
};
