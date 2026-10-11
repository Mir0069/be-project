type NeedsReviewBadgeProps = {
  className?: string;
  title?: string;
};

const NeedsReviewBadge = ({
  className = "",
  title = "AI changed this value after it was approved. Review it before approving again.",
}: NeedsReviewBadgeProps) => (
  <span
    role="status"
    aria-label="Needs review"
    title={title}
    className={`inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ${className}`}
  >
    Needs review
  </span>
);

export default NeedsReviewBadge;
