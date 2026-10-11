import { useState } from "react";
import { Loader2 } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useUnapproveProposalStage } from "@/features/projects/query/proposalsQuery";

interface ReviseStageModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  stage: number;
  stageName?: string;
  onRevised?: () => void | Promise<unknown>;
  onRevisionStateChange?: (inProgress: boolean) => void;
}

export const ReviseStageModal = ({
  open,
  onClose,
  projectId,
  stage,
  stageName,
  onRevised,
  onRevisionStateChange,
}: ReviseStageModalProps) => {
  const { mutateAsync: unapproveStageAsync, isPending: isUnapproving } =
    useUnapproveProposalStage();
  const [reason, setReason] = useState("");

  if (!open) return null;

  const handleSubmit = async () => {
    onRevisionStateChange?.(true);
    try {
      await unapproveStageAsync({
        projectId,
        stage,
        reason: reason.trim() ? reason.trim() : undefined,
      });
      showToast("success", "Stage is now editable.");
      await onRevised?.();
      onClose();
    } catch (error: any) {
      showToast("error", error?.message || "Failed to revise stage.");
    } finally {
      onRevisionStateChange?.(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Revise Stage"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900">
          Revise Stage{stageName ? ` — ${stageName}` : ` ${stage}`}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Reopens this stage for editing. Downstream stages will be locked until this
          stage is re-approved.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Reason for revising (optional)"
          className="mt-4 w-full resize-none rounded-md border border-gray-300 p-3 text-sm text-gray-800 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
        />
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isUnapproving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isUnapproving}
            className="inline-flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUnapproving && <Loader2 size={14} className="animate-spin" />}
            Revise Stage
          </button>
        </div>
      </div>
    </div>
  );
};
