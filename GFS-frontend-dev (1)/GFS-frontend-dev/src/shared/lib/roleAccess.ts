import type { UserRole } from "@/shared/types/auth.types";

// Head of Division holds every client-facing role at once; mirrors the backend role-access helper.
const INHERITED_ROLES: Partial<Record<string, readonly UserRole[]>> = {
  HEAD_OF_DIVISION: ["SYSTEM_ADMIN", "SALES_MANAGER", "ESTIMATOR"],
};

export const hasAnyRole = (
  role: string | null | undefined,
  allowed: readonly string[],
): boolean => {
  if (!role) return false;
  return [role, ...(INHERITED_ROLES[role] ?? [])].some((candidate) => allowed.includes(candidate));
};

// Only a Super Admin may create, edit, disable or reset a Head of Division account.
export const canManageRole = (
  actorRole: string | null | undefined,
  targetRole: string,
): boolean => targetRole !== "HEAD_OF_DIVISION" || actorRole === "SUPER_ADMIN";

export const formatRoleLabel = (role: string): string => role.replace(/_/g, " ");
