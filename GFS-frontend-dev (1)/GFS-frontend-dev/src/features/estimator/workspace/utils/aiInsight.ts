/** Identifies the serialized empty values returned by the AI for attachments. */
export const isEmptyAttachmentValue = (value: string): boolean =>
  /^(?:\[\s*(?:(?:['"])\s*){0,2}\]|null|undefined|none|n\/a|no attachments?)[.!]?$/i.test(
    value.trim(),
  );

export type ExtractedStageField = {
  value?: unknown;
  reasoning?: unknown;
  confidence?: unknown;
  extracted_confidence?: unknown;
};

const isExtractedStageField = (value: unknown): value is ExtractedStageField =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  ("value" in (value as Record<string, unknown>) ||
    "reasoning" in (value as Record<string, unknown>) ||
    "confidence" in (value as Record<string, unknown>) ||
    "extracted_confidence" in (value as Record<string, unknown>));

const isMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

// Staff assignments are set in GFS, not read from the customer's correspondence.
const STAFF_FIELD_KEYS = new Set(["person_quoting", "person_checked"]);

// The AI's summary of the Zoho notes; AI Insight shows it as one Reasoning point.
const ZOHO_SUMMARY_KEY = "crm_note_summary";

const isInsightField = (key: string, field: unknown): field is ExtractedStageField =>
  key !== "_signals" &&
  key !== "reasoning" &&
  key !== ZOHO_SUMMARY_KEY &&
  !STAFF_FIELD_KEYS.has(key) &&
  isExtractedStageField(field);

// Meeting-transcript leftovers: "00:00:08.000 --> 00:00:16.000", a WEBVTT header, a cut-off "[truncated]".
const TRANSCRIPT_NOISE = /^(?:WEBVTT\b|\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*-->)|\[truncated\]/i;

/** True for a reasoning line that is transcript markup rather than a point worth reading. */
export const isTranscriptNoise = (line: string): boolean => TRANSCRIPT_NOISE.test(line.trim());

/** The AI's summary of the project's Zoho notes, or "" when there is none. */
export const getZohoNoteSummary = (fields?: Record<string, unknown> | null): string => {
  const field = fields?.[ZOHO_SUMMARY_KEY];
  if (!isExtractedStageField(field) || typeof field.value !== "string") return "";
  return field.value.trim();
};

const humanizeFieldName = (key: string): string =>
  key
    .replace(/^stage_1\./i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * Stage 0 re-trigger results are persisted in the proposal schema. Build a
 * readable summary from those fields when the source email has no `proposed`
 * object (which is common for a re-triggered existing project).
 */
export const buildStageExtractionSummary = (
  fields?: Record<string, unknown> | null,
): string => {
  if (!fields) return "";

  return Object.entries(fields)
    .filter((entry): entry is [string, ExtractedStageField] => isInsightField(entry[0], entry[1]))
    .map(([key, field]) => {
      const value = field.value;
      if (!isMeaningfulValue(value)) return "";
      const rendered = typeof value === "string" ? value.trim() : JSON.stringify(value);
      return rendered ? `${humanizeFieldName(key)}: ${rendered}` : "";
    })
    .filter(Boolean)
    .join("\n");
};

/** Returns stage-level and field-level AI reasoning for a re-trigger result. */
export const getStageExtractionReasoning = (
  fields?: Record<string, unknown> | null,
): unknown[] => {
  if (!fields) return [];

  const reasons: unknown[] = [];
  if (fields.reasoning) reasons.push(fields.reasoning);

  for (const [key, field] of Object.entries(fields)) {
    if (!isInsightField(key, field)) continue;
    if (field.reasoning) reasons.push(field.reasoning);
  }

  return reasons;
};
