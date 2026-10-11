import { apiClient } from "@/shared/api/client";
import type { ApiResponse } from "@/shared/api/types";
import type { StatusReport, StatusReportPeriod } from "@/shared/types/statusReport.types";
export const fetchStatusReport = async (params: { period: StatusReportPeriod; year: number; compareYear?: number }): Promise<StatusReport> => {
  const query = new URLSearchParams({ period: params.period, year: String(params.year) });
  if (params.compareYear !== undefined) query.set("compareYear", String(params.compareYear));
  const { data } = await apiClient.get<ApiResponse<StatusReport>>(`/reports/status-report?${query}`);
  if (!data.success || !data.data) throw new Error("Status report could not be loaded");
  return data.data;
};
