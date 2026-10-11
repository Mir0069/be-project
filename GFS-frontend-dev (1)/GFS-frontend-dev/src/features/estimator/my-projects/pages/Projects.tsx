import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  ChevronDown,
  Folder,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from "lucide-react";

import StatusBadge from "../../components/StatusBadge";
import Pagination from "@/components/ui/Pagination";
import { getStatusRowClass, normalizeProjectStatus } from "@/shared/lib/statusConfig";
import { useProjects } from "@/features/projects/query/projectsQuery";
import { useAuth } from "@/context/AuthContext";
import { visibleProjectsFor } from "../utils/projectVisibility";
import type { Project } from "@/shared/types/project.types";
import { getProjectWorkspacePath } from "@/features/projects/utils/projectRoute";
import StatusLegend from "@/components/ui/StatusLegend";

const getEstimatorFilterStatus = (
  status?: string | null,
  analysisStatus?: string | null,
) => {
  const normalizedStatus = normalizeProjectStatus(status, analysisStatus);
  return normalizedStatus === "Ready for Estimation"
    ? "Awaiting Estimator Review"
    : normalizedStatus;
};


const FilterSelect = ({ label, value, options, onChange }: any) => {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none flex items-center gap-2 pl-4 pr-10 py-2 bg-white border border-gray-200 rounded-md text-sm text-gray-700 hover:border-red-500 outline-none transition cursor-pointer"
      >
        <option value="All">{label}</option>
        {options.map((opt: string) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-4 top-3 text-gray-500 pointer-events-none" />
    </div>
  );
};

export default function EstimatorProjects() {
  const { user } = useAuth();
  const email = user?.email;
  const role = user?.role;

  const { data: allProjects = [], isLoading } = useProjects();

  const assignedProjects = visibleProjectsFor(allProjects, {
    id: user?.id,
    email,
    role,
  });

  // States
  const [viewMode, setViewMode] = useState<"my-pending" | "all-assigned">("all-assigned");
  const [searchQuery, setSearchQuery] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [dueDateFilter, setDueDateFilter] = useState<string>("All");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, dueDateFilter, viewMode]);


  // Sorting
  // Show the most recently created assigned projects first by default.
  const [sortConfig, setSortConfig] = useState<{ key: keyof Project | 'lastUpdate'; direction: "asc" | "desc" } | null>({
    key: "createdAt",
    direction: "desc",
  });

  const handleSort = (key: keyof Project | 'lastUpdate') => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key === key) {
      return sortConfig.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    }
    return <ArrowUpDown size={14} className="text-gray-400" />;
  };

  const processedProjects = useMemo(() => {
    let filtered = [...assignedProjects];

    // 1. View Mode
    if (viewMode === "my-pending") {
      filtered = filtered.filter((p) => normalizeProjectStatus(p.status, p.analysisStatus) !== "Completed");
    }

    // 2. Search (Reference or Customer Name)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.referenceNumber?.toLowerCase().includes(q) ||
          p.projectCode?.toLowerCase().includes(q) ||
          p.customerName?.toLowerCase().includes(q) ||
          p.projectName?.toLowerCase().includes(q)
      );
    }

    // 3. Filters
    if (statusFilter !== "All") {
      filtered = filtered.filter(
        (p) => getEstimatorFilterStatus(p.status, p.analysisStatus) === statusFilter,
      );
    }
    if (dueDateFilter !== "All") {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      filtered = filtered.filter((p) => {
        if (!p.dueDate) return false;
        const due = new Date(p.dueDate);
        if (isNaN(due.getTime())) return false;
        due.setHours(0, 0, 0, 0);
        
        const diffDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 3600 * 24));
        
        if (dueDateFilter === "Today") return diffDays === 0;
        if (dueDateFilter === "Next 7 Days") return diffDays >= 0 && diffDays <= 7;
        if (dueDateFilter === "Overdue") return diffDays < 0;
        return true;
      });
    }

    // 4. Sort
    if (sortConfig !== null) {
      filtered.sort((a: any, b: any) => {
        const aVal = sortConfig.key === "status"
          ? getEstimatorFilterStatus(a.status, a.analysisStatus)
          : (a[sortConfig.key] || "");
        const bVal = sortConfig.key === "status"
          ? getEstimatorFilterStatus(b.status, b.analysisStatus)
          : (b[sortConfig.key] || "");
        
        if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [assignedProjects, viewMode, searchQuery, statusFilter, dueDateFilter, sortConfig]);


  const total = processedProjects.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const paginatedProjects = useMemo(() => {
    return processedProjects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [processedProjects, page]);

  // Urgency logic
  const getUrgencyColor = (dueDateStr?: string) => {
    if (!dueDateStr) return "text-gray-600";
    const due = new Date(dueDateStr).getTime();
    const now = new Date().getTime();
    const daysLeft = (due - now) / (1000 * 3600 * 24);
    
    if (daysLeft < 0) return "text-red-600 font-semibold";
    if (daysLeft <= 3) return "text-orange-500 font-medium";
    if (daysLeft <= 7) return "text-yellow-600 font-medium";
    return "text-green-600";
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div className="border-l-3 border-red-500 px-4">
          <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
            Project List
          </div>
        </div>
        
        {/* View Mode Toggle */}
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setViewMode("my-pending")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              viewMode === "my-pending" ? "bg-white shadow text-red-600" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            My Pending
          </button>
          <button
            onClick={() => setViewMode("all-assigned")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              viewMode === "all-assigned" ? "bg-white shadow text-red-600" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            All Assigned
          </button>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        {assignedProjects.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by ID or Customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-w-[250px] rounded-md border border-gray-200 py-2 pl-9 pr-4 text-sm outline-none focus:border-red-500"
                />
                <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              </div>

              {/* Status Filter */}
              <FilterSelect
                label="By Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={["Not started", "Input Pending", "AI Extraction In Progress", "Awaiting Estimator Review", "In-progress", "Needs Revision", "Completed"]}
              />
            </div>

            <FilterSelect
              label="By Due Date"
              value={dueDateFilter}
              onChange={setDueDateFilter}
              options={["Today", "Next 7 Days", "Overdue"]}
            />
          </>
        )}

      </div>

      <StatusLegend className="-mt-3" audience="estimator" />

      {/* Project list card */}
      <section className="bg-white rounded-lg border border-gray-200 px-5 py-2">
        {isLoading ? (
           <div className="py-14 text-center text-gray-500 font-medium">Loading projects...</div>
        ) : assignedProjects.length === 0 ? (
          <div className="py-14 text-center text-red-500 font-semibold">No Projects Assigned To You</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-red-500 border-b border-gray-200">
                    <th className="text-left py-3 font-semibold px-2 uppercase tracking-wide">Project</th>
                    <th className="text-left py-3 font-semibold px-2 uppercase tracking-wide">Customer</th>
                    <th className="text-left py-3 font-semibold px-2 uppercase tracking-wide">POC</th>
                    
                    <th 
                      className="text-left py-3 font-semibold cursor-pointer hover:bg-red-50 px-2 rounded transition group uppercase tracking-wide"
                      onClick={() => handleSort("status")}
                    >
                      <div className="flex items-center gap-1">Status {getSortIcon("status")}</div>
                    </th>

                    <th className="text-left py-3 font-semibold px-2 uppercase tracking-wide">Action</th>

                    <th 
                      className="text-left py-3 font-semibold cursor-pointer hover:bg-red-50 px-2 rounded transition group uppercase tracking-wide"
                      onClick={() => handleSort("dueDate")}
                    >
                      <div className="flex items-center gap-1">Due Date {getSortIcon("dueDate")}</div>
                    </th>

                    <th 
                      className="text-left py-3 font-semibold cursor-pointer hover:bg-red-50 px-2 rounded transition group uppercase tracking-wide"
                      onClick={() => handleSort("lastUpdate")}
                    >
                      <div className="flex items-center gap-1">Last Updated {getSortIcon("lastUpdate")}</div>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {processedProjects.length === 0 ? (
                     <tr>
                       <td colSpan={7} className="py-10 text-center text-sm text-gray-500">
                         No projects match your filters.
                       </td>
                     </tr>
                  ) : (
                    paginatedProjects.map((p) => (
                      <tr key={p.id} className={`border-b border-gray-100 last:border-0 transition-colors ${getStatusRowClass(normalizeProjectStatus(p.status, p.analysisStatus))} hover:brightness-95`}>
                        <td className="py-4 px-2">
                          <Link to={getProjectWorkspacePath(p)} className="flex items-center gap-2 group">
                            <Folder size={18} className="text-gray-700" />
                            <div>
                              <p className="text-sm font-medium text-gray-800 group-hover:text-red-500 transition">
                                {p.projectName}
                              </p>
                              <p className="text-xs text-gray-500">
                                Ref: {p.referenceNumber || p.projectCode || "-"}
                              </p>
                            </div>
                          </Link>
                        </td>

                        <td className="py-4 px-2 text-gray-700">
                          {p.customerName || "-"}
                        </td>

                        <td className="py-4 px-2 text-gray-700">
                          {p.poc || "-"}
                        </td>

                        <td className="py-4 px-2 whitespace-nowrap min-w-[140px]">
                          <div className="space-y-1">
                            <StatusBadge
                              status={normalizeProjectStatus(p.status, p.analysisStatus)}
                              audience="estimator"
                            />
                            {p.revisionRequest && (
                              <p className="max-w-[180px] truncate text-xs text-orange-800" title={p.revisionRequest.reason ?? undefined}>
                                Stage {p.revisionRequest.stage}{p.revisionRequest.reason ? ` · ${p.revisionRequest.reason}` : " · Revision in progress"}
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="py-4 px-2 text-gray-700">
                          <Link to={getProjectWorkspacePath(p)} className="text-blue-600 hover:underline">
                            Open Workspace
                          </Link>
                        </td>

                        <td className={`py-4 px-2 whitespace-nowrap ${getUrgencyColor(p.dueDate)}`}>
                          {p.dueDate || "-"}
                        </td>

                        <td className="py-4 px-2 text-gray-600 whitespace-nowrap">
                          {p.lastUpdate || (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={totalPages}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              total={total}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </>
        )}
      </section>
    </div>
  );
}
