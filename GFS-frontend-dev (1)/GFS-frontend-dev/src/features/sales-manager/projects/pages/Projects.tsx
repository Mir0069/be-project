import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpDown,
  ChevronDown,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";

import StatusBadge from "../components/StatusBadge";
import { getStatusRowClass, normalizeProjectStatus } from "@/shared/lib/statusConfig";
import { useProjectWorkspace } from "@/features/projects/query/projectWorkspaceQuery";
import SearchBar from "@/components/ui/SearchBar";
import Pagination from "@/components/ui/Pagination";
import { TableRowSkeleton } from "@/components/ui/Skeleton";
import StatusLegend from "@/components/ui/StatusLegend";
import type { ProjectStatus } from "@/shared/types/project.types";
import type { ApiProject, ProjectWorkspaceParams } from "@/services/project-workspace";
import { getProjectWorkspacePath } from "@/features/projects/utils/projectRoute";
import { getPartnerForProject, usePartnerDemoStore } from "@/features/partners/partnerDemoStore";

const PER_PAGE = 15;

type ProjectRow = {
  key: string;
  to: string;
  name: string;
  reference: string;
  customer: string;
  partner: string | null;
  value: number | null;
  status: ProjectStatus;
  revisionRequest: ApiProject["revisionRequest"];
  estimators: string[];
  dueDate: string;
  updated: string;
};

const toProjectStatus = (apiStatus: string, analysisStatus?: string, hasAssignedEstimator?: boolean): ProjectStatus => {
  return normalizeProjectStatus(apiStatus, analysisStatus, hasAssignedEstimator);
};

const statusCategory = (status: string): ProjectWorkspaceParams["statusCategory"] => {
  const categories: Record<string, ProjectWorkspaceParams["statusCategory"]> = {
    "Not started": "NOT_STARTED",
    "Input Pending": "PENDING",
    Pending: "PENDING",
    "AI Extraction In Progress": "AI_PROCESSING",
    "Ready for Estimation": "READY_FOR_ESTIMATOR",
    "In-progress": "IN_PROGRESS",
    "Needs Revision": "NEEDS_REVISION",
    Completed: "COMPLETED",
  };
  return categories[status];
};

const updatedAfter = (period: string): string | undefined => {
  if (period === "all") return undefined;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (period === "week") date.setDate(date.getDate() - 7);
  if (period === "month") date.setDate(date.getDate() - 30);
  return date.toISOString();
};

const formatDate = (dateValue?: string) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDateOnly = (dateValue?: string | null) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatValue = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

type DropdownOption = { label: string; value: string };

type AnimatedSelectProps = {
  ariaLabel: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  leadingIcon?: ReactNode;
};

const AnimatedSelect = ({
  ariaLabel,
  value,
  options,
  onChange,
  className = "",
  leadingIcon,
}: AnimatedSelectProps) => {
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
      {leadingIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-gray-500">
          {leadingIcon}
        </span>
      )}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-gray-200 bg-white pr-3 text-sm text-gray-700 transition hover:border-red-500 focus:border-red-500 focus:outline-none ${leadingIcon ? "pl-9" : "pl-4"}`}
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown
          size={15}
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

const SalesManagerProjects = () => {
  const partnerState = usePartnerDemoStore();
  const [page, setPage] = useState(1);
  const [updatedFilter, setUpdatedFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<NonNullable<ProjectWorkspaceParams["sortBy"]>>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, statusFilter, updatedFilter, sortBy, sortOrder]);

  const query = useMemo<ProjectWorkspaceParams>(() => ({
    page,
    limit: PER_PAGE,
    search: debouncedSearch || undefined,
    statusCategory: statusCategory(statusFilter),
    updatedAfter: updatedAfter(updatedFilter),
    sortBy,
    sortOrder,
  }), [page, debouncedSearch, statusFilter, updatedFilter, sortBy, sortOrder]);

  const sortValue = `${sortBy}:${sortOrder}`;

  const handleSortChange = (value: string) => {
    const [field, direction] = value.split(":") as [
      NonNullable<ProjectWorkspaceParams["sortBy"]>,
      "asc" | "desc",
    ];
    setSortBy(field);
    setSortOrder(direction);
  };

  const { data, isLoading, isError, refetch } = useProjectWorkspace(query);

  const rows = useMemo<ProjectRow[]>(() => (data?.data ?? []).map((project: ApiProject) => {
    const estimators = (() => {
      const names = (project.assignedEstimators ?? [])
        .map((estimator) => estimator.name?.trim())
        .filter((name): name is string => Boolean(name));
      return names.length > 0
        ? names
        : project.estimatorName
          ? [project.estimatorName]
          : [];
    })();

    return {
      key: project.id,
      to: getProjectWorkspacePath(project),
      name: project.projectName || "-",
      reference: project.referenceNumber,
      customer: project.customerName || "-",
      partner: getPartnerForProject(partnerState, project.id)?.name ?? null,
      value: project.estimatedCost,
      status: toProjectStatus(project.status, project.analysisStatus, estimators.length > 0),
      revisionRequest: project.revisionRequest ?? null,
      estimators,
      dueDate: formatDateOnly(project.dueDate),
      updated: formatDate(project.updatedAt || project.createdAt),
    };
  }), [data, partnerState]);

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const rangeEnd = Math.min(page * PER_PAGE, total);

  return (
    <div className="space-y-6">
      <div className="border-l-3 border-red-500 px-4">
        <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">Project List</div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-8">
        <AnimatedSelect
          ariaLabel="Filter projects by status"
          value={statusFilter}
          onChange={setStatusFilter}
          className="w-[190px]"
          options={[
            { label: "By Status", value: "All" },
            { label: "Not started", value: "Not started" },
            { label: "Input Pending", value: "Input Pending" },
            { label: "AI Extraction In Progress", value: "AI Extraction In Progress" },
            { label: "Ready for Estimation", value: "Ready for Estimation" },
            { label: "In-progress", value: "In-progress" },
            { label: "Needs Revision", value: "Needs Revision" },
            { label: "Completed", value: "Completed" },
          ]}
        />
        <AnimatedSelect
          ariaLabel="Filter projects by updated date"
          value={updatedFilter}
          onChange={setUpdatedFilter}
          className="w-[190px]"
          options={[
            { label: "Updated: All", value: "all" },
            { label: "Updated: Today", value: "today" },
            { label: "Updated: Last Week", value: "week" },
            { label: "Updated: Last Month", value: "month" },
          ]}
        />

        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search project, customer, address or reference"
          className="w-[360px] max-w-full"
          inputClassName="border-0 focus:border-0 focus:ring-2 focus:ring-red-100"
        />

        <AnimatedSelect
          ariaLabel="Sort projects"
          value={sortValue}
          onChange={handleSortChange}
          className="w-[190px]"
          leadingIcon={<ArrowUpDown size={15} />}
          options={[
            { label: "Created: Newest", value: "createdAt:desc" },
            { label: "Created: Oldest", value: "createdAt:asc" },
            { label: "Updated: Recent", value: "updatedAt:desc" },
            { label: "Updated: Oldest", value: "updatedAt:asc" },
          ]}
        />

      </div>

      <StatusLegend className="-mt-3" />

      <section className="bg-white rounded-lg border border-gray-200 px-5 py-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead>
              <tr className="text-xs uppercase text-red-500 border-b border-gray-200">
                <th className="text-left py-3 font-semibold w-[24%]">Project</th>
                <th className="text-left py-3 font-semibold w-[17%]">Customer</th>
                <th className="text-left py-3 font-semibold w-[11%]">Value</th>
                <th className="text-left py-3 font-semibold w-[14%]">Status</th>
                <th className="text-left py-3 font-semibold w-[13%]">Estimators</th>
                <th className="text-left py-3 font-semibold w-[11%]">Due Date</th>
                <th className="text-left py-3 font-semibold w-[10%]">Updated</th>
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <TableRowSkeleton rows={8} columns={7} />
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center">
                    <p className="text-sm font-medium text-gray-700">Could not load projects.</p>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-3 inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-red-500 hover:text-red-500"
                    >
                      <RefreshCw size={15} /> Retry
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14">
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
                        <FolderOpen size={26} />
                      </span>
                      <p className="text-sm font-medium text-gray-700">
                        {debouncedSearch || statusFilter !== "All" || updatedFilter !== "all"
                          ? "No projects match your filters"
                          : "No projects yet"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-gray-100 last:border-0 transition-colors ${getStatusRowClass(row.status)} hover:brightness-95`}
                >
                  <td className="py-4">
                    <Link to={row.to} className="flex items-center gap-2 group">
                      <Folder size={18} className="text-gray-700 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-800 group-hover:text-red-500 transition-colors">{row.name}</p>
                        <p className="text-xs text-gray-500">{row.reference}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="py-4 text-gray-700">
                    <span className="block">{row.customer}</span>
                    {row.partner ? <span className="mt-0.5 block text-xs font-medium text-red-600">Partner: {row.partner}</span> : null}
                  </td>
                  <td className="py-4 font-medium tabular-nums text-gray-800">{formatValue(row.value)}</td>
                  <td className="w-[15%] min-w-[210px] py-4 pr-4 align-middle whitespace-nowrap">
                    <div className="space-y-1">
                      <StatusBadge status={row.status} />
                      {row.revisionRequest && (
                        <p className="max-w-[210px] truncate text-xs text-orange-800" title={row.revisionRequest.reason ?? undefined}>
                          Stage {row.revisionRequest.stage}{row.revisionRequest.reason ? ` · ${row.revisionRequest.reason}` : " · Revision in progress"}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="w-[13%] min-w-[150px] py-4 pl-4">
                    {row.estimators.length > 0
                      ? (
                        <div className="flex max-w-[190px] flex-wrap gap-1" title={row.estimators.join(", ")}>
                          {row.estimators.map((estimator) => (
                            <span
                              key={estimator}
                              className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
                            >
                              {estimator}
                            </span>
                          ))}
                        </div>
                      )
                      : <span className="text-gray-400 italic">Unassigned</span>}
                  </td>
                  <td className="py-4 text-gray-700 whitespace-nowrap">{row.dueDate}</td>
                  <td className="py-4 text-gray-700">{row.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && !isError && (
          <Pagination
            page={page}
            totalPages={totalPages}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={total}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
            noun="projects"
          />
        )}
      </section>
    </div>
  );
};

export default SalesManagerProjects;
