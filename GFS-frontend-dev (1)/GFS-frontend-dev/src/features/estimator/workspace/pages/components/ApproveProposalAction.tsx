import { CheckCircle2, Loader2 } from "lucide-react";

import { useApproveProposalLead } from "@/features/projects/query/proposalsQuery";
import type { ProposalLeadApproval } from "@/services/proposals";

export const APPROVE_TOOLTIP =
  'Approval requires Sales Manager approval and a final output action. It changes the Zoho lead status to "Quoted need to follow up".';
export const APPROVE_MARKED_LINE = 'Proposal approved; Zoho lead marked "Quoted need to follow up".';
export const APPROVE_NO_DRAFT_HINT = "Generate and open or download the final proposal to enable approval.";

interface Props {
  projectId: string;
  approval: ProposalLeadApproval | undefined;
  hasDraft: boolean;
  canSend?: boolean;
  sendReason?: string | null;
}

/**
 * Approve action for the proposal, which marks the customer's Zoho lead as quoted.
 *
 * Once the lead is at that status the button is gone for good: a second click
 * would be a no-op, so it is replaced by a line stating what happened.
 */
export const ApproveProposalAction = ({ projectId, approval, hasDraft, canSend, sendReason }: Props) => {
  const approve = useApproveProposalLead();
  const state = approval?.state;

  if (!state || state === "NO_LEAD") return null;

  if (state === "ALREADY_MARKED") {
    return (
      <p className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-1.5 text-[11px] text-gray-600">
        <CheckCircle2 size={13} className="text-green-600 shrink-0 mt-px" />
        {APPROVE_MARKED_LINE}
      </p>
    );
  }

  if (state === "CLOSED") {
    return (
      <p className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-500">
        Zoho lead is "{approval?.lead_status}" — status not changed.
      </p>
    );
  }

  const readyToSend = canSend ?? hasDraft;
  const disabled = !readyToSend || approve.isPending;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {/* title sits on the wrapper: a disabled button never fires its own tooltip. */}
      <span className="block" title={APPROVE_TOOLTIP}>
        <button
          type="button"
          aria-describedby="approve-lead-warning"
          disabled={disabled}
          onClick={() => approve.mutate({ projectId })}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:border-red-500 hover:text-white hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:text-gray-700 disabled:hover:bg-transparent"
        >
          {approve.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          Approve
        </button>
      </span>
      <span id="approve-lead-warning" className="sr-only">
        {APPROVE_TOOLTIP}
      </span>
      {!readyToSend && (
        <p className="text-[10px] text-gray-500 mt-1.5">{sendReason ?? APPROVE_NO_DRAFT_HINT}</p>
      )}
    </div>
  );
};
