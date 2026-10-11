import { useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ClipboardList, Download, RefreshCw } from "lucide-react";
import Pagination from "@/components/ui/Pagination";
import { showToast } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { fetchProjects } from "@/services/projects";
import { useProjectDetail } from "@/features/projects/query/projectWorkspaceQuery";
import { downloadFeedbackHistory } from "@/services/audit-logs";
import { hasAnyRole } from "@/shared/lib/roleAccess";
import { useAuditLogs } from "../query/auditLogsQuery";
import { ActivityList } from "../components/ActivityList";
import { CATEGORY_LABELS } from "../utils/activityPresentation";
import type { AuditLogCategory } from "@/shared/types/auditLog.types";

const control = "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500";

type DropdownOption = { label: string; value: string };

const AnimatedAuditSelect = ({
  ariaLabel,
  value,
  options,
  onChange,
  className,
}: {
  ariaLabel: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 transition hover:border-red-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown
          size={16}
          className={`ml-3 shrink-0 text-gray-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="animate-project-filter-menu-in absolute z-30 mt-2 w-full min-w-max rounded-md border border-gray-200 bg-white p-1 shadow-lg"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center rounded px-3 py-2 text-left text-sm transition ${isSelected ? "bg-red-50 font-medium text-red-600" : "text-gray-700 hover:bg-gray-50"}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AuditLogsPage = () => {
  const { projectId } = useParams<{ projectId?: string }>();
  return <ActivityHistory key={projectId || "global"} projectKey={projectId} />;
};
const ActivityHistory = ({ projectKey }: { projectKey?: string }) => {
  const { role } = useAuth();
  const isEstimator = role === "ESTIMATOR";
  const canDownloadFeedback = Boolean(
    projectKey && hasAnyRole(role, ["SYSTEM_ADMIN", "SUPER_ADMIN", "HEAD_OF_DIVISION"]),
  );
  const { data: project } = useProjectDetail(projectKey);
  const [isDownloading, setIsDownloading] = useState(false);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<AuditLogCategory | "">("");
  const [since, setSince] = useState("");
  const [actor, setActor] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "audit-log-filter"],
    queryFn: fetchProjects,
    enabled: !projectKey && !isEstimator,
    staleTime: 30_000,
  });
  const query = useAuditLogs({
    projectId: project?.id || projectKey, page, limit: 25,
    ...(category ? { category } : {}), ...(since ? { since } : {}), ...(actor ? { actorEmail: actor } : {}),
    ...(!projectKey && projectId ? { projectId } : {}),
  });
  const result = query.data;
  const items = result?.items ?? [];
  const filtered = Boolean(category || since || actor || projectId);
  const categories = Object.entries(CATEGORY_LABELS).filter(([value]) =>
    !isEstimator || ["DOCUMENT", "EXTRACTION"].includes(value));
  const clear = () => { setCategory(""); setSince(""); setActor(""); setActorInput(""); setProjectId(""); setProjectInput(""); setPage(1); };
  const projectLabel = (project: typeof projects[number]) =>
    `${project.projectName} · ${project.referenceNumber || project.projectCode}`;
  const projectLookup = Object.fromEntries(projects.map((project) => [project.id, {
    id: project.id,
    projectName: project.projectName,
    referenceNumber: project.referenceNumber || project.projectCode,
  }]));
  // Only Head of Division needs cross-project identity in the global audit view.
  const showProjectBadge = role === "HEAD_OF_DIVISION" && !projectKey;
  const selectProject = (value: string) => {
    setProjectInput(value);
    const selected = projects.find((project) => projectLabel(project) === value);
    setProjectId(selected?.id || "");
    setPage(1);
  };
  const downloadFeedback = async () => {
    const id = project?.id || projectKey;
    if (!id || isDownloading) return;

    setIsDownloading(true);
    try {
      const { blob, fileName } = await downloadFeedbackHistory(id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast("success", "Feedback history downloaded");
    } catch (error) {
      const message = (error as { message?: unknown })?.message;
      showToast(
        "error",
        typeof message === "string" && message.trim()
          ? message
          : "Could not download feedback history. Please try again.",
      );
    } finally {
      setIsDownloading(false);
    }
  };
  return (
    <div className="w-full space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 border-l-4 border-red-600 pl-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-red-600"><ClipboardList size={24} aria-hidden="true" />{projectKey ? "Project audit log" : "Audit Logs"}</h1>
          {!isEstimator && <p className="mt-1 text-sm text-gray-500">{projectKey ? "A complete, time-stamped record of actions and system events for this project." : "Activity across projects and team administration."}</p>}
          {projectKey && (
            <p className="mt-3 text-xs text-gray-500">
              Every entry is retained separately. <span className="font-medium text-emerald-700">Completed</span> means an action finished successfully. <span aria-hidden="true">·</span> <span className="font-medium text-gray-700">Audit record</span> means smartmfgAI Everywhere saved a supporting record.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {projectKey && <Link className="text-sm font-medium text-red-600 hover:underline" to={`/projects/${encodeURIComponent(project?.referenceNumber || projectKey)}/dashboard`}>Project overview</Link>}
          {canDownloadFeedback && <button type="button" onClick={downloadFeedback} disabled={isDownloading || !project?.id && !projectKey} className={control + " inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"} title="Download feedback history as CSV"><Download size={15} aria-hidden="true" />{isDownloading ? "Downloading…" : "Download feedback history"}</button>}
          <button type="button" onClick={() => query.refetch()} disabled={query.isFetching} className={control + " inline-flex items-center gap-2 disabled:opacity-50"}><RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>
        </div>
      </header>
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <form onSubmit={(e) => { e.preventDefault(); setActor(actorInput.trim()); setPage(1); }} className="flex flex-wrap items-end gap-3 border-b border-gray-200 p-4">
          <div className="grid gap-1 text-xs font-medium text-gray-600"><span>Record type</span><AnimatedAuditSelect ariaLabel="Record type" value={category} onChange={(value) => { setCategory(value as AuditLogCategory | ""); setPage(1); }} className="w-full sm:w-[286px]" options={[{ label: "All activity", value: "" }, ...categories.map(([value, label]) => ({ label, value }))]} /></div>
          <div className="grid gap-1 text-xs font-medium text-gray-600"><span>Period</span><AnimatedAuditSelect ariaLabel="Period" value={since ? "recent" : ""} onChange={(value) => { setSince(value ? new Date(Date.now() - 7 * 86400000).toISOString() : ""); setPage(1); }} className="w-full sm:w-[230px]" options={[{ label: "All time", value: "" }, { label: "Last 7 days", value: "recent" }]} /></div>
          {!isEstimator && <><label className="grid gap-1 text-xs font-medium text-gray-600">Team member email<input className={control} type="email" placeholder="Search by email" value={actorInput} maxLength={254} onChange={(e) => setActorInput(e.target.value)} /></label><button type="submit" className={control}>Apply</button></>}
          {!projectKey && !isEstimator && <label className="grid gap-1 text-xs font-medium text-gray-600">Project<input className={control} list="audit-log-projects" placeholder="All projects" value={projectInput} onChange={(e) => selectProject(e.target.value)} /><datalist id="audit-log-projects">{projects.map((project) => <option key={project.id} value={projectLabel(project)} />)}</datalist></label>}
          {filtered && <button type="button" onClick={clear} className="px-2 py-2 text-sm font-medium text-red-600 hover:underline">Clear filters</button>}
        </form>
        <div className="flex justify-between border-b border-gray-100 px-5 py-3 text-xs text-gray-500">
          <span>{projectKey ? "Project audit records" : "Audit records"}{result && !query.isError ? " · " + result.total + " records" : ""}</span><span>Newest first</span>
        </div>
        {query.isLoading ? <p role="status" className="p-12 text-center text-sm text-gray-500">Loading activity…</p>
          : query.isError ? <div role="alert" className="p-12 text-center text-sm text-gray-600">We could not load activity. <button type="button" className="text-red-600 hover:underline" onClick={() => query.refetch()}>Retry</button></div>
          : items.length ? <ActivityList items={items} showProjectBadge={showProjectBadge} clientFriendly={Boolean(projectKey)} projectLookup={projectLookup} />
          : <div className="px-5 py-12 text-center"><ClipboardList className="mx-auto text-gray-300" size={32} /><h2 className="mt-3 text-sm font-semibold text-gray-800">{filtered ? "No matching activity" : "No activity recorded yet"}</h2><p className="mt-1 text-sm text-gray-500">{filtered ? "Try another activity type, period, or team member." : "New activities will appear as your team works. Earlier actions are not added retrospectively."}</p></div>}
      </section>
      {result && result.total > 0 && !query.isError && <Pagination page={result.page} totalPages={result.totalPages} rangeStart={(result.page - 1) * result.limit + 1} rangeEnd={Math.min(result.page * result.limit, result.total)} total={result.total} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(result.totalPages, page + 1))} noun="activities" />}
    </div>
  );
};
export default AuditLogsPage;
