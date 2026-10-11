// utils/authRedirect.ts

import type { UserRole } from "@/shared/types/auth.types";

export const getDashboardRoute = (
  role: UserRole | null | undefined
): string => {
  switch (role) {
    case "SUPER_ADMIN":
      return "/sys-admin";

    case "SYSTEM_ADMIN":
      return "/sys-admin";

    case "SALES_MANAGER":
    case "HEAD_OF_DIVISION":
      return "/sales-manager";

    case "ESTIMATOR":
      return "/estimator";

    default:
      return "/login";
  }
};
