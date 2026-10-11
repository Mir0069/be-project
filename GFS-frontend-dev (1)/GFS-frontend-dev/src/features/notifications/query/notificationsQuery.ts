import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchNotifications,
  fetchUnreadDraftAlertCount,
  fetchUnreadCount,
  clearAllMailNotifications,
  markAllDraftAlertsRead,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/notifications";
import type { FetchNotificationsParams } from "@/services/notifications";

export const NOTIFICATIONS_KEY = ["notifications"] as const;
export const UNREAD_COUNT_KEY = ["notifications", "unread"] as const;
export const UNREAD_DRAFT_ALERT_COUNT_KEY = ["notifications", "draft-alerts", "unread"] as const;
const NOTIFICATIONS_POLL_INTERVAL_MS = 30_000;

export const useNotifications = (params: FetchNotificationsParams = {}) =>
  useQuery({
    queryKey: [...NOTIFICATIONS_KEY, params],
    queryFn: () => fetchNotifications(params),
    // SSE is the primary delivery path; polling is a bounded fallback for
    // reconnects and deployments where the stream is temporarily unavailable.
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
  });

export const useUnreadCount = () =>
  useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: fetchUnreadCount,
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
  });

export const useUnreadDraftAlertCount = () =>
  useQuery({
    queryKey: UNREAD_DRAFT_ALERT_COUNT_KEY,
    queryFn: fetchUnreadDraftAlertCount,
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
  });

export const useMarkAsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_DRAFT_ALERT_COUNT_KEY });
    },
  });
};

export const useMarkAllAsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_DRAFT_ALERT_COUNT_KEY });
    },
  });
};

export const useMarkAllDraftAlertsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllDraftAlertsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      qc.setQueryData(UNREAD_DRAFT_ALERT_COUNT_KEY, 0);
      qc.invalidateQueries({ queryKey: UNREAD_DRAFT_ALERT_COUNT_KEY });
    },
  });
};

export const useClearAllMail = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearAllMailNotifications,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_DRAFT_ALERT_COUNT_KEY });
    },
  });
};
