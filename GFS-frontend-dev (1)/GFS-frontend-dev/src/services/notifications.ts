import { apiClient } from "@/shared/api/client";

import type { ApiResponse } from "@/shared/types/auth.types";
import type { NotificationListResult } from "@/shared/types/notification.types";

export interface FetchNotificationsParams {
  page?: number;
  limit?: number;
}

const EMPTY_RESULT: NotificationListResult = {
  items: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  unreadCount: 0,
};

export const fetchNotifications = async (
  params: FetchNotificationsParams = {}
): Promise<NotificationListResult> => {
  const { data } = await apiClient.get<ApiResponse<NotificationListResult>>(
    "/notifications",
    { params }
  );
  return data.data ?? EMPTY_RESULT;
};

export const fetchUnreadCount = async (): Promise<number> => {
  const { data } = await apiClient.get<ApiResponse<{ count: number }>>(
    "/notifications/unread-count"
  );
  return data.data?.count ?? 0;
};

export const fetchUnreadDraftAlertCount = async (): Promise<number> => {
  const { data } = await apiClient.get<ApiResponse<{ count: number }>>(
    "/notifications/draft-alerts/unread-count"
  );
  return data.data?.count ?? 0;
};

export const markNotificationRead = async (id: string): Promise<void> => {
  await apiClient.patch<ApiResponse>(`/notifications/${id}/read`);
};

export const markAllNotificationsRead = async (): Promise<number> => {
  const { data } = await apiClient.post<ApiResponse<{ modified: number }>>(
    "/notifications/mark-all-read"
  );
  return data.data?.modified ?? 0;
};

export const markAllDraftAlertsRead = async (): Promise<number> => {
  const { data } = await apiClient.post<ApiResponse<{ modified: number }>>(
    "/notifications/mark-draft-alerts-read"
  );
  return data.data?.modified ?? 0;
};

export const clearAllMailNotifications = async (): Promise<number> => {
  const { data } = await apiClient.post<ApiResponse<{ modified: number }>>(
    "/notifications/clear-all-mail"
  );
  return data.data?.modified ?? 0;
};
