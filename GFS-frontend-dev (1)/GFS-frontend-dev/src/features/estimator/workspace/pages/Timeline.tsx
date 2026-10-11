import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CircleAlert,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useProposalTimeline } from "@/features/projects/query/proposalsQuery";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import type {
  ProposalTimelineItem,
  TimelineItemStatus,
} from "@/shared/types/proposalTimeline.types";

const STATUS_CONFIG: Record<
  TimelineItemStatus,
  {
    label: string;
    rowClassName: string;
    badgeClassName: string;
    Icon: typeof CheckCircle2;
  }
> = {
  COMPLETED: {
    label: "Completed",
    rowClassName: "border-gray-200 bg-white",
    badgeClassName: "bg-emerald-50 text-emerald-700",
    Icon: CheckCircle2,
  },
  PENDING: {
    label: "Pending",
    rowClassName: "border-gray-200 bg-white",
    badgeClassName: "bg-amber-50 text-amber-700",
    Icon: Clock3,
  },
  NOT_STARTED: {
    label: "Not Started",
    rowClassName: "border-gray-200 bg-white",
    badgeClassName: "bg-red-50 text-red-700",
    Icon: CircleAlert,
  },
};

const getStepDescription = (item: ProposalTimelineItem) =>
  item.status === "COMPLETED"
    ? item.completedDescription
    : item.description;

const formatDateTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
};

const formatWaitDuration = (seconds?: number | null) => {
  if (seconds == null) return null;
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ${hours % 24} hr`;
};

const formatCurrency = (value?: number | null) =>
  value == null || !Number.isFinite(value)
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

const Timeline = () => {
  const { projectId } = useProjectRoute();
  const timelineQuery = useProposalTimeline(projectId);

  if (timelineQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Loading project timeline...
      </div>
    );
  }

  if (timelineQuery.isError) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
        <AlertCircle className="h-10 w-10 text-red-500" aria-hidden="true" />
        <p className="text-lg text-gray-600">Could not load project timeline data.</p>
        <button
          type="button"
          onClick={() => timelineQuery.refetch()}
          className="inline-flex items-center gap-2 rounded-md border border-red-300 px-4 py-2 text-red-600 transition hover:bg-red-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  const items = timelineQuery.data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="ml-2 border-l-4 border-red-500 px-5">
        <h1 className="text-2xl font-semibold leading-8 text-red-500">
          Project Timeline
        </h1>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">
          No timeline stages are available for this project.
        </div>
      ) : (
        <div className="relative pl-10">
          <div className="absolute bottom-5 left-3 top-5 w-px bg-gray-300" aria-hidden="true" />

          <ul className="space-y-3">
            {items.map((item) => {
              const config = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.NOT_STARTED;
              const StatusIcon = config.Icon;

              return (
                <li key={item.step} className="relative">
                  <div className="absolute -left-7 top-7 h-px w-6 bg-gray-300" aria-hidden="true" />
                  <article
                    className={`rounded-lg border p-4 shadow-sm transition-shadow hover:border-red-200 hover:shadow-md ${config.rowClassName}`}
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-700">
                              Step {item.step}
                            </span>
                            <h2 className="min-w-0 break-words text-sm font-semibold text-gray-900">
                              {item.name}
                            </h2>
                          </div>

                          <span
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none ${config.badgeClassName}`}
                          >
                            <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {config.label}
                          </span>
                        </div>

                        <p className="mt-2.5 break-words text-[13px] leading-5 text-gray-600">
                          {getStepDescription(item)}
                        </p>

                        {(item.events?.length ?? 0) > 0 && (
                          <ul className="mt-3 space-y-1.5 border-l-2 border-red-100 pl-3 text-xs text-gray-600">
                            {item.events?.map((event, index) => (
                              <li key={`${event.label}-${event.occurredAt}-${index}`}>
                                <span className="font-medium text-gray-800">{event.label}</span>
                                {event.amount != null && ` · ${formatCurrency(event.amount)}`}
                                {event.actorName && ` · ${event.actorName}`}
                                {` · ${formatDateTime(event.occurredAt) ?? "Recorded"}`}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-gray-200 bg-gray-50/70 text-xs lg:mt-0">
                        <div className="border-r border-gray-200 px-3 py-2.5">
                          <dt className="font-medium uppercase tracking-wide text-gray-500">Start time</dt>
                          <dd className="mt-1.5 break-words font-medium leading-5 text-gray-800">{formatDateTime(item.startedAt) ?? "—"}</dd>
                        </div>
                        <div className="px-3 py-2.5">
                          <dt className="font-medium uppercase tracking-wide text-gray-500">End time</dt>
                          <dd className="mt-1.5 break-words font-medium leading-5 text-gray-800">{formatDateTime(item.completedAt) ?? "—"}</dd>
                        </div>
                      </dl>
                    </div>

                    {item.isStuck ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <p className="font-semibold">Waiting for {item.waitingFor ?? "the next action"}</p>
                        <p className="mt-0.5">
                          Since {formatDateTime(item.waitingSince) ?? "the last update"}
                          {formatWaitDuration(item.waitingDurationSeconds)
                            ? ` · ${formatWaitDuration(item.waitingDurationSeconds)}`
                            : ""}
                        </p>
                      </div>
                    ) : item.status !== "COMPLETED" ? (
                      <p className="mt-2 text-xs text-gray-500">
                        Last updated {formatDateTime(item.updatedAt) ?? "Not updated yet"}
                      </p>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Timeline;
