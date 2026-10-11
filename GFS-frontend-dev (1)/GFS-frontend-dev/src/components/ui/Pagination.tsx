import { cn } from "@/shared/lib/cn";

type PaginationProps = {
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  noun?: string;
  className?: string;
};

const buttonClass =
  "px-4 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 transition hover:border-red-500 hover:text-red-500 disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600";

const Pagination = ({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  total,
  onPrev,
  onNext,
  noun = "results",
  className,
}: PaginationProps) => {
  if (total === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 mt-4 pt-4 border-t border-gray-100",
        className
      )}
    >
      <p className="text-sm text-gray-500">
        Showing <span className="font-medium text-red-500">{rangeStart}</span>
        &ndash;
        <span className="font-medium text-red-500">{rangeEnd}</span> of{" "}
        <span className="font-medium text-red-500">{total}</span> {noun}
      </p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={onPrev} disabled={page <= 1} className={buttonClass}>
          Previous
        </button>
        <span className="text-sm text-gray-500 tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          className={buttonClass}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default Pagination;
