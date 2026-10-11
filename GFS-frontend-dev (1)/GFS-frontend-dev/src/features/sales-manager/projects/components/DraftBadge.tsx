import { useUnreadDraftAlertCount } from "@/features/notifications/query/notificationsQuery";

const DraftBadge = () => {
  const { data: count = 0 } = useUnreadDraftAlertCount();

  if (!count) return null;

  return (
    <span
      aria-label={`${count} unread draft alert${count === 1 ? "" : "s"}`}
      className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-900 px-1.5 text-[11px] font-semibold text-white ring-2 ring-white"
    >
      {count}
    </span>
  );
};

export default DraftBadge;
