// Who is allowed to see a project in the project list.
//
// The backend is the authority here and scopes /projects by the caller's role,
// but the list is also rendered from cached data, so the same rule is applied
// client side. Keep the two in step: see the workspace service's
// scopeFilterToViewer on the backend.

import { hasAnyRole } from "@/shared/lib/roleAccess";

type Viewer = {
  id?: string;
  email?: string;
  role?: string;
} | null | undefined;

const ROLES_WITH_FULL_PROJECT_ACCESS = ["SYSTEM_ADMIN", "SUPER_ADMIN", "SALES_MANAGER"];

export const canViewAllProjects = (role?: string): boolean =>
  hasAnyRole(role, ROLES_WITH_FULL_PROJECT_ACCESS);

/**
 * True when this estimator is on the project's assignment list. Assignments
 * arrive either as bare ids or as populated user objects depending on the
 * endpoint, so both shapes are matched.
 */
export const isAssignedTo = (project: any, viewer: Viewer): boolean => {
  const assignments = project?.assignedEstimators || [];
  // An unassigned project belongs to nobody. It stays invisible to estimators
  // until a sales manager assigns it, rather than being visible to all of them.
  if (assignments.length === 0) return false;

  return assignments.some((assignedUser: any) => {
    if (!assignedUser) return false;
    if (typeof assignedUser === "string") return assignedUser === viewer?.id;
    const matchesEmail = Boolean(
      viewer?.email &&
        assignedUser?.email &&
        assignedUser.email.toLowerCase() === viewer.email.toLowerCase(),
    );
    const matchesId = Boolean(
      viewer?.id && assignedUser?.id && String(assignedUser.id) === String(viewer.id),
    );
    return matchesEmail || matchesId;
  });
};

/** Narrows a project list to what this viewer is allowed to see. */
export const visibleProjectsFor = <T,>(projects: T[], viewer: Viewer): T[] => {
  if (canViewAllProjects(viewer?.role)) return projects;
  return projects.filter((project) => isAssignedTo(project, viewer));
};
