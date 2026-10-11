import { Link } from "react-router-dom";
import type { ApiProject } from "@/services/project-workspace";
import { useAuditLogs } from "../query/auditLogsQuery";
import { ActivityList } from "./ActivityList";

export const RecentProjectActivity = ({ project }: { project: ApiProject }) => {
  const query = useAuditLogs({ projectId: project.id, limit: 5 });
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white" aria-label="Recent audit records">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-red-600">Recent audit records</h2>
        <Link className="text-sm font-medium text-red-600 hover:underline" to={`/projects/${encodeURIComponent(project.referenceNumber || project.id)}/audit-logs`}>View audit log</Link>
      </div>
      {query.isLoading ? <p className="p-5 text-sm text-gray-500">Loading audit records…</p>
        : query.isError ? <div className="p-5 text-sm text-gray-500">Could not load audit records. <button type="button" className="text-red-600 hover:underline" onClick={() => query.refetch()}>Retry</button></div>
        : query.data?.items.length ? <ActivityList items={query.data.items} compact />
        : <p className="p-5 text-sm text-gray-500">No audit records for this project yet.</p>}
    </section>
  );
};
