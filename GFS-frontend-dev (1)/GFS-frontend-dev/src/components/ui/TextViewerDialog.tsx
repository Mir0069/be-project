import { useEffect, useId } from "react";
import { X } from "lucide-react";

interface TextViewerDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  text: string;
  onClose: () => void;
}

/** Read-only popup for long text such as Zoho notes and meeting transcripts. */
const TextViewerDialog = ({ open, title, subtitle, text, onClose }: TextViewerDialogProps) => {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px] animate-fade-in"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl animate-pop-in"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-5 py-4 text-sm leading-6 text-gray-700 sm:px-6">
          {text}
        </div>
      </section>
    </div>
  );
};

export default TextViewerDialog;
