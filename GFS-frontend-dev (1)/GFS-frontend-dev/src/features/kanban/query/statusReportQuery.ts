import { useQuery } from "@tanstack/react-query";
import { fetchStatusReport } from "@/services/status-report";
import type { StatusReportPeriod } from "@/shared/types/statusReport.types";
export const useStatusReport = (period: StatusReportPeriod, year: number, compareYear: number, viewerKey?: string) => useQuery({
  // The report is role-scoped on the backend, so the authenticated viewer is
  // part of the cache key to prevent cross-account data reuse in one session.
  queryKey: ["status-report", period, year, compareYear, viewerKey],
  queryFn: () => fetchStatusReport({ period, year, compareYear }),
  enabled: viewerKey !== undefined,
  refetchOnMount: "always",
});
