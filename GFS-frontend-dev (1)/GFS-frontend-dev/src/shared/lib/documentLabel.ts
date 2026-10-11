const GENERATED_NAME_PATTERNS = [
  /^email[-_]/i,
  /^aamk[a-z0-9+/=_-]{24,}/i,
  /^[a-f0-9]{24}$/i,
];

const getFileName = (value: string): string => {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const segments = withoutQuery.split(/[\\/]/);
  return segments[segments.length - 1]?.trim() || value.trim();
};

export interface DocumentDisplayCandidate {
  originalName?: string | null;
  fileName?: string | null;
  name?: string | null;
  isDeleted?: boolean | null;
}

/**
 * Email body notes are ingestion artifacts, not user attachments. They are
 * kept in storage for the extraction pipeline but should not be presented as
 * downloadable project files.
 */
export const isInternalEmailDocumentName = (value?: string | null): boolean => {
  if (!value?.trim()) return false;

  const fileName = getFileName(value).toLowerCase();
  return fileName === "email body text" || /^email[-_].*\.txt$/i.test(fileName);
};

/** Returns active, human-visible project documents without duplicate labels. */
export const getVisibleProjectDocuments = <T extends DocumentDisplayCandidate>(
  documents: readonly T[] = [],
): T[] => {
  const seen = new Set<string>();

  return documents.filter((document) => {
    if (document.isDeleted) return false;

    const name = document.originalName ?? document.fileName ?? document.name ?? "";
    const fileName = getFileName(name);
    if (!fileName || isInternalEmailDocumentName(fileName)) return false;

    const key = fileName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Keeps human-readable document names while hiding generated storage or mail IDs
 * that are not useful to estimators. This changes display text only.
 */
export const getDocumentDisplayLabel = (
  value?: string | null,
  fallback = "Attachment",
): string => {
  if (!value?.trim()) return fallback;

  const fileName = getFileName(value);
  const compactName = fileName.replace(/\s+/g, "");
  const hasLongToken = /[a-z0-9+/=_-]{48,}/i.test(compactName);

  if (
    GENERATED_NAME_PATTERNS.some((pattern) => pattern.test(compactName)) ||
    hasLongToken
  ) {
    return fallback;
  }

  return fileName;
};
