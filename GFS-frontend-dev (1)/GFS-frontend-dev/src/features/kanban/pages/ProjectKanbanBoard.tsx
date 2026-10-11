import { useId, useMemo, useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import {
  ArrowDownAZ,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  RefreshCw,
  Search,
  X,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import { useProjectWorkspace } from "@/features/projects/query/projectWorkspaceQuery";
import { getProjectWorkspacePath } from "@/features/projects/utils/projectRoute";
import type { ApiProject } from "@/services/project-workspace";
import type { KanbanStage } from "../types/kanban.types";
import { KANBAN_STAGES, PROJECT_STATUS_TO_KANBAN_STAGE } from "../constants/kanban.constants";

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
};

const STATUS_PRESENTATION: Record<string, { label: string; dot: string }> = {
  SETUP_PENDING: { label: "Requirements pending", dot: "bg-slate-400" },
  WAITING_FOR_INPUTS: { label: "Waiting for inputs", dot: "bg-amber-500" },
  READY_FOR_ESTIMATOR: { label: "Ready for Estimation", dot: "bg-sky-500" },
  ESTIMATOR_DRAFTING: { label: "Estimator drafting", dot: "bg-indigo-500" },
  ESTIMATOR_FINAL: { label: "Estimator finalizing", dot: "bg-emerald-500" },
  ADMIN_PACKAGING: { label: "Packaging proposal", dot: "bg-purple-500" },
};

const getStatusPresentation = (status: string) =>
  STATUS_PRESENTATION[status] ?? {
    label: status.toLowerCase().replaceAll("_", " "),
    dot: "bg-slate-400",
  };

const isAssignedToEstimator = (
  project: ApiProject,
  userId: string | undefined,
  email: string | undefined,
) => {
  const normalizedEmail = email?.trim().toLowerCase();
  return (
    project.assignedEstimatorId === userId ||
    project.estimatorEmail?.trim().toLowerCase() === normalizedEmail ||
    project.assignedEstimators?.some(
      (estimator) => estimator.id === userId || estimator.email?.trim().toLowerCase() === normalizedEmail,
    ) === true
  );
};

const ProjectKanbanBoard = () => {
  const { user, role } = useAuth();
  const { data, isLoading, isError, isFetching, refetch } = useProjectWorkspace({
    page: 1,
    limit: 500,
    sortBy: "updatedAt",
    sortOrder: "desc",
  });
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"ALL" | KanbanStage>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState<"updated" | "name">("updated");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [isLoading, checkScroll]);

  const scrollLeft = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: -340, behavior: "smooth" });
    setTimeout(checkScroll, 350);
  };

  const scrollRight = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: 340, behavior: "smooth" });
    setTimeout(checkScroll, 350);
  };

  const visibleProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const projects = (data?.data ?? [])
      .filter((project) => role !== "ESTIMATOR" || isAssignedToEstimator(project, user?.id, user?.email))
      .filter((project) => {
        if (!normalizedSearch) return true;
        return [project.projectName, project.referenceNumber, project.customerName, project.jobAddress]
          .some((value) => value?.toLowerCase().includes(normalizedSearch));
      })
      .filter((project) => {
        const stage = PROJECT_STATUS_TO_KANBAN_STAGE[project.status];
        return stageFilter === "ALL" || stage === stageFilter;
      })
      .filter((project) => assigneeFilter === "ALL" || project.estimatorEmail === assigneeFilter);

    return projects.sort((a, b) => {
      if (sortOrder === "name") return (a.projectName || "").localeCompare(b.projectName || "");
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });
  }, [assigneeFilter, data, role, search, sortOrder, stageFilter, user?.email, user?.id]);

  const assignees = useMemo(() => {
    const values = new Map<string, string>();
    (data?.data ?? []).forEach((project) => {
      if (project.estimatorEmail) values.set(project.estimatorEmail, project.estimatorName || project.estimatorEmail);
    });
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const projectsByStage = useMemo(
    () => KANBAN_STAGES.reduce<Record<KanbanStage, ApiProject[]>>((groups, stage) => {
      groups[stage] = visibleProjects.filter((project) => PROJECT_STATUS_TO_KANBAN_STAGE[project.status] === stage);
      return groups;
    }, {} as Record<KanbanStage, ApiProject[]>),
    [visibleProjects],
  );

  const hasActiveFilters = Boolean(
    search.trim() || stageFilter !== "ALL" || assigneeFilter !== "ALL" || sortOrder !== "updated",
  );
  const clearFilters = () => {
    setSearch("");
    setStageFilter("ALL");
    setAssigneeFilter("ALL");
    setSortOrder("updated");
  };

  if (isLoading) return <BoardState message="Loading Kanban..." />;
  if (isError) {
    return <BoardState message="Could not load Kanban." action={
      <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
        <RefreshCw size={16} /> Retry
      </button>
    } />;
  }

  return (
    <div className="flex h-[calc(100vh-3.25rem)] min-h-0 flex-col gap-3 pb-0">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-l-4 border-red-600 pl-4">
        <div className="flex min-h-10 items-center">
          <h1 className="text-2xl font-semibold text-red-500">Kanban</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={role === "ESTIMATOR" ? "/estimator/projects" : "/sales-manager/projects"}
            aria-label="Back to project list"
            title="Back to Project List"
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-red-300 hover:text-red-600"
          >
            <ArrowLeft size={16} /> Back to Projects
          </Link>

          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={scrollLeft}
              disabled={!canScrollLeft}
              aria-label="Scroll Kanban left"
              title="Scroll left"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 transition hover:bg-slate-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={scrollRight}
              disabled={!canScrollRight}
              aria-label="Scroll Kanban right"
              title="Scroll right"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 transition hover:bg-slate-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            type="button"
            aria-label="Refresh Kanban"
            title="Refresh Kanban"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-red-300 hover:text-red-600 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <label className="relative min-w-[240px] flex-1 basis-full lg:basis-auto">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <span className="sr-only">Search projects</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, reference, customer or address" className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-100" />
        </label>
        <SelectControl ariaLabel="Filter by stage" value={stageFilter} onChange={(value) => setStageFilter(value as "ALL" | KanbanStage)} options={["ALL", ...KANBAN_STAGES]} allLabel="All stages" />
        {role !== "ESTIMATOR" && <SelectControl ariaLabel="Filter by estimator" value={assigneeFilter} onChange={setAssigneeFilter} options={["ALL", ...assignees.map(([email]) => email)]} labels={Object.fromEntries(assignees)} allLabel="All estimators" />}
        <SelectControl ariaLabel="Sort projects" value={sortOrder} onChange={(value) => setSortOrder(value as "updated" | "name")} options={["updated", "name"]} labels={{ updated: "Recently updated", name: "Project name" }} allLabel="Sort" icon={sortOrder === "name" ? <ArrowDownAZ size={16} /> : <CalendarDays size={16} />} />
        {hasActiveFilters && <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50" aria-label="Clear Kanban filters"><X size={15} /> Clear</button>}
        <span className="ml-auto whitespace-nowrap text-sm text-slate-500">{visibleProjects.length} {visibleProjects.length === 1 ? "project" : "projects"}</span>
      </div>

      <div
        ref={scrollContainerRef}
        className="kanban-board-scroll flex-1 min-h-0 min-w-0 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 scroll-smooth"
      >
        <div className="flex h-full min-w-max gap-3 px-1">
          {KANBAN_STAGES.map((stage) => (
            <div key={stage} className="h-full w-[19rem] shrink-0 snap-start">
              <KanbanColumn stage={stage} projects={projectsByStage[stage]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AnimatedKanbanSelect = ({
  ariaLabel,
  value,
  options,
  onChange,
  icon,
}: {
  ariaLabel: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  icon?: ReactNode;
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
    <div ref={containerRef} className="relative inline-flex h-10 min-w-[150px] items-center">
      {icon && <span className="pointer-events-none absolute left-3 z-10 text-slate-500">{icon}</span>}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white pr-9 text-sm text-slate-700 outline-none transition hover:border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100 ${icon ? "pl-9" : "pl-3"}`}
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown
          size={15}
          className={`pointer-events-none absolute right-3 text-slate-400 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="animate-project-filter-menu-in absolute left-0 top-full z-30 mt-2 min-w-full rounded-md border border-slate-200 bg-white p-1 shadow-lg"
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
                className={`flex w-full items-center rounded px-3 py-2 text-left text-sm transition ${isSelected ? "bg-red-50 font-medium text-red-600" : "text-slate-700 hover:bg-slate-50"}`}
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

const SelectControl = ({ ariaLabel, value, options, onChange, labels, allLabel, icon }: {
  ariaLabel: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  labels?: Record<string, string>;
  allLabel: string;
  icon?: ReactNode;
}) => (
  <AnimatedKanbanSelect
    ariaLabel={ariaLabel}
    value={value}
    onChange={onChange}
    icon={icon}
    options={options.map((option) => ({
      label: labels?.[option] || (option === "ALL" ? allLabel : option),
      value: option,
    }))}
  />
);

const KanbanColumn = ({ stage, projects }: { stage: KanbanStage; projects: ApiProject[] }) => (
  <section className="flex h-full min-h-0 flex-col rounded-lg border-2 border-gray-200 bg-white px-3 py-4">
    <div className="mb-5 flex min-h-8 items-center gap-2 text-sm font-medium text-red-500">
      <h2 className="min-w-0 truncate">{stage}</h2>
      <span className="ml-auto shrink-0 rounded-sm bg-red-500 px-2 py-0.5 text-xs text-white">{projects.length}</span>
    </div>
    <div aria-label={`${stage} projects`} className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1 no-scrollbar">
      {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
      {projects.length === 0 && <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm text-slate-500">No projects in this stage</p>}
    </div>
  </section>
);

const ProjectCard = ({ project }: { project: ApiProject }) => (
  <Link to={getProjectWorkspacePath(project)} aria-label={`Open ${project.projectName || "unnamed project"}`} className="block w-full rounded-lg border border-gray-200 bg-gray-50 p-3 transition-all hover:border-red-500 hover:bg-white hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-red-200">
    <div className="flex items-start gap-2.5">
      <FolderOpen size={17} className="mt-0.5 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900" title={project.projectName}>{project.projectName || "Unnamed project"}</p><p className="mt-0.5 truncate text-xs font-medium text-red-600">{project.referenceNumber || "No reference"}</p></div>
    </div>
    <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-500">
      <span className={`h-2 w-2 shrink-0 rounded-full ${getStatusPresentation(project.status).dot}`} aria-hidden="true" />
      <span className="truncate">{getStatusPresentation(project.status).label}</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      <div className="min-w-0"><p className="text-slate-400">Customer</p><p className="truncate font-medium text-slate-700" title={project.customerName || ""}>{project.customerName || "-"}</p></div>
      <div className="min-w-0 text-right"><p className="text-slate-400">Estimator</p><p className="truncate font-medium text-slate-700" title={project.estimatorName || ""}>{project.estimatorName || "Unassigned"}</p></div>
      <div className="flex min-w-0 items-center gap-1 text-slate-500"><UserRound size={13} /><span className="truncate">{project.jobAddress || "Address unavailable"}</span></div>
      <div className="flex items-center justify-end gap-1 text-slate-500"><CalendarDays size={13} /><span>{formatDate(project.updatedAt || project.createdAt)}</span></div>
    </div>
  </Link>
);

const BoardState = ({ message, action }: { message: string; action?: ReactNode }) => (
  <div className="flex min-h-64 items-center justify-center rounded-lg border border-slate-200 bg-white p-8 text-center"><div className="space-y-3 text-sm text-slate-600"><p>{message}</p>{action}</div></div>
);

export default ProjectKanbanBoard;
