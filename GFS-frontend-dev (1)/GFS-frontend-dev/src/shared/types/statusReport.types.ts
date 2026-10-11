export type StatusReportPeriod = "weekly" | "monthly" | "ytd";
export type StatusReportMetric = { count: number; value: number };
export type StatusReport = {
  period: { period: StatusReportPeriod; year: number; compareYear?: number };
  scope: { from: string; to: string };
  pipeline: { total: StatusReportMetric; byStatus: Record<string, StatusReportMetric> };
  comparison: { year: number; total: StatusReportMetric; change: StatusReportMetric } | null;
  valueBands: Array<{ label: string; count: number; value: number }>;
  competitive: { projectCount: number; groupCount: number; bidderCount: number; groups: Array<{ groupId: string; projectCount: number; value: number }>; projects: Array<{ referenceNumber: string; projectName: string; vendor: string; estimator: string; value: number; quoteDate: string | null }> };
  partners: { projectCount: number; available: boolean; projects: Array<{ referenceNumber: string; partnerName: string; bidCount: number | null; bidValue: number | null; submittedBidCount: number | null; submittedValue: number | null; pendingBidCount: number | null; pendingValue: number | null }> };
};
