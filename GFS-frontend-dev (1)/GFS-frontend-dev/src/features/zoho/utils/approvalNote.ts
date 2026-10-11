import type { ZohoNote } from "@/shared/types/zoho.types";

// The backend quotes only the first 300 characters of the note in a Zoho approval:
// `Latest note by <author>: "<start of note>...[truncated]"`.
const NOTE_QUOTE_PATTERN = /Latest note by .*?: "([\s\S]*?)(?:\.\.\.\[truncated\])?"\s*$/;
// The same text starts `Zoho was updated. Description: "..."` when the description changed.
const DESCRIPTION_PATTERN = /^Zoho was updated\.\s+Description: "/;
const NOTE_PATTERN = /Latest note by .*?: "/;

const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

/** Heading for a Zoho approval's text, naming what Zoho sent: the note, the description, or both. */
export const getZohoApprovalHeading = (reasoning: string | null | undefined): string => {
  const text = reasoning?.trim() ?? "";
  const hasDescription = DESCRIPTION_PATTERN.test(text);
  if (hasDescription && NOTE_PATTERN.test(text)) return "Zoho description and note";
  return hasDescription ? "Zoho description" : "Zoho note";
};

/** The Zoho note a re-trigger approval quotes, found by the start of its text. */
export const findApprovalNote = (
  reasoning: string | null | undefined,
  notes: ZohoNote[] | undefined,
): ZohoNote | null => {
  const quoted = reasoning?.match(NOTE_QUOTE_PATTERN)?.[1];
  if (!quoted || !notes?.length) return null;

  const start = normalize(quoted);
  if (!start) return null;
  return notes.find((note) => note.content && normalize(note.content).startsWith(start)) ?? null;
};
