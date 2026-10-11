import { X } from "lucide-react";

import type {
  NotificationView,
  ProjectCreatedPayload,
} from "@/shared/types/notification.types";
import { getSourceMeta, getTypeMeta } from "@/features/notifications/utils";

type Props = {
  notification: NotificationView;
  onClick: (notification: NotificationView) => void;
  onDismiss: (notification: NotificationView) => void;
  dismissible?: boolean;
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
};

const NotificationItem = ({ notification, onClick, onDismiss, dismissible = true }: Props) => {
  const payload = (notification.payload ?? {}) as ProjectCreatedPayload;
  const sourceMeta = getSourceMeta(payload.creationSource);
  const typeMeta = getTypeMeta(notification.type);
  const referenceNumber = payload.referenceNumber;
  const zohoLeadId = payload.zohoLeadId;
  const leadName = payload.leadName;
  const projectName = payload.projectName;
  const teamMemberName = (payload as ProjectCreatedPayload & { memberName?: unknown }).memberName;
  const teamsMemberMessage = notification.type === "TEAMS_MEMBER_NOT_ADDED"
    && typeof teamMemberName === "string"
    && teamMemberName.trim()
    ? `${teamMemberName} could not be added to this project's Teams workspace. Add the member manually in Teams.`
    : notification.message;
  const hasMeta = Boolean(sourceMeta || typeMeta || referenceNumber || zohoLeadId || leadName);

  return (
    <div
      className={`group flex items-start gap-3 px-6 py-4 transition-colors animate-fade-in ${
        notification.isRead ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"
      }`}
    >
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          notification.isRead ? "bg-transparent" : "bg-red-500"
        }`}
      />

      <button
        type="button"
        onClick={() => onClick(notification)}
        className="flex-1 min-w-0 text-left"
      >
        <span className="flex items-center justify-between gap-3">
          <span
            className={`truncate ${
              notification.isRead
                ? "font-medium text-gray-700"
                : "font-semibold text-gray-900"
            }`}
          >
            {notification.title}
          </span>
          <span className="text-xs text-gray-500 shrink-0">
            {formatTime(notification.createdAt)}
          </span>
        </span>
        {projectName && notification.type !== "PROPOSAL_APPROVAL_REQUESTED" && (
          <span className="block text-sm font-semibold text-gray-900 mt-1">
            {projectName}
          </span>
        )}
        <span className="block text-sm text-gray-700 mt-0.5">{teamsMemberMessage}</span>

        {hasMeta && (
          <span className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
            {typeMeta && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ring-1 ring-inset ${typeMeta.className}`}
              >
                {typeMeta.label}
              </span>
            )}
            {sourceMeta && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ring-1 ring-inset ${sourceMeta.className}`}
              >
                {sourceMeta.label}
              </span>
            )}
            {referenceNumber && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1">
                <span className="font-semibold text-gray-700">Project</span>
                <span className="font-mono text-gray-600">{referenceNumber}</span>
              </span>
            )}
            {leadName && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1">
                <span className="font-semibold text-gray-700">Lead Name</span>
                <span className="text-gray-600">{leadName}</span>
              </span>
            )}
            {zohoLeadId && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1">
                <span className="font-semibold text-gray-700">Lead ID</span>
                <span className="font-mono text-gray-600">{zohoLeadId}</span>
              </span>
            )}
          </span>
        )}
      </button>

      {dismissible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification);
          }}
          aria-label="Dismiss notification"
          title="Dismiss"
          className="mt-0.5 shrink-0 rounded-md p-1.5 text-gray-300 transition hover:bg-red-50 hover:text-red-500 focus-visible:text-red-500"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
};

export default NotificationItem;
