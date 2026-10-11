import { useEffect, useState } from "react";
import {
  FIELD_FEEDBACK_LABELS,
  FIELD_FEEDBACK_REASONS,
  type FieldFeedbackInput,
  type FieldFeedbackReason,
  type FieldFeedbackRequest,
} from "@/shared/types/fieldFeedback.types";

interface FieldFeedbackModalProps {
  open: boolean;
  request: FieldFeedbackRequest | null;
  position?: { index: number; total: number };
  onSkip: () => void;
  onSave: (feedback: FieldFeedbackInput) => void;
}

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const PHONE_FIELD_KEY = "stage_1.contact_phone";
const PROJECT_TYPE_FIELD_KEY = "stage_1.project_type";

const PROJECT_TYPE_LABELS: Record<string, string> = {
  RESIDENTIAL: "RESIDENTIAL",
  COMMERCIAL: "COMMERCIAL",
};

const splitPhoneValue = (value: unknown): { countryCode: string; nationalNumber: string } => {
  const text = value == null ? "" : String(value).trim();
  const match = /^(\+\d+(?:-\d+)?)\s*(.*)$/.exec(text);
  return {
    countryCode: match?.[1] ?? "",
    nationalNumber: match?.[2] ?? text,
  };
};

const displayFeedbackValue = (
  request: FieldFeedbackRequest,
  value: unknown,
): string => {
  if (request.key === PROJECT_TYPE_FIELD_KEY) {
    const text = displayValue(value);
    return PROJECT_TYPE_LABELS[text.trim().toUpperCase()] ?? text;
  }

  if (request.key !== PHONE_FIELD_KEY) return displayValue(value);

  const previousPhone = splitPhoneValue(request.previousValue);
  const newPhone = splitPhoneValue(request.newValue);
  const countryCodeChanged = previousPhone.countryCode !== newPhone.countryCode;

  // Phone-number-only edits are easier to compare without the country code.
  // Keep the complete values when the country itself changed so that review
  // clearly shows both the old and new country codes.
  return countryCodeChanged ? displayValue(value) : displayValue(splitPhoneValue(value).nationalNumber);
};

export const FieldFeedbackModal = ({
  open,
  request,
  position,
  onSkip,
  onSave,
}: FieldFeedbackModalProps) => {
  const [reasonCode, setReasonCode] = useState<FieldFeedbackReason | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setReasonCode("");
    setNote("");
  }, [request?.key]);

  if (!open || !request) return null;

  const handleSave = () => {
    if (!reasonCode) return;
    onSave({
      reasonCode,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(request.changedColumns ? { changedColumns: request.changedColumns } : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onSkip}
      role="dialog"
      aria-modal="true"
      aria-label="Why are you changing this value?"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900">
            Why are you changing this value?
          </h3>
          {position && position.total > 1 && (
            <span className="mt-1 shrink-0 text-xs text-gray-400">
              {position.index} of {position.total}
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-gray-500">
          This feedback helps the AI learn. It is optional, and your change is saved either way.
        </p>

        <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
          <p className="font-semibold text-gray-800">{request.label}</p>
          {request.changedColumns?.length ? (
            <p className="mt-1 text-xs text-gray-500">
              Changed: {request.changedColumns.join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-gray-600">
              <span className="line-through">{displayFeedbackValue(request, request.previousValue)}</span>
              <span className="mx-2 text-gray-400">to</span>
              <span className="font-medium text-gray-900">{displayFeedbackValue(request, request.newValue)}</span>
            </p>
          )}
        </div>

        <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="feedback-reason">
          Reason
        </label>
        <select
          id="feedback-reason"
          autoFocus
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as FieldFeedbackReason)}
          className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm text-gray-800 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
        >
          <option value="">Select a reason</option>
          {FIELD_FEEDBACK_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {FIELD_FEEDBACK_LABELS[reason]}
            </option>
          ))}
        </select>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Anything else worth knowing (optional)"
          aria-label="Additional note"
          className="mt-3 w-full resize-none rounded-md border border-gray-300 p-3 text-sm text-gray-800 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
        />

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!reasonCode}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
