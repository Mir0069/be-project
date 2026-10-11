import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff } from "lucide-react";

import {
  useMarkAllAsRead,
  useMarkAsRead,
  useNotifications,
} from "@/features/notifications/query/notificationsQuery";
import NotificationItem from "@/features/notifications/components/NotificationItem";
import Pagination from "@/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { usePagination } from "@/hooks/usePagination";
import {
  dismissNotification,
  getDismissedIds,
  restoreNotification,
} from "@/utils/dismissedNotifications";
import type { NotificationView } from "@/shared/types/notification.types";
import { getNotificationDestination } from "@/features/notifications/utils";
import { fetchProjectDetail } from "@/services/project-workspace";
import { useAuth } from "@/context/AuthContext";
import { hasAnyRole } from "@/shared/lib/roleAccess";

const PER_PAGE = 15;

const NotificationsPage = () => {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useNotifications({ limit: 100 });
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const { role } = useAuth();
  const isSalesManager = hasAnyRole(role, ["SALES_MANAGER"]);

  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissedIds());
  const [undoMailDismissal, setUndoMailDismissal] = useState<NotificationView | null>(null);

  const businessItems = useMemo(() => data?.items ?? [], [data]);
  const opportunities = useMemo(
    () => isSalesManager ? businessItems.filter(
      (notification) => notification.type === "DRAFT_REQUIRES_REVIEW"
        && notification.opportunityStatus === "OPEN"
        && !dismissed.has(notification.id)
    ) : [],
    [businessItems, dismissed, isSalesManager]
  );
  const approvalRequests = useMemo(
    () => isSalesManager ? businessItems.filter(
      (notification) => notification.type === "PROPOSAL_APPROVAL_REQUESTED"
        && !dismissed.has(notification.id)
    ) : [],
    [businessItems, dismissed, isSalesManager]
  );
  const projectItems = useMemo(() => {
    // The API returns newest first. Keep the latest feed item per project so
    // a project's notifications describe its current state instead of a
    // growing sequence of superseded events.
    const projectsWithVisibleNotification = new Set<string>();

    return businessItems.filter((notification) => {
      if (
        notification.type === "DRAFT_REQUIRES_REVIEW"
        || notification.type === "PROPOSAL_APPROVAL_REQUESTED"
        || dismissed.has(notification.id)
      ) {
        return false;
      }

      if (!notification.projectId) return true;
      if (projectsWithVisibleNotification.has(notification.projectId)) return false;

      projectsWithVisibleNotification.add(notification.projectId);
      return true;
    });
  }, [businessItems, dismissed]);
  const unreadCount = [...opportunities, ...approvalRequests, ...projectItems]
    .filter((notification) => !notification.isRead).length;
  const totalUnread = data?.unreadCount ?? unreadCount;
  const { page, totalPages, pageItems, rangeStart, rangeEnd, total, next, prev } =
    usePagination(projectItems, PER_PAGE);

  const handleClick = async (notification: NotificationView) => {
    if (!notification.isRead) markAsRead.mutate(notification.id);

    let routableNotification = notification;
    const hasPublicReference = typeof notification.payload?.referenceNumber === "string"
      && notification.payload.referenceNumber.trim().length > 0;

    if (notification.projectId && !hasPublicReference) {
      try {
        const project = await fetchProjectDetail(notification.projectId);
        // Older notifications only stored the Mongo ID. Resolve it before
        // navigating so the internal identifier never needs to enter the URL.
        routableNotification = {
          ...notification,
          payload: {
            ...(notification.payload ?? {}),
            referenceNumber: project.referenceNumber,
          },
        };
      } catch {
        // Keep legacy notification navigation operational if resolution fails.
      }
    }

    const destination = getNotificationDestination(routableNotification);
    if (destination) navigate(destination);
  };

  const handleDismiss = (notification: NotificationView) => {
    if (!notification.isRead) markAsRead.mutate(notification.id);
    dismissNotification(notification.id);
    setDismissed((prev) => new Set(prev).add(notification.id));
    if (notification.type === "MAIL_LINKED") setUndoMailDismissal(notification);
  };

  const handleUndoMailDismissal = () => {
    if (!undoMailDismissal) return;
    restoreNotification(undoMailDismissal.id);
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(undoMailDismissal.id);
      return next;
    });
    setUndoMailDismissal(null);
  };

  const newOpportunitiesSection = isSalesManager ? (
    <section
      aria-labelledby="new-opportunities-heading"
      className={opportunities.length === 0 ? "border-t border-gray-200" : undefined}
    >
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-3">
        <div>
          <h2 id="new-opportunities-heading" className="text-sm font-semibold text-gray-900">
            New Opportunities
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">Awaiting project creation</p>
        </div>
        <span className="text-xs font-semibold text-red-600">{opportunities.length}</span>
      </div>

      {opportunities.length === 0 ? (
        <p className="px-6 py-5 text-sm text-gray-500">No new opportunities.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {opportunities.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onClick={handleClick}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </section>
  ) : null;

  return (
    <div className="w-full">
      <div className="flex min-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-red-500" />
              <h1 className="text-lg font-semibold text-gray-900">Notifications</h1>
            </div>
            {totalUnread > 0 && (
              <p className="mt-1 text-sm text-gray-500">
                {totalUnread} unread notification{totalUnread === 1 ? "" : "s"}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => markAllAsRead.mutate()}
              disabled={totalUnread === 0 || markAllAsRead.isPending}
              aria-label={`Mark all ${totalUnread} unread notifications as read`}
              title="Marks all notifications, including email alerts, as read"
              className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300"
            >
              {markAllAsRead.isPending ? "Marking..." : "Mark all as read"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {undoMailDismissal && (
            <div className="flex items-center justify-between gap-4 border-b border-blue-100 bg-blue-50 px-6 py-3 text-sm text-gray-700">
              <span>Email alert dismissed.</span>
              <button
                type="button"
                onClick={handleUndoMailDismissal}
                className="font-semibold text-blue-700 transition-colors hover:text-blue-900"
              >
                Undo
              </button>
            </div>
          )}
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm font-medium text-gray-700">Could not load notifications.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Retry
              </button>
            </div>
          ) : opportunities.length === 0 && approvalRequests.length === 0 && projectItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center animate-fade-in">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
                <BellOff size={26} />
              </span>
              <p className="text-sm font-medium text-gray-700">You're all caught up</p>
              <p className="text-xs text-gray-400">New notifications will show up here.</p>
            </div>
          ) : (
            <>
              {opportunities.length > 0 && newOpportunitiesSection}

              {isSalesManager && approvalRequests.length > 0 && (
                <section aria-labelledby="approval-requests-heading" className="border-t border-gray-200">
                  <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-3">
                    <div>
                      <h2 id="approval-requests-heading" className="text-sm font-semibold text-gray-900">
                        Approval Requests
                      </h2>
                    </div>
                    <span className="text-xs font-semibold text-red-600">{approvalRequests.length}</span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {approvalRequests.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onClick={handleClick}
                        onDismiss={handleDismiss}
                      />
                    ))}
                  </div>
                </section>
              )}

              {projectItems.length > 0 && (
                <section aria-labelledby="project-notifications-heading" className="border-t border-gray-200">
                  <div className="border-b border-gray-100 bg-gray-50 px-6 py-3">
                    <h2 id="project-notifications-heading" className="text-sm font-semibold text-gray-900">
                      Project Notifications
                    </h2>
                  </div>

                  {pageItems.length === 0 ? (
                    <p className="px-6 py-5 text-sm text-gray-500">No project notifications.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {pageItems.map((notification) => (
                        <NotificationItem
                          key={notification.id}
                          notification={notification}
                          onClick={handleClick}
                          onDismiss={handleDismiss}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {isSalesManager && approvalRequests.length === 0 && (
                <section aria-labelledby="approval-requests-heading" className="border-t border-gray-200">
                  <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-6 py-3">
                    <h2 id="approval-requests-heading" className="text-sm font-semibold text-gray-900">
                      Approval Requests
                    </h2>
                    <span className="text-xs font-semibold text-red-600">0</span>
                  </div>
                  <p className="px-6 py-5 text-sm text-gray-500">No proposals awaiting your approval.</p>
                </section>
              )}

              {projectItems.length === 0 && (
                <section aria-labelledby="project-notifications-heading" className="border-t border-gray-200">
                  <div className="border-b border-gray-100 bg-gray-50 px-6 py-3">
                    <h2 id="project-notifications-heading" className="text-sm font-semibold text-gray-900">
                      Project Notifications
                    </h2>
                  </div>
                  <p className="px-6 py-5 text-sm text-gray-500">No project notifications.</p>
                </section>
              )}

              {opportunities.length === 0 && newOpportunitiesSection}

              {total > 0 && (
                <div className="px-6 pb-4">
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    rangeStart={rangeStart}
                    rangeEnd={rangeEnd}
                    total={total}
                    onPrev={prev}
                    onNext={next}
                    noun="notifications"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsPage;
