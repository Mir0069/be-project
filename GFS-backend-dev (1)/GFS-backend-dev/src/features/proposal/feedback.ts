import {
  MAX_FEEDBACK_PER_FIELD,
  type FieldFeedbackReason,
  type IFieldFeedbackEntry,
} from '@db/models/proposal.model';

export interface FieldPatchFeedback {
  reasonCode: FieldFeedbackReason;
  note?: string;
  changedColumns?: string[];
}

export interface PatchAuthor {
  source: 'AI' | 'ESTIMATOR';
  updatedBy: string;
  authorRole?: string;
}

export interface FeedbackContext {
  previousValue: unknown;
  newValue: unknown;
  aiReasoning?: string[] | null;
  aiConfidence?: string | null;
  author: PatchAuthor;
  stage: number;
  changedColumns?: string[];
}

/** Feedback is only collected for values the AI actually produced. */
export const hadPreviousValue = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== '';

/**
 * Coerce an AI confidence into the feedback string field. Numbers pass
 * through as strings (0.94 stays "0.94", never 94x off); anything else
 * becomes null so a bad payload can't poison the export.
 */
export const toFeedbackConfidence = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  return null;
};

export const buildFeedbackEntry = (
  feedback: FieldPatchFeedback,
  context: FeedbackContext,
): IFieldFeedbackEntry => ({
  reason_code: feedback.reasonCode,
  note: feedback.note?.trim() || null,
  previous_value: context.previousValue ?? null,
  new_value: context.newValue ?? null,
  ai_reasoning: context.aiReasoning?.length ? [...context.aiReasoning] : null,
  ai_confidence: context.aiConfidence ?? null,
  author_id: context.author.updatedBy,
  author_role: context.author.authorRole ?? 'UNKNOWN',
  stage: context.stage,
  created_at: new Date().toISOString(),
  ...(context.changedColumns ? { changed_columns: context.changedColumns } : {}),
});

export const appendFeedback = (
  target: { _feedback?: IFieldFeedbackEntry[] },
  entry: IFieldFeedbackEntry,
): void => {
  const entries = Array.isArray(target._feedback) ? target._feedback : [];
  entries.push(entry);
  target._feedback = entries.slice(-MAX_FEEDBACK_PER_FIELD);
};

export const capEntries = (entries: IFieldFeedbackEntry[]): IFieldFeedbackEntry[] =>
  entries.slice(-MAX_FEEDBACK_PER_FIELD);

/**
 * Drop feedback from a version snapshot.
 *
 * Snapshots deep-copy the whole stage subtree on every write, so leaving
 * feedback in would duplicate it into every later version and grow the document
 * without bound. The live schema stays authoritative.
 */
export const stripFeedback = (node: unknown): void => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(stripFeedback);
    return;
  }
  const record = node as Record<string, unknown>;
  delete record['_feedback'];
  delete record['cost_feedback'];
  Object.values(record).forEach(stripFeedback);
};
