type RoutableProject = {
  id: string;
  referenceNumber?: string | null;
  projectCode?: string | null;
};

export const getPublicProjectKey = (project: RoutableProject): string =>
  project.referenceNumber?.trim() || project.projectCode?.trim() || project.id;

export const getProjectWorkspacePath = (
  project: RoutableProject,
  section = "dashboard",
): string => `/projects/${encodeURIComponent(getPublicProjectKey(project))}/${section}`;
