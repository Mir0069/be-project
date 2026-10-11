// components/layout/Topbar.tsx

import { Bell, User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const Topbar = () => {
  const { user } = useAuth();

  const fullName =
    user?.firstName || user?.lastName
      ? `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()
      : "User";

  return (
    <header className="w-full bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-end gap-6">
      <button
        type="button"
        aria-label="Notifications"
        className="relative text-red-500 hover:text-red-600 transition"
      >
        <Bell size={20} />
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-800">
          {fullName}
        </span>
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
          <UserIcon size={18} />
        </div>
      </div>
    </header>
  );
};

export default Topbar;
