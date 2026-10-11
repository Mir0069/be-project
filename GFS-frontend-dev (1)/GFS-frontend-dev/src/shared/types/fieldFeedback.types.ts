export const FIELD_FEEDBACK_REASONS = [
  "AI_READ_IT_WRONG",
  "WRONG_SOURCE",
  "CLIENT_CHANGED_SPEC",
  "COMPANY_STANDARD",
  "OTHER",
] as const;

export type FieldFeedbackReason = (typeof FIELD_FEEDBACK_REASONS)[number];

export const FIELD_FEEDBACK_LABELS: Record<FieldFeedbackReason, string> = {
  AI_READ_IT_WRONG: "AI read it wrong",
  WRONG_SOURCE: "Taken from the wrong document or page",
  CLIENT_CHANGED_SPEC: "Client changed the spec",
  COMPANY_STANDARD: "Our standard overrides the document",
  OTHER: "Other",
};

export interface FieldFeedbackInput {
  reasonCode: FieldFeedbackReason;
  note?: string;
  changedColumns?: string[];
}

/** One field (or takeoff row) the estimator changed, awaiting an optional reason. */
export interface FieldFeedbackRequest {
  key: string;
  label: string;
  previousValue: unknown;
  newValue: unknown;
  changedColumns?: string[];
}

export type FieldFeedbackAnswers = Record<string, FieldFeedbackInput | null>;

/** Feedback is only asked for when the AI actually produced a value. */
export const hasPreviousValue = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "";
