// features/projects/query/projectsQuery.ts

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  fetchProjects,
  fetchProjectById,
  createProject,
  updateProjectEstimators,
  syncDropbox,
} from "@/services/projects";

const PROJECTS_KEY = ["projects"] as const;

// List of all projects
export const useProjects = () =>
  useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
    refetchOnMount: "always",
  });

// Single project by id
export const useProject = (id: string | undefined) =>
  useQuery({
    queryKey: ["projects", id],
    queryFn: () => fetchProjectById(id!),
    enabled: !!id,
    refetchOnMount: "always",
  });

// Create a project
export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
  });
};

// Reassign a project's estimator
export const useUpdateProjectEstimators = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProjectEstimators,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      qc.invalidateQueries({ queryKey: ["projects", updated.id] });
      qc.invalidateQueries({ queryKey: ["project-workspace"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

// Sync Dropbox manually
export const useSyncDropbox = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: syncDropbox,
    onSuccess: (_, projectId) => {
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["comms", "calls", projectId] });
    },
  });
};
