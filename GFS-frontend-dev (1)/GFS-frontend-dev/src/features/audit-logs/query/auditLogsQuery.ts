import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  fetchAuditLogs,
  type FetchAuditLogsParams,
} from "@/services/audit-logs";

export const AUDIT_LOGS_KEY = ["audit-logs"] as const;

export const useAuditLogs = (params: FetchAuditLogsParams = {}) => {
  const { user, role } = useAuth();
  return useQuery({
    queryKey: [...AUDIT_LOGS_KEY, user?.id, role, params],
    enabled: Boolean(user?.id) && (role !== "ESTIMATOR" || Boolean(params.projectId)),
    queryFn: () => fetchAuditLogs(params),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
};
