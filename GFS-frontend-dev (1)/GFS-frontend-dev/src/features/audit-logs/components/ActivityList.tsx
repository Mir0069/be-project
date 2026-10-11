import { AlertCircle, CheckCircle2, Clock3, ClipboardList } from "lucide-react";
import type { AuditLogItem, AuditLogProject } from "@/shared/types/auditLog.types";
import { activityStatus, actorEmail, actorLabel, CATEGORY_LABELS, formatDate, getActivityCopy, getActivityDetails, sourceLabel } from "../utils/activityPresentation";

export const ActivityList = ({ items, showProjectBadge = false, compact = false, clientFriendly = false, projectLookup = {} }: {
  items: AuditLogItem[]; showProjectBadge?: boolean; compact?: boolean; clientFriendly?: boolean; projectLookup?: Record<string, AuditLogProject>;
}) => (
  <ol className="divide-y divide-gray-100">
    {items.map((item) => {
      const status = activityStatus(item);
      const failed = status === "Needs attention";
      const pending = status === "In progress";
      const complete = status === "Completed";
      const Icon = failed ? AlertCircle : pending ? Clock3 : complete ? CheckCircle2 : ClipboardList;
      const tone = failed ? "bg-red-50 text-red-700" : pending ? "bg-amber-50 text-amber-800" : complete ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600";
      const copy = getActivityCopy(item);
      const isSupportingRecord = clientFriendly && status === "Audit record";
      const details = clientFriendly ? getActivityDetails(item) : [];
      const actor = actorLabel(item);
      const email = actorEmail(item);
      const project = item.project ?? (item.projectId ? projectLookup[item.projectId] : undefined);
      return (
        <li key={item.id} className={`grid gap-3 px-4 py-4 sm:px-5 sm:grid-cols-[2rem_minmax(0,1fr)] ${isSupportingRecord ? "bg-gray-50/60" : ""}`}>
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon size={16} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800">
                <span>{isSupportingRecord ? `System record: ${copy.title}` : copy.title}</span>
                {showProjectBadge && project && (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                    <span className="truncate">{project.projectName}</span>
                    <span className="font-mono text-gray-500">{project.referenceNumber}</span>
                  </span>
                )}
              </p>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>
            </div>
            {!compact && <p className="mt-1 text-sm text-gray-600">{isSupportingRecord ? "smartmfgAI Everywhere saved this supporting record as part of the complete project audit log." : copy.summary}</p>}
            {details.length > 0 && !compact && (
              <details className="group mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-red-600 marker:hidden hover:text-red-700">
                  <span className="group-open:hidden">View audit details</span>
                  <span className="hidden group-open:inline">Hide audit details</span>
                </summary>
                <dl className="mt-3 grid gap-2 border-t border-gray-200 pt-3 text-sm sm:grid-cols-2">
                  {details.map((detail) => (
                    <div key={detail.label}>
                      <dt className="text-xs font-medium text-gray-500">{detail.label}</dt>
                      <dd className="mt-0.5 font-medium text-gray-800">
                        {detail.previousValue ? `${detail.previousValue} → ${detail.value}` : detail.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            {item.targetLabel && <p className="mt-1 break-words text-sm text-gray-700">{item.targetType === "DOCUMENT" ? "Document" : item.targetType === "PROJECT" ? "Project" : item.targetType === "USER" ? "Team member" : "Related item"}: {item.targetLabel}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
              <span><span className="font-medium text-gray-600">Type:</span> {CATEGORY_LABELS[item.category]}</span>
              <span className="break-all"><span className="font-medium text-gray-600">Actor:</span> {actor}{email ? ` · ${email}` : ""}</span>
              <span><span className="font-medium text-gray-600">Source:</span> {sourceLabel(item)}</span>
              <time dateTime={item.createdAt}><span className="font-medium text-gray-600">Recorded:</span> {formatDate(item.createdAt)}</time>
            </div>
          </div>
        </li>
      );
    })}
  </ol>
);
