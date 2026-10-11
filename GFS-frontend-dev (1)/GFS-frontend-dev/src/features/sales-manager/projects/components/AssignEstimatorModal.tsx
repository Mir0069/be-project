import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Loader2, RefreshCw, Search, X } from "lucide-react";

import { useUpdateProjectEstimators } from "@/features/projects/query/projectsQuery";
import { useEstimators } from "@/features/sales-manager/create-project/query/show-estimator.query";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectIds?: string[];
};

const AssignEstimatorModal = ({ open, onClose, projectId, projectName, projectIds }: Props) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assignedEstimatorName, setAssignedEstimatorName] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState("");

  const { data: estimators = [], isLoading, isError, refetch } = useEstimators();
  const assignmentMutation = useUpdateProjectEstimators();
  const resetAssignment = assignmentMutation.reset;

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setSearch("");
    setAssignedEstimatorName(null);
    setAssignmentError("");
    resetAssignment();
  }, [open, projectId, resetAssignment]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !assignmentMutation.isPending) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, assignmentMutation.isPending]);

  const activeEstimators = useMemo(
    () => estimators.filter((estimator) => estimator.status?.toLowerCase() !== "inactive"),
    [estimators],
  );

  const visibleEstimators = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activeEstimators;

    return activeEstimators.filter((estimator) =>
      `${estimator.name} ${estimator.email}`.toLowerCase().includes(term),
    );
  }, [activeEstimators, search]);

  if (!open) return null;

  const handleConfirm = () => {
    const selectedEstimator = activeEstimators.find((estimator) => estimator.id === selectedId);
    if (!selectedEstimator) return;

    setAssignmentError("");
    const ids = Array.from(new Set(projectIds?.length ? projectIds : [projectId]));
    if (ids.length === 1) {
      assignmentMutation.mutate(
        { id: ids[0]!, estimatorIds: [selectedEstimator.id] },
        {
          onSuccess: () => setAssignedEstimatorName(selectedEstimator.name),
          onError: () => setAssignmentError("Could not assign the estimator. Please try again."),
        },
      );
      return;
    }

    // Competitive approvals create one linked project per bidder. Assigning the
    // same estimator here keeps the bid group operationally consistent.
    Promise.all(ids.map((id) => assignmentMutation.mutateAsync({
      id,
      estimatorIds: [selectedEstimator.id],
    })))
      .then(() => setAssignedEstimatorName(selectedEstimator.name))
      .catch(() => setAssignmentError(
        "Could not assign the estimator to every bidder project. Please try again.",
      ));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-estimator-title"
        className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={assignmentMutation.isPending}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X size={18} />
        </button>

        {assignedEstimatorName ? (
          <div className="p-6">
            <div className="flex items-start gap-3 pr-8">
              <CheckCircle2 size={24} className="mt-0.5 shrink-0 text-green-600" />
              <div>
                <h3 id="assign-estimator-title" className="text-lg font-semibold text-gray-900">
                  Estimator assigned
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  <span className="font-medium text-gray-900">{assignedEstimatorName}</span> is now
                  assigned to {projectName}{projectIds && projectIds.length > 1 ? ` and its ${projectIds.length - 1} related bids` : ""}.
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
              <h3 id="assign-estimator-title" className="text-lg font-semibold text-gray-900">
                Assign Estimator
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Choose who will prepare the estimate for this project.
              </p>
              <p className="mt-3 flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 size={16} className="shrink-0" />
                Project created successfully: <span className="truncate font-medium">{projectName}</span>
              </p>
            </header>

            <div className="min-h-0 flex-1 px-6 py-5">
              <label htmlFor="estimator-search" className="text-sm font-medium text-gray-800">
                Estimator
              </label>
              <div className="relative mt-2">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  id="estimator-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or email"
                  className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
                />
              </div>

              <div
                role="listbox"
                aria-label="Available estimators"
                className="mt-3 max-h-60 overflow-y-auto rounded-md border border-gray-200"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-500">
                    <Loader2 size={16} className="animate-spin text-red-500" />
                    Loading estimators...
                  </div>
                ) : isError ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-600">Estimators could not be loaded.</p>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      <RefreshCw size={14} /> Retry
                    </button>
                  </div>
                ) : visibleEstimators.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-gray-500">
                    {search ? "No estimators match your search." : "No active estimators are available."}
                  </p>
                ) : (
                  visibleEstimators.map((estimator) => {
                    const selected = selectedId === estimator.id;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        key={estimator.id}
                        onClick={() => {
                          setSelectedId(estimator.id);
                          setAssignmentError("");
                        }}
                        className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 ${
                          selected ? "bg-red-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {estimator.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-gray-500">
                            {estimator.email}
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

              {assignmentError ? (
                <p role="alert" className="mt-3 text-sm text-red-600">
                  {assignmentError}
                </p>
              ) : null}
            </div>

            <footer className="flex justify-end gap-2 border-t border-gray-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={assignmentMutation.isPending}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50"
              >
                Assign Later
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedId || assignmentMutation.isPending}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assignmentMutation.isPending ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Assigning...
                  </>
                ) : (
                  "Assign Estimator"
                )}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
};

export default AssignEstimatorModal;
