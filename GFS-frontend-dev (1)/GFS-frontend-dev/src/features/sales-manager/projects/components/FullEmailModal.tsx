import { useEffect } from "react";
import { CalendarDays, Mail, UserRound, X } from "lucide-react";
import type { DraftProject } from "@/features/sales-manager/query/draftsQuery";
import EmailBody from "./EmailBody";

interface FullEmailModalProps {
  draft: DraftProject;
  onClose: () => void;
}

const formatDate = (date: string): string =>
  new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const FullEmailModal = ({ draft, onClose }: FullEmailModalProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-email-title"
        className="flex max-h-[min(86vh,860px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gray-50 px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
              <Mail size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
                Full email
              </p>
              <h2 id="full-email-title" className="mt-1 break-words text-lg font-semibold text-gray-900">
                {draft.subject || "Untitled email"}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound size={13} aria-hidden="true" />
                  {draft.fromName || draft.fromAddress || "Unknown sender"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={13} aria-hidden="true" />
                  {formatDate(draft.receivedDateTime)}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close full email"
            className="shrink-0 rounded-md p-2 text-gray-400 transition hover:bg-white hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500/30"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <EmailBody html={draft.bodyHtml} text={draft.bodyText || draft.proposed?.summary} />
        </div>

        <footer className="flex justify-end border-t border-gray-200 bg-gray-50 px-5 py-3 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-red-300 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/30"
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
};

export default FullEmailModal;
