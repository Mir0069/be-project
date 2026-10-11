import { cn } from "@/shared/lib/cn";

type SkeletonProps = {
  className?: string;
};

export const Skeleton = ({ className }: SkeletonProps) => (
  <span
    className={cn(
      "block rounded-md bg-[linear-gradient(90deg,#e5e7eb_25%,#f3f4f6_37%,#e5e7eb_63%)] bg-[length:200%_100%] animate-shimmer",
      className
    )}
  />
);

export const TableRowSkeleton = ({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} className="border-b border-gray-100 last:border-0">
        {Array.from({ length: columns }).map((_, c) => (
          <td key={c} className="py-4">
            <Skeleton className={cn("h-4", c === 0 ? "w-44" : "w-24")} />
          </td>
        ))}
      </tr>
    ))}
  </>
);

export const ListSkeleton = ({ rows = 6 }: { rows?: number }) => (
  <div className="divide-y divide-gray-100">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-start gap-3 px-6 py-4">
        <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-28" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default Skeleton;
