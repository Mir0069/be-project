import type { ReactNode } from "react";
import {
  Bell,
  ClipboardList,
  Folder,
  Handshake,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  UserPlus,
} from "lucide-react";
import { BsPeople } from "react-icons/bs";

import NotificationBadge from "@/features/notifications/components/NotificationBadge";
import DraftBadge from "@/features/sales-manager/projects/components/DraftBadge";
import type { UserRole } from "@/shared/types/auth.types";

export type SidebarItem = {
  label: string;
  path: string;
  icon: ReactNode;
  end?: boolean;
  trailing?: ReactNode;
};

// Keep the client-confirmed Sales Manager navigation order centralized.
const getSalesManagerItems = (): SidebarItem[] => [
  {
    label: "Dashboard",
    path: "/sales-manager",
    icon: <LayoutDashboard size={18} />,
    end: true,
  },
  {
    label: "Project List",
    path: "/sales-manager/projects",
    icon: <Folder size={18} />,
  },
  {
    label: "Kanban",
    path: "/sales-manager/project-kanban",
    icon: <KanbanSquare size={20} />,
  },
  // Create Project remains routable but is intentionally hidden from the
  // Sales Manager navigation until the workflow is enabled again.
  {
    label: "Drafts",
    path: "/sales-manager/drafts",
    icon: <Inbox size={20} />,
    trailing: <DraftBadge />,
  },
  {
    label: "Partners",
    path: "/sales-manager/partners",
    icon: <Handshake size={19} />,
  },
  {
    label: "Notifications",
    path: "/sales-manager/notifications",
    icon: <Bell size={18} />,
    trailing: <NotificationBadge />,
  },
  {
    label: "Audit Logs",
    path: "/sales-manager/audit-logs",
    icon: <ClipboardList size={18} />,
  },
];

export const getSidebarItemsForPath = (
  pathname: string,
  role?: UserRole | null,
): SidebarItem[] => {
  // Head of Division keeps one menu on every page: Sales Manager tabs plus System Admin's Manage Users.
  if (role === "HEAD_OF_DIVISION") {
    return [
      ...getSalesManagerItems(),
      {
        label: "Manage Users",
        path: "/sys-admin/manage-users",
        icon: <UserPlus size={18} />,
      },
    ];
  }

  if (
    pathname.startsWith("/sys-admin") ||
    pathname.startsWith("/register")
  ) {
    return [
      {
        label: "Dashboard",
        path: "/sys-admin",
        icon: <LayoutDashboard size={18} />,
        end: true,
      },
      {
        label: "Manage Users",
        path: "/sys-admin/manage-users",
        icon: <UserPlus size={18} />,
      },
      {
        label: "Audit Logs",
        path: "/sys-admin/audit-logs",
        icon: <ClipboardList size={18} />,
      },
    ];
  }

  if (pathname.startsWith("/sales-manager")) {
    return getSalesManagerItems();
  }

  if (pathname.startsWith("/estimator")) {
    return [
      {
        label: "Dashboard",
        path: "/estimator",
        icon: <LayoutDashboard size={18} />,
        end: true,
      },
      {
        label: "Project List",
        path: "/estimator/projects",
        icon: <Folder size={18} />,
      },
      {
        label: "Kanban",
        path: "/estimator/project-kanban",
        icon: <KanbanSquare size={20} />,
      },
      {
        label: "Notifications",
        path: "/estimator/notifications",
        icon: <Bell size={18} />,
        trailing: <NotificationBadge />,
      },
    ];
  }

  if (pathname.startsWith("/super-admin")) {
    return [
      {
        label: "Dashboard",
        path: "/super-admin",
        icon: <LayoutDashboard size={18} />,
        end: true,
      },
      {
        label: "Manage-Users",
        path: "/super-admin/manage-users",
        icon: <BsPeople size={18} />,
      },
      {
        label: "Audit Logs",
        path: "/super-admin/audit-logs",
        icon: <ClipboardList size={18} />,
      },
    ];
  }

  return [];
};
