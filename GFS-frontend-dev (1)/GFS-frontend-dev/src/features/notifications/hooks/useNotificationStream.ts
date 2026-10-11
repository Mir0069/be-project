import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { showToast } from "@/components/ui/toast";
import {
  NOTIFICATIONS_KEY,
  UNREAD_DRAFT_ALERT_COUNT_KEY,
  UNREAD_COUNT_KEY,
} from "@/features/notifications/query/notificationsQuery";
import { getSourceMeta } from "@/features/notifications/utils";
import type {
  NotificationView,
  ProjectCreatedPayload,
} from "@/shared/types/notification.types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export const useNotificationStream = () => {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    const streamUrl = token
      ? `${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`
      : `${API_BASE_URL}/notifications/stream`;

    const source = new EventSource(streamUrl, {
      withCredentials: true,
    });

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as {
          type: string;
          data?: NotificationView;
        };

        if (parsed.type === "NOTIFICATION_CREATED") {
          queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
          queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
          queryClient.invalidateQueries({ queryKey: UNREAD_DRAFT_ALERT_COUNT_KEY });
          if (parsed.data) {
            const payload = (parsed.data.payload ?? {}) as ProjectCreatedPayload;
            const sourceMeta = payload.creationSource ? getSourceMeta(payload.creationSource) : null;
            let message = parsed.data.title;
            if (parsed.data.message) {
              const lowerTitle = parsed.data.title.toLowerCase();
              const lowerMessage = parsed.data.message.toLowerCase();
              // If title and message start with similar words (e.g. New document / New document added), avoid repeating title
              if (lowerMessage.startsWith(lowerTitle.substring(0, 10)) || lowerMessage.includes(lowerTitle)) {
                message = parsed.data.message;
              } else {
                message = `${parsed.data.title} — ${parsed.data.message}`;
              }
            } else if (sourceMeta) {
              message = `${parsed.data.title} · ${sourceMeta.label}`;
            }
            showToast("success", message);
          }
        }
      } catch {
        return;
      }
    };

    return () => {
      source.close();
    };
  }, [isAuthenticated, queryClient]);
};
