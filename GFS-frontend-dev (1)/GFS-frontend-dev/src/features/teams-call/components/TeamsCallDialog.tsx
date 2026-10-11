import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, Video, X } from "lucide-react";
import { useCallDirectory, useEstimatorDirectory } from "@/features/teams-call/query/teamsCallQuery";
import {
  MAX_CALLEES,
  buildCallGroups,
  buildTeamsCallLink,
  canListEstimators,
  filterCallGroups,
  type AssignedPerson,
  type CallContact,
} from "@/features/teams-call/utils/teamsCall";

interface TeamsCallDialogProps {
  assigned: readonly AssignedPerson[];
  selfId?: string;
  callerRole?: string | null;
  onClose: () => void;
}

export const TeamsCallDialog = ({ assigned, selfId, callerRole, onClose }: TeamsCallDialogProps) => {
  const salesManagers = useCallDirectory();
  const estimators = useEstimatorDirectory(canListEstimators(callerRole));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CallContact[]>([]);

  const isLoading = salesManagers.isLoading || estimators.isLoading;
  const isError = salesManagers.isError || estimators.isError;
  const directory = useMemo(
    () => [...(salesManagers.data ?? []), ...(estimators.data ?? [])],
    [salesManagers.data, estimators.data],
  );

  const groups = useMemo(
    () => buildCallGroups(assigned, directory, selfId),
    [assigned, directory, selfId],
  );
  const visibleGroups = useMemo(() => filterCallGroups(groups, query), [groups, query]);
  const selectedIds = useMemo(() => new Set(selected.map((c) => c.id)), [selected]);
  const atLimit = selected.length >= MAX_CALLEES;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggle = (contact: CallContact) =>
    setSelected((prev) => {
      if (prev.some((c) => c.id === contact.id)) return prev.filter((c) => c.id !== contact.id);
      return prev.length < MAX_CALLEES ? [...prev, contact] : prev;
    });

  // Keep synchronous: an await before window.open lets pop-up blockers swallow it.
  const startCall = () => {
    window.open(buildTeamsCallLink(selected.map((c) => c.email)), "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ animation: "modalBackdropFade 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
    >
      <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teams-call-title"
        className="relative z-10 w-full max-w-lg max-h-[80vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        style={{ animation: "modalDialogSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 border border-red-100 flex items-center justify-center shrink-0">
              <Video size={18} />
            </div>
            <div>
              <h2 id="teams-call-title" className="text-base font-bold text-slate-900">
                Start Instant meeting
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-4 pb-3 space-y-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search people"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-red-500/20 focus:border-red-500 placeholder:text-slate-400"
            />
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((contact) => (
                <span
                  key={contact.id}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full"
                >
                  {contact.name}
                  <button
                    type="button"
                    onClick={() => toggle(contact)}
                    aria-label={`Remove ${contact.name}`}
                    className="p-0.5 rounded-full hover:bg-red-100 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {atLimit && (
            <p className="text-xs text-amber-700">
              Teams group calls are limited to {MAX_CALLEES + 1} people, including you.
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3 overscroll-contain">
          {visibleGroups.map((group) => (
            <section key={group.key} className="mb-3" aria-label={group.label}>
              <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1">
                {group.label}
              </h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {group.contacts.map((contact) => {
                  const isSelected = selectedIds.has(contact.id);
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      disabled={!isSelected && atLimit}
                      onClick={() => toggle(contact)}
                      className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-red-50/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          isSelected ? "bg-red-600 border-red-600 text-white" : "border-slate-300"
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900 truncate">{contact.name}</span>
                        <span className="block text-xs text-slate-500 truncate">{contact.email}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {isLoading && (
            <p className="flex items-center gap-2 text-xs text-slate-400 py-2">
              <Loader2 size={14} className="animate-spin text-red-500" /> Loading people...
            </p>
          )}
          {isError && (
            <p className="text-xs text-red-600 py-2">
              Couldn't load the full list. You can still call people on this project.
            </p>
          )}
          {!isLoading && visibleGroups.length === 0 && (
            <p className="text-xs text-slate-400 py-6 text-center">
              {query.trim() ? `No one matches "${query.trim()}".` : "No one available to call."}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-500 leading-snug">
            Invitees need a Microsoft Teams account linked to their listed email address.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={startCall}
              disabled={selected.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
            >
              <Video size={14} />
              Start call{selected.length > 1 ? ` (${selected.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
