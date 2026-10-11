import type { TeamsAiSummary } from "@/shared/types/teams.types";

const formatUpdated = (value: string | null | undefined): string => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

// Presentational AI-summary block — reused for the project Chat Summary and each
// Meeting Summary. Renders nothing when the summary is empty.
export const AiSummary = ({
  summary,
  label = "AI Summary",
}: {
  summary: TeamsAiSummary;
  label?: string;
}) => {
  const hasBody =
    Boolean(summary.summary) ||
    summary.keyPoints?.length > 0 ||
    summary.requirements?.length > 0;
  if (!hasBody) return null;

  const updated = formatUpdated(summary.updatedAt);

  return (
    <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{label}</span>
        {updated && <span className="text-[11px] text-gray-400">Updated {updated}</span>}
      </div>

      {summary.summary && (
        <p className="text-sm text-gray-700 whitespace-pre-line">{summary.summary}</p>
      )}

      {summary.keyPoints?.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-600">
          {summary.keyPoints.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      )}

      {summary.requirements?.length > 0 && (
        <div>
          <p className="mt-1 text-xs font-semibold text-gray-500">Requirements</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-600">
            {summary.requirements.map((req, i) => (
              <li key={i}>{req}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AiSummary;
