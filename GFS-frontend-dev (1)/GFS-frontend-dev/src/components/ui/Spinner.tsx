import { cn } from "@/shared/lib/cn";

type SpinnerProps = {
  size?: number;
  label?: string;
  className?: string;
};

const Spinner = ({ size = 20, label, className }: SpinnerProps) => (
  <div className={cn("flex items-center justify-center gap-2 text-sm text-gray-400", className)}>
    <span
      role="status"
      aria-label="Loading"
      className="inline-block shrink-0 rounded-full border-2 border-red-500/25 border-t-red-500 animate-spin"
      style={{ width: size, height: size }}
    />
    {label && <span>{label}</span>}
  </div>
);

export default Spinner;
