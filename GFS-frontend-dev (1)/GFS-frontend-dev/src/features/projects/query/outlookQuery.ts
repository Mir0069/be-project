// features/projects/query/outlookQuery.ts

import { useQuery } from "@tanstack/react-query";
import { fetchOutlookEmailsByProject } from "@/services/outlook";
import {
  PROJECT_ANALYSIS_POLL_INTERVAL_MS,
  useProjectDetail,
} from "./projectWorkspaceQuery";

export const OUTLOOK_EMAILS_KEY = (projectId: string) =>
  ["outlook-emails", projectId] as const;

/** Fetch all emails linked to a project from the backend. */
export const useOutlookEmails = (projectId: string | undefined) => {
  const { data: project } = useProjectDetail(projectId);

  return useQuery({
    queryKey: OUTLOOK_EMAILS_KEY(projectId ?? ""),
    queryFn: () => fetchOutlookEmailsByProject(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: project?.analysisStatus === "PROCESSING"
      ? PROJECT_ANALYSIS_POLL_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
};
