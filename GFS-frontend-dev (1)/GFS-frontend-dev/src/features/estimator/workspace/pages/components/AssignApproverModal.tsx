import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Loader2, RefreshCw, Search, X } from "lucide-react";

import {
  useStage7EligibleApprovers,
  useAssignStage7Approver,
} from "@/features/projects/query/proposalsQuery";
import type { EligibleApprover } from "@/services/proposals";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  currentApproverId?: string | null;
  currentApproverName?: string | null;
  onAssigned?: (approver: EligibleApprover) => void;
};

const AssignApproverModal = ({
  open,
  onClose,
  projectId,
  currentApproverId,
  currentApproverName,
  onAssigned,
}: Props) => {
  // The parent mounts this modal only while it is open, so every open starts
  // from fresh state. Don't re-sync from currentApproverId in an effect: a
  // successful assignment refetches the workflow, which changes
  // currentApproverId and would wipe the success view (and reset the mutation
  // before its onSuccess fires), forcing a second "Assign Approver" click.
  const [selectedId, setSelectedId] = useState<string | null>(currentApproverId ?? null);
  const [search, setSearch] = useState("");
  const [assignedApproverName, setAssignedApproverName] = useState<string | null>(null);

  const {
    data: approvers = [],
    isLoading,
    isError,
    refetch,
  } = useStage7EligibleApprovers(open ? projectId : undefined);
  const assignMutation = useAssignStage7Approver();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !assignMutation.isPending) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, assignMutation.isPending]);

  const visibleApprovers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return approvers;

    return approvers.filter((approver) =>
      `${approver.name} ${approver.email}`.toLowerCase().includes(term),
    );
  }, [approvers, search]);

  const selectedApprover = useMemo(
    () => approvers.find((approver) => approver.id === selectedId),
    [approvers, selectedId],
  );

  if (!open) return null;

  const handleConfirm = () => {
    if (!selectedApprover) return;

    assignMutation.mutate(
      { projectId, approverId: selectedApprover.id },
      {
        onSuccess: () => {
          setAssignedApproverName(selectedApprover.name);
          onAssigned?.(selectedApprover);
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-approver-title"
        className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={assignMutation.isPending}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X size={18} />
        </button>

        {assignedApproverName ? (
          <div className="p-6">
            <div className="flex items-start gap-3 pr-8">
              <CheckCircle2 size={24} className="mt-0.5 shrink-0 text-green-600" />
              <div>
                <h3 id="assign-approver-title" className="text-lg font-semibold text-gray-900">
                  Approver assigned
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  <span className="font-medium text-gray-900">{assignedApproverName}</span> has
                  been notified and asked to review and approve this proposal.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="border-b border-gray-200 px-6 py-5 pr-14">
              <h3 id="assign-approver-title" className="text-lg font-semibold text-gray-900">
                {currentApproverId ? "Reassign Approver" : "Assign Approver"}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Choose the Sales Manager who will review and approve the final pricing before it
                can be downloaded.
              </p>
              {currentApproverName ? (
                <p className="mt-3 text-sm text-gray-500">
                  Currently assigned to <span className="font-medium text-gray-800">{currentApproverName}</span>.
                </p>
              ) : null}
            </header>

            <div className="min-h-0 flex-1 px-6 py-5">
              <label htmlFor="approver-search" className="text-sm font-medium text-gray-800">
                Sales Manager
              </label>
              <div className="relative mt-2">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  id="approver-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or email"
                  className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </div>

              <div
                role="listbox"
                aria-label="Eligible approvers"
                className="mt-3 max-h-60 overflow-y-auto rounded-md border border-gray-200"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-500">
                    <Loader2 size={16} className="animate-spin text-red-500" />
                    Loading eligible approvers...
                  </div>
                ) : isError ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-600">Approvers could not be loaded.</p>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      <RefreshCw size={14} /> Retry
                    </button>
                  </div>
                ) : visibleApprovers.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-gray-500">
                    {search
                      ? "No approvers match your search."
                      : "No Sales Managers are eligible to approve this proposal at its current price."}
                  </p>
                ) : (
                  visibleApprovers.map((approver) => {
                    const selected = selectedId === approver.id;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-pressed={selected}
                        key={approver.id}
                        onPointerDown={(event) => {
                          // Commit pointer selection on the first press so the
                          // row cannot feel like it needs a second click when
                          // the modal is opening or the list is re-rendering.
                          if (event.button === 0) setSelectedId(approver.id);
                        }}
                        onClick={() => setSelectedId(approver.id)}
                        className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 ${
                          selected ? "bg-red-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {approver.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-gray-500">
                            {approver.email}
                          </span>
                        </span>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            selected ? "border-red-600 bg-red-600 text-white" : "border-gray-300"
                          }`}
                          aria-hidden="true"
                        >
                          {selected ? <Check size={13} strokeWidth={3} /> : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedApprover ? (
                <div
                  aria-live="polite"
                  className="mt-3 flex items-center gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span className="min-w-0 truncate">
                    Selected: <span className="font-semibold">{selectedApprover.name}</span>
                    <span className="ml-1 text-red-600">({selectedApprover.email})</span>
                  </span>
                </div>
              ) : null}
            </div>

            <footer className="flex justify-end gap-2 border-t border-gray-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={assignMutation.isPending}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedId || assignMutation.isPending}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assignMutation.isPending ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Assigning...
                  </>
                ) : (
                  "Assign Approver"
                )}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
};

export default AssignApproverModal;
