// components/ui/Sidebar.tsx

import { NavLink } from "react-router-dom";
import {
  LogOutIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useLogout } from "@/features/auth/query/authQuery";
import { clearStoredAccessToken } from "@/services/auth";
import { queryClient } from "@/providers/QueryProvider";
import { showToast } from "@/components/ui/toast";
import { useLocation } from "react-router-dom";
import { getSidebarItemsForPath } from "./sidebarItems";


const Sidebar = () => {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const logoutMutation = useLogout();
  const location = useLocation();

  const sidebarItems = getSidebarItemsForPath(location.pathname, role);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: (response) => {
        clearStoredAccessToken();
        queryClient.setQueryData(
          ["auth", "me"],
          null
        );

        queryClient.removeQueries({
          queryKey: ["auth", "me"],
        });

        showToast(
          "success",
          response.message ||
          "Logged out successfully"
        );

        navigate("/login", {
          replace: true,
        });
      },

      onError: (error: unknown) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 401) {
          clearStoredAccessToken();
          queryClient.setQueryData(["auth", "me"], null);
          queryClient.removeQueries({ queryKey: ["auth", "me"] });
          navigate("/login", { replace: true });
          return;
        }

        showToast(
          "error",
          error instanceof Error ? error.message : "Logout failed"
        );
      },
    });
  };

  return (
    <aside className="w-[250px] min-h-screen bg-white border-r border-gray-300 flex flex-col justify-between">
      <div>
        {/* smartmfgAI LOGO */}
        <div className="flex justify-center py-4">
          <img
            src="/gfs.png"
            alt="smartmfgai-logo"
            className="w-24"
          />
        </div>

        <hr className="border-gray-300" />

        {/* Navigation Tabs */}
        <nav className="px-3 py-4 space-y-3">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-4 px-3 py-1.5 rounded-sm font-medium transition-all ${isActive
                  ? "bg-red-500 text-white"
                  : "text-red-500 hover:ring-1 hover:ring-red-500"
                }`
              }
            >
              {item.icon}
              <span>{item.label}</span>
              {item.trailing}
            </NavLink>
          ))}
        </nav>
      </div>

      <div>
        <hr className="border-gray-200 border-1" />


        <div className="flex items-center justify-between px-4 py-2 mb-1">

          {/* Left section: Avatar + User info */}
          <div className="flex items-center gap-3">

            {/* Initials */}
            <div className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500 text-white font-semibold text-sm shrink-0">
              {user?.firstName?.charAt(0)}
              {user?.lastName?.charAt(0)}
            </div>

            {/* Name + Role */}
            <div className="flex flex-col">
              <h3 className="text-base font-semibold text-red-500 leading-tight">
                {user?.firstName} {user?.lastName}
              </h3>

              <p className="text-[13px] text-gray-500 leading-[1.2rem]">
                {role
                  ?.toLowerCase()
                  .split("_")
                  .map(
                    (word) =>
                      word.charAt(0).toUpperCase() +
                      word.slice(1)
                  )
                  .join(" ")}
              </p>
            </div>

          </div>

          {/* Logout button */}
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            className="flex items-center justify-center p-2 text-red-500 rounded-md hover:bg-red-100 transition"
          >
            <LogOutIcon size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
