import type {
  NotificationType,
  NotificationView,
  ProjectCreationSource,
} from "@/shared/types/notification.types";

type BadgeMeta = { label: string; className: string };

export const SOURCE_META: Record<ProjectCreationSource, BadgeMeta> = {
  MAIL_FIRST: {
    label: "From Mail",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  ZOHO_FIRST: {
    label: "From Zoho",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  MANUAL: {
    label: "Manual",
    className: "bg-gray-100 text-gray-600 ring-gray-200",
  },
};

export const TYPE_META: Partial<Record<NotificationType, BadgeMeta>> = {
  DRAFT_REQUIRES_REVIEW: {
    label: "New opportunity",
    className: "bg-red-50 text-red-700 ring-red-200",
  },
  CLOUD_LINK_FAILED: {
    label: "Action required",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  PROJECT_ASSIGNED: {
    label: "Assigned",
    className: "bg-green-50 text-green-700 ring-green-200",
  },
  MAIL_LINKED: {
    label: "New Mail",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  TEAMS_WORKSPACE_CREATED: {
    label: "Teams",
    className: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  },
  DROPBOX_WORKSPACE_CREATED: {
    label: "Dropbox",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  // Amber, not indigo: this one is a request for the user to act.
  TEAMS_WORKSPACE_NEEDS_DECISION: {
    label: "Teams action",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  // Someone could not be added to the project's team and must be added by hand.
  TEAMS_MEMBER_NOT_ADDED: {
    label: "Teams action",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  DOCS_PROCESSING: {
    label: "AI Extraction Processing",
    className: "bg-blue-50 text-blue-700 ring-blue-200 animate-pulse",
  },
  DOCS_PROCESSED: {
    label: "Ready for Estimation",
    className: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  PROJECT_COMPLETED: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  PROPOSAL_APPROVAL_REQUESTED: {
    label: "Approval requested",
    className: "bg-red-50 text-red-700 ring-red-200",
  },
  DOCUMENT_ADDED: {
    label: "New Document",
    className: "bg-purple-50 text-purple-700 ring-purple-200",
  },
};

export const getSourceMeta = (source?: string | null): BadgeMeta | null =>
  source && source in SOURCE_META ? SOURCE_META[source as ProjectCreationSource] : null;

export const getTypeMeta = (type: NotificationType): BadgeMeta | null =>
  TYPE_META[type] ?? null;

export const getNotificationDestination = (
  notification: Pick<NotificationView, "type" | "projectId"> &
    Partial<Pick<NotificationView, "payload">>,
): string | null => {
  const referenceNumber = (notification.payload as { referenceNumber?: unknown } | null)
    ?.referenceNumber;
  const projectKey = typeof referenceNumber === "string" && referenceNumber.trim()
    ? referenceNumber.trim()
    : notification.projectId;

  // Send users to the closest place where the failed document can be recovered.
  if (notification.type === "CLOUD_LINK_FAILED" || notification.type === "DOCUMENT_ADDED") {
    return projectKey
      ? `/projects/${encodeURIComponent(projectKey)}/documents`
      : "/sales-manager/drafts";
  }

  if (notification.type === "DRAFT_REQUIRES_REVIEW") {
    return "/sales-manager/drafts";
  }

  if (notification.type === "PROPOSAL_APPROVAL_REQUESTED") {
    return projectKey ? `/projects/${encodeURIComponent(projectKey)}/final-parameters` : null;
  }

  return projectKey ? `/projects/${encodeURIComponent(projectKey)}` : null;
};
