import type { ApiDocument } from "@/services/documents";

// Maps a document's freeform metadata.source or uploadedBy to a display badge.
export type DocumentSourceKey = "teams" | "outlook" | "dropbox" | "manual";

interface BadgeMeta {
  label: string;
  className: string;
}

export const DOCUMENT_SOURCE_META: Record<DocumentSourceKey, BadgeMeta> = {
  teams: { label: "Teams", className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  outlook: { label: "Mail", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  dropbox: { label: "Dropbox", className: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  manual: { label: "Manual", className: "bg-gray-100 text-gray-600 ring-gray-200" },
};

export const getDocumentSourceKey = (
  doc?: Partial<Pick<ApiDocument, "metadata" | "uploadedBy">> | null
): DocumentSourceKey => {
  const raw = doc?.metadata?.source?.toString().toLowerCase();
  const uBy = doc?.uploadedBy?.toString().toLowerCase();
  if (raw === "dropbox" || uBy === "dropbox" || uBy === "dropbox-sync") return "dropbox";
  if (raw === "teams" || (raw === "cloud-link" && doc?.metadata?.teamsMessageId)) return "teams";
  if (raw === "outlook" || raw === "mail" || (raw === "cloud-link" && doc?.metadata?.emailId)) return "outlook";
  return "manual";
};

export const getDocumentSource = (
  doc?: Partial<Pick<ApiDocument, "metadata" | "uploadedBy">> | null
): BadgeMeta => DOCUMENT_SOURCE_META[getDocumentSourceKey(doc)];
