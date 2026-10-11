type ConfidenceTone = "high" | "medium" | "low";

type NormalizedConfidence = {
  display: string;
  tone: ConfidenceTone;
};

type ConfidenceBadgeProps = {
  confidence?: unknown;
  className?: string;
};

export const hasConfidenceValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "";
};

const toneClasses: Record<ConfidenceTone, string> = {
  high: "border-emerald-100 bg-emerald-50 text-emerald-700",
  medium: "border-amber-100 bg-amber-50 text-amber-700",
  low: "border-red-100 bg-red-50 text-red-700",
};

const normalizeConfidence = (value: unknown): NormalizedConfidence | null => {
  if (value === null || value === undefined || value === "") return null;

  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value.trim().replace(/%$/, ""))
      : Number.NaN;

  if (Number.isFinite(numericValue)) {
    const percent = Math.min(100, Math.max(0, numericValue <= 1 ? numericValue * 100 : numericValue));
    const tone: ConfidenceTone = percent >= 80 ? "high" : percent >= 50 ? "medium" : "low";
    return { display: `${Math.round(percent)}%`, tone };
  }

  const label = String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (label === "HIGH" || label === "HIGH_CONFIDENCE") {
    return { display: "High", tone: "high" };
  }
  if (label === "MEDIUM" || label === "MEDIUM_CONFIDENCE" || label === "MODERATE") {
    return { display: "Medium", tone: "medium" };
  }
  if (label === "LOW" || label === "LOW_CONFIDENCE") {
    return { display: "Low", tone: "low" };
  }

  return null;
};

export const ConfidenceBadge = ({ confidence, className = "" }: ConfidenceBadgeProps) => {
  const normalized = normalizeConfidence(confidence);
  if (!normalized) return null;

  return (
    <span
      aria-label={`AI confidence: ${normalized.display}`}
      title={`AI confidence: ${normalized.display}`}
      className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none ${toneClasses[normalized.tone]} ${className}`}
    >
      <span className="font-medium text-gray-500">AI confidence</span>
      <span className="font-semibold">{normalized.display}</span>
    </span>
  );
};
