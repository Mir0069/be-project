import { UserRole } from '@db/models/user.model';

// Head of Division holds every client-facing role at once; Super Admin stays separate.
const INHERITED_ROLES: Partial<Record<string, readonly UserRole[]>> = {
  [UserRole.HEAD_OF_DIVISION]: [UserRole.SYSTEM_ADMIN, UserRole.SALES_MANAGER, UserRole.ESTIMATOR],
};

export const effectiveRoles = (role: string | null | undefined): string[] => {
  if (!role) return [];
  return [role, ...(INHERITED_ROLES[role] ?? [])];
};

export const hasAnyRole = (
  role: string | null | undefined,
  allowed: readonly string[],
): boolean => effectiveRoles(role).some((candidate) => allowed.includes(candidate));

// Only a Super Admin may grant, edit, disable or reset a Head of Division account.
export const canManageRole = (actorRole: string | null | undefined, targetRole: string): boolean =>
  targetRole !== UserRole.HEAD_OF_DIVISION || actorRole === UserRole.SUPER_ADMIN;
