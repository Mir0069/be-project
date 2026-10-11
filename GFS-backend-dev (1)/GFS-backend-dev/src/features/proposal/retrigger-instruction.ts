import type { IProjectActiveRetrigger } from '@db/models/project.model';

/**
 * The approved text behind an extraction that is still running. The AI's
 * result arrives later on a separate request, so the text is kept on the
 * project for that request to check what the estimator actually approved.
 */

/** Approval sources whose change is written text the estimator read before approving. */
const TEXT_RETRIGGER_SOURCES = new Set(['ZOHO', 'TEAMS', 'EMAIL']);

/** An AI result later than this is not treated as the answer to the approval. */
export const ACTIVE_RETRIGGER_TTL_MS = 2 * 60 * 60 * 1000;

export type ActiveRetrigger = IProjectActiveRetrigger;

interface RetriggerContextText {
  changeSummary?: string | null;
  zohoNotes?: Array<{ content?: string | null }>;
}

/** The approved text for a text-driven retrigger, or null for document-driven runs. */
export const buildActiveRetrigger = (
  origin: string | null | undefined,
  correlationId: string,
  context: RetriggerContextText,
  now: Date = new Date(),
): ActiveRetrigger | null => {
  if (!origin || !TEXT_RETRIGGER_SOURCES.has(origin)) return null;
  const parts = [
    context.changeSummary ?? '',
    ...(origin === 'ZOHO' ? (context.zohoNotes ?? []).map((note) => note.content ?? '') : []),
  ];
  const instruction = parts.map((part) => part.trim()).filter(Boolean).join('\n');
  return instruction ? { correlationId, source: origin, instruction, startedAt: now } : null;
};

/** The instruction still covering an incoming AI result, or null once it has expired. */
export const liveRetriggerInstruction = (
  active: ActiveRetrigger | null | undefined,
  now: Date = new Date(),
): string | null => {
  if (!active?.instruction || !active.startedAt) return null;
  const age = now.getTime() - new Date(active.startedAt).getTime();
  return age >= 0 && age <= ACTIVE_RETRIGGER_TTL_MS ? active.instruction : null;
};
