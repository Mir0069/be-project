import { useState } from "react";
import {
  getProjectStatusLabel,
  type StatusAudience,
} from "@/shared/lib/statusConfig";

const STATUS_LEGEND = [
  {
    label: "Not Started",
    meaning: "Workflow has not begun",
    dotClassName: "bg-red-500",
    badgeClassName: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
  },
  {
    label: "Input Pending",
    meaning: "Human action required to provide missing inputs",
    dotClassName: "bg-yellow-500",
    badgeClassName: "bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100",
  },
  {
    label: "AI Extraction In Progress",
    meaning: "AI is processing drawings or documents",
    dotClassName: "bg-cyan-500",
    badgeClassName: "bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100",
  },
  {
    label: "Ready for Estimation",
    meaning: "AI extraction is complete and estimator review can begin",
    dotClassName: "bg-sky-500",
    badgeClassName: "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100",
  },
  {
    label: "In Progress",
    meaning: "Estimator work is underway",
    dotClassName: "bg-blue-500",
    badgeClassName: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  },
  {
    label: "Needs Revision",
    meaning: "A workflow stage is open for correction and reapproval",
    dotClassName: "bg-orange-500",
    badgeClassName: "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100",
  },
  {
    label: "Completed",
    meaning: "Required workflow is complete",
    dotClassName: "bg-green-500",
    badgeClassName: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
  },
] as const;

type StatusLegendProps = {
  className?: string;
  audience?: StatusAudience;
};

const StatusLegend = ({ className = "", audience = "default" }: StatusLegendProps) => {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const legend = STATUS_LEGEND.map((status) => {
    if (status.label !== "Ready for Estimation") return status;

    return {
      ...status,
      label: getProjectStatusLabel("Ready for Estimation", audience),
      meaning:
        audience === "estimator"
          ? "AI extraction is complete and estimator review is required"
          : status.meaning,
    };
  });

  return (
    <div
      role="group"
      aria-label="Project status legend"
      className={`w-full rounded-lg border border-gray-200 bg-white p-2.5 shadow-xs ${className}`}
    >
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-7">
        {legend.map((status, index) => {
          const isTooltipVisible = activeTooltip === status.label;
          const hasDesktopSeparator = index < legend.length - 1;

          return (
            <div
              key={status.label}
              className={`relative w-full ${hasDesktopSeparator
                ? "lg:after:absolute lg:after:-right-[6px] lg:after:top-1/2 lg:after:h-5 lg:after:w-px lg:after:-translate-y-1/2 lg:after:bg-gray-800/70 lg:after:content-['']"
                : ""
              }`}
              onMouseEnter={() => setActiveTooltip(status.label)}
              onMouseLeave={() => setActiveTooltip(null)}
            >
              <button
                type="button"
                aria-label={`${status.label}: ${status.meaning}`}
                onClick={() =>
                  setActiveTooltip(isTooltipVisible ? null : status.label)
                }
                className={`w-full inline-flex cursor-help items-center justify-center gap-2 rounded-full border px-2 py-1.5 text-xs font-medium transition-all ${status.badgeClassName}`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${status.dotClassName}`}
                  aria-hidden="true"
                />
                <span className="truncate">{status.label}</span>
              </button>

              {/* Interactive Tooltip on hover/tap */}
              {isTooltipVisible && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-opacity animate-in fade-in zoom-in-95 duration-150"
                >
                  {status.meaning}
                  {/* Tooltip arrow */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StatusLegend;
