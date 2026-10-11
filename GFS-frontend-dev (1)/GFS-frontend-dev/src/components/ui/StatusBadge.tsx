// components/ui/StatusBadge.tsx
// Shared status badge — compact pill-shaped status label.

import type { ProjectStatus } from "@/shared/types/project.types";
import {
  getProjectStatusLabel,
  getStatusBadgeClass,
  getStatusConfig,
  normalizeProjectStatus,
  type StatusAudience,
} from "@/shared/lib/statusConfig";

type Props = {
  status: ProjectStatus;
  className?: string;
  audience?: StatusAudience;
  hasAssignedEstimator?: boolean;
};

const StatusBadge = ({ status, className = "", audience = "default", hasAssignedEstimator }: Props) => {
  const displayStatus = normalizeProjectStatus(status, undefined, hasAssignedEstimator);
  const config = getStatusConfig(displayStatus);

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(displayStatus)} ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.dotClass}`}
        aria-hidden="true"
      />
      <span>{getProjectStatusLabel(displayStatus, audience)}</span>
    </span>
  );
};

export default StatusBadge;
