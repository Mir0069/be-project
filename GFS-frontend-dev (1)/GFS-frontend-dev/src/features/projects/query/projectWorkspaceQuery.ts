// features/projects/query/projectWorkspaceQuery.ts

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProjectWorkspace,
  fetchProjectDetail,
  fetchExternalContacts,
  updateProjectDueDate,
  type ProjectWorkspaceParams,
} from "@/services/project-workspace";

export const PROJECT_WORKSPACE_KEY = ["project-workspace"] as const;
export const PROJECT_ANALYSIS_POLL_INTERVAL_MS = 15_000;

export const getProjectDetailRefetchInterval = (analysisStatus: string | undefined) =>
  analysisStatus === "PROCESSING" ? PROJECT_ANALYSIS_POLL_INTERVAL_MS : false;

export const useProjectWorkspace = (params: ProjectWorkspaceParams = {}) =>
  useQuery({
    queryKey: [...PROJECT_WORKSPACE_KEY, params],
    queryFn: () => fetchProjectWorkspace(params),
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const projects = query.state.data?.data || [];
      const hasProcessing = projects.some(
        (p) =>
          p.analysisStatus === "PROCESSING" ||
          p.status === "WAITING_FOR_INPUTS"
      );
      return hasProcessing ? PROJECT_ANALYSIS_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: false,
  });
export const useProjectDetail = (id: string | undefined) =>
  useQuery({
    queryKey: [...PROJECT_WORKSPACE_KEY, "detail", id],
    queryFn: () => fetchProjectDetail(id!),
    enabled: !!id,
    refetchOnMount: "always",
    // Manual analysis is asynchronous. Poll only while the backend reports
    // that AI processing is active, then stop at a terminal analysis status.
    refetchInterval: (query) =>
      getProjectDetailRefetchInterval(query.state.data?.analysisStatus),
    refetchIntervalInBackground: false,
  });

export const useUpdateProjectDueDate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string }) =>
      updateProjectDueDate(id, dueDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECT_WORKSPACE_KEY });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
};

export const useExternalContacts = (id: string | undefined) =>
  useQuery({
    queryKey: [...PROJECT_WORKSPACE_KEY, "external-contacts", id],
    queryFn: () => fetchExternalContacts(id!),
    enabled: !!id,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
