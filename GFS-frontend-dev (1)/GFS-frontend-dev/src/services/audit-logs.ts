import { apiClient } from "@/shared/api/client";
import type { ApiResponse } from "@/shared/types/auth.types";
import type {
  AuditLogCategory,
  AuditLogListResult,
} from "@/shared/types/auditLog.types";

export interface FetchAuditLogsParams {
  projectId?: string;
  page?: number;
  limit?: number;
  category?: AuditLogCategory;
  action?: string;
  since?: string;
  actorEmail?: string;
}

const EMPTY_RESULT: AuditLogListResult = {
  items: [],
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 0,
};

export const fetchAuditLogs = async (
  params: FetchAuditLogsParams = {},
): Promise<AuditLogListResult> => {
  const { data } = await apiClient.get<ApiResponse<AuditLogListResult>>(
    "/audit-logs",
    { params },
  );
  return data.data ?? EMPTY_RESULT;
};

export interface DownloadFeedbackHistoryResult {
  blob: Blob;
  fileName: string;
}

export const downloadFeedbackHistory = async (
  projectId: string,
): Promise<DownloadFeedbackHistoryResult> => {
  const response = await apiClient.get<Blob>(
    `/proposals/${encodeURIComponent(projectId)}/feedback/export`,
    { responseType: "blob" },
  );
  const disposition = response.headers["content-disposition"];
  const fileName =
    typeof disposition === "string"
      ? disposition.match(/filename="?([^";]+)"?/i)?.[1]
      : undefined;

  return {
    blob: response.data,
    fileName: fileName ?? `feedback-history-${projectId}.csv`,
  };
};
