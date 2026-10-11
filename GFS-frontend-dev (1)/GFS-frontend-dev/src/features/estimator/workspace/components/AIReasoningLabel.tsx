type AIReasoningLabelProps = {
  className?: string;
};

/** Quiet, consistent attribution for reasoning produced by rules/AI rather than a source document. */
export const AIReasoningLabel = ({ className = "" }: AIReasoningLabelProps) => (
  <span
    title="This reasoning was generated from project rules and AI analysis."
    className={`inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium leading-none text-slate-500 ${className}`}
  >
    <span
      aria-hidden="true"
      className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[4px] border border-slate-300 px-0.5 text-[8px] font-bold leading-none tracking-tight text-slate-500"
    >
      AI
    </span>
    AI-assisted
  </span>
);
