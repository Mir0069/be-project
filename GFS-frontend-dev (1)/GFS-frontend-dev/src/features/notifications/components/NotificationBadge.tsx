import { useUnreadCount } from "@/features/notifications/query/notificationsQuery";

const NotificationBadge = () => {
  const { data: count = 0 } = useUnreadCount();

  if (!count) return null;

  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-gray-900 text-white text-[11px] font-semibold ring-2 ring-white">
      {count}
    </span>
  );
};

export default NotificationBadge;
