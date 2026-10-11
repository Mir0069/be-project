// shared/lib/statusConfig.ts

import type { ProjectStatus } from "@/shared/types/project.types";

export type StatusStyle = {
  label: string;
  badgeClass: string;
  rowBgClass: string;
  dotClass: string;
};

export type StatusAudience = "default" | "estimator";

const STATUS_CONFIG: Record<ProjectStatus, StatusStyle> = {
  "Input Pending": {
    label: "Input Pending",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    rowBgClass: "bg-yellow-50/50",
    dotClass: "bg-amber-500",
  },
  Pending: {
    label: "Input Pending",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    rowBgClass: "bg-yellow-50/50",
    dotClass: "bg-amber-500",
  },
  "AI Extraction In Progress": {
    label: "AI Extraction In Progress",
    badgeClass: "bg-cyan-50 text-cyan-800 border-cyan-200",
    rowBgClass: "bg-cyan-50/40",
    dotClass: "bg-cyan-500",
  },
  "Ready for Estimation": {
    label: "Ready for Estimation",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    rowBgClass: "bg-sky-50/50",
    dotClass: "bg-sky-500",
  },
  "Needs Revision": {
    label: "Needs Revision",
    badgeClass: "bg-orange-50 text-orange-800 border-orange-200",
    rowBgClass: "bg-orange-50/60",
    dotClass: "bg-orange-500",
  },
  "In-progress": {
    label: "In Progress",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    rowBgClass: "bg-blue-50/50",
    dotClass: "bg-blue-500",
  },
  Completed: {
    label: "Completed",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rowBgClass: "bg-green-50/50",
    dotClass: "bg-emerald-500",
  },
  "Not started": {
    label: "Not Started",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
    rowBgClass: "bg-red-50/50",
    dotClass: "bg-red-500",
  },
};

const FALLBACK: StatusStyle = {
  label: "Unknown",
  badgeClass: "bg-gray-50 text-gray-700 border-gray-200",
  rowBgClass: "bg-gray-50/50",
  dotClass: "bg-gray-400",
};

export const normalizeProjectStatus = (
  status?: string | null,
  analysisStatus?: string | null,
  hasAssignedEstimator?: boolean,
): ProjectStatus => {
  if (!status || typeof status !== "string") return "Not started";
  const normalized = status.trim().toUpperCase();
  // A revision remains the user-facing priority even while AI reprocesses it.
  if (["NEEDS_REVISION", "NEEDS REVISION"].includes(normalized)) return "Needs Revision";
  if (["COMPLETED", "COMPLETE", "APPROVED", "ADMIN_PACKAGING"].includes(normalized)) return "Completed";
  if (["IN_PROGRESS", "ESTIMATOR_DRAFTING", "ESTIMATOR_FINAL", "ANALYSIS_IN_PROGRESS"].includes(normalized)) {
    // Assignment is required before estimator work can truly begin. This is a
    // presentation rule only; it deliberately does not update workflow state.
    return hasAssignedEstimator === false ? "Not started" : "In-progress";
  }
  if (normalized === "READY_FOR_ESTIMATOR") return "Ready for Estimation";
  if (typeof analysisStatus === "string" && analysisStatus.trim().toUpperCase() === "PROCESSING") return "AI Extraction In Progress";
  if (["INPUT PENDING", "WAITING_FOR_INPUTS", "WAITING_FOR_APPROVAL", "PENDING"].includes(normalized)) return "Input Pending";
  if (["AI EXTRACTION IN PROGRESS", "AI_PROCESSING", "PROCESSING"].includes(normalized)) return "AI Extraction In Progress";
  if (["NOT_STARTED", "NOT STARTED", "SETUP_PENDING", "NEW", "DRAFT"].includes(normalized)) return "Not started";
  if (status in STATUS_CONFIG) return status as ProjectStatus;
  return "Input Pending";
};

export const getStatusConfig = (status: ProjectStatus): StatusStyle =>
  STATUS_CONFIG[status] ?? FALLBACK;

export const getProjectStatusLabel = (
  status: ProjectStatus,
  audience: StatusAudience = "default",
): string => {
  if (audience === "estimator" && status === "Ready for Estimation") {
    return "Awaiting Estimator Review";
  }

  return getStatusConfig(status).label;
};

export const getStatusBadgeClass = (status: ProjectStatus): string =>
  getStatusConfig(status).badgeClass;

export const getStatusRowClass = (status: ProjectStatus): string =>
  getStatusConfig(status).rowBgClass;
