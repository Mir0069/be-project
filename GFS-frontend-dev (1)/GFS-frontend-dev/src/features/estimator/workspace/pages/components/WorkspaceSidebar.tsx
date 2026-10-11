import React from "react";
import {
  NavLink,
  useNavigate,
} from "react-router-dom";

import {
  LayoutDashboard,
  FileText,
  Lightbulb,
  SlidersHorizontal,
  Calculator,
  CirclePlus,
  FileSignature,
  CalendarClock,
  ClipboardList,
  LogOutIcon,
  PanelTop,
} from "lucide-react";

import { useLogout } from "@/features/auth/query/authQuery";
import { clearStoredAccessToken } from "@/services/auth";
import { queryClient } from "@/providers/QueryProvider";
import { showToast } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { getWorkflowStageNavigationState } from "@/features/estimator/workspace/utils/workflowStageNavigation";

type WorkspaceTab = {
  label: string;
  path: string;
  icon: React.ReactNode;
};

const TABS: WorkspaceTab[] = [
  {
    label: "Project Overview",
    path: "dashboard",
    icon: <LayoutDashboard size={18} />,
  },
  {
    label: "Documents",
    path: "documents",
    icon: <FileText size={18} />,
  },
  {
    label: "AI Insight",
    path: "ai-insight",
    icon: <Lightbulb size={18} />,
  },
  {
    label: "Project Header",
    path: "header",
    icon: <PanelTop size={18} />,
  },
  {
    label: "Glass Type",
    path: "glass-type",
    icon: <Calculator size={18} />,
  },
  {
    label: "Frame Type",
    path: "frame-type",
    icon: <Calculator size={18} />,
  },
  {
    label: "Parameters",
    path: "parameters",
    icon: <SlidersHorizontal size={18} />,
  },
  {
    label: "Addons",
    path: "addons",
    icon: <CirclePlus size={18} />,
  },
 
  {
    label: "Final Parameters",
    path: "final-parameters",
    icon: <SlidersHorizontal size={18} />,
  },
   {
    label: "Proposal",
    path: "proposal",
    icon: <FileSignature size={18} />,
  },
  {
    label: "Timeline",
    path: "timeline",
    icon: <CalendarClock size={18} />,
  },
  {
    label: "Audit Log",
    path: "audit-logs",
    icon: <ClipboardList size={18} />,
  },
];

const WorkspaceSidebar = () => {
  const navigate = useNavigate();
  const { publicProjectKey } = useProjectRoute();

  const { user, role } =
    useAuth();

  const logoutMutation =
    useLogout();

  const handleLogout = () => {
    logoutMutation.mutate(
      undefined,
      {
        onSuccess: (
          response
        ) => {
          clearStoredAccessToken();
          queryClient.setQueryData(
            ["auth", "me"],
            null
          );

          queryClient.removeQueries(
            {
              queryKey: [
                "auth",
                "me",
              ],
            }
          );

          showToast(
            "success",
            response.message ||
            "Logged out successfully"
          );

          navigate(
            "/login",
            {
              replace: true,
            }
          );
        },

        onError: (
          error: unknown
        ) => {
          const status = (error as { status?: number } | null)?.status;
          if (status === 401) {
            clearStoredAccessToken();
            queryClient.setQueryData(["auth", "me"], null);
            queryClient.removeQueries({ queryKey: ["auth", "me"] });
            navigate("/login", { replace: true });
            return;
          }

          const message =
            error instanceof Error
              ? error.message
              : "Logout failed";

          showToast(
            "error",
            message
          );
        },
      }
    );
  };

  return (
    <aside className="flex h-full min-h-0 w-[250px] flex-col border-r border-gray-300 bg-white">

      {/* TOP SECTION */}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* LOGO */}

        <div className="flex shrink-0 justify-center py-4">
          <img
            src="/gfs.png"
            alt="smartmfgai-logo"
            className="w-24"
          />
        </div>

        <hr className="border-gray-300" />

        {/* NAVIGATION */}

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">

          {TABS.map(
            (tab) => (
              <NavLink
                key={
                  tab.path
                }
                to={`/projects/${encodeURIComponent(publicProjectKey ?? "")}/${tab.path}`}
                state={getWorkflowStageNavigationState(tab.path)}
                className={({
                  isActive,
                }) =>
                  `
                flex
                items-center
                gap-4
                px-3
                py-2
                rounded
                text-[17px]
                font-semibold
                transition-all
                ${isActive
                    ? "bg-red-500 text-white shadow-sm"
                    : "text-red-500 hover:ring-1 hover:ring-red-500"
                  }
              `
                }
              >
                {tab.icon}

                <span>
                  {
                    tab.label
                  }
                </span>
              </NavLink>
            )
          )}

        </nav>

      </div>

      {/* BOTTOM USER SECTION */}

      <div className="shrink-0">

        <hr className="border-gray-300" />

        <div className="flex items-center justify-between px-4 pb-4 pt-3">

          {/* USER INFO */}

          <div className="flex items-center gap-3">

            {/* Avatar */}

            <div
              className="
                w-11
                h-11
                rounded-full
                bg-red-500
                text-white
                flex
                items-center
                justify-center
                font-semibold
                text-sm
                shrink-0
              "
            >
              {user?.firstName?.charAt(
                0
              )}
              {user?.lastName?.charAt(
                0
              )}
            </div>

            {/* NAME + ROLE */}

            <div className="flex flex-col">

              <h3
                className="
                  text-base
                  font-semibold
                  text-red-500
                  leading-tight
                "
              >
                {
                  user?.firstName
                }{" "}
                {
                  user?.lastName
                }
              </h3>

              <p
                className="
                  text-[13px]
                  text-gray-500
                  leading-[1.2rem]
                "
              >
                {role
                  ?.toLowerCase()
                  .split(
                    "_"
                  )
                  .map(
                    (
                      word
                    ) =>
                      word.charAt(
                        0
                      ).toUpperCase() +
                      word
                        .slice(
                          1
                        )
                  )
                  .join(
                    " "
                  )}
              </p>

            </div>

          </div>

          {/* LOGOUT */}

          <button
            type="button"
            onClick={
              handleLogout
            }
            disabled={
              logoutMutation.isPending
            }
            className="
              flex
              items-center
              justify-center
              p-2
              rounded-md
              text-red-500
              hover:bg-red-100
              transition
            "
          >
            <LogOutIcon
              size={20}
            />
          </button>

        </div>

      </div>

    </aside>
  );
};

export default WorkspaceSidebar;
