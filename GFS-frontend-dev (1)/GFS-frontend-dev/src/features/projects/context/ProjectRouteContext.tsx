import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { useProjectDetail } from "@/features/projects/query/projectWorkspaceQuery";
import type { ApiProject } from "@/services/project-workspace";

type ProjectRouteContextValue = {
  projectId: string | undefined;
  publicProjectKey: string | undefined;
  project: ApiProject | undefined;
};

type ProjectStreamPayload = {
  event?: string;
  stage?: number;
};

// Stage 0 extraction is exposed to the browser as stage 1 because stage 1 is
// the first user-facing workspace stage. Both values must refresh AI Insight's
// email/document queries when the extraction result arrives.
export const isExtractionUpdate = (stage?: number) => stage === 0 || stage === 1;

const ProjectRouteContext = createContext<ProjectRouteContextValue | null>(null);

export const ProjectRouteProvider = ({ children }: { children: ReactNode }) => {
  const { projectId: rawRouteProjectKey } = useParams<{ projectId: string }>();
  const routeProjectKey = rawRouteProjectKey ? decodeURIComponent(rawRouteProjectKey).trim().replace(/\s+/g, "-") : undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useProjectDetail(routeProjectKey);
  const project = projectQuery.data;
  const previousAnalysisStatus = useRef(project?.analysisStatus);

  useEffect(() => {
    const analysisCompleted =
      previousAnalysisStatus.current === "PROCESSING" &&
      project?.analysisStatus === "COMPLETED";

    previousAnalysisStatus.current = project?.analysisStatus;

    if (!analysisCompleted || !project?.id) return;

    // Stage pages can have fetched an empty/old response while the async AI
    // job was still running. Refresh the active stage immediately when the
    // project poll confirms that the saved extraction is complete.
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["proposals", project.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["outlook-emails", project.id],
      }),
    ]);
  }, [project?.analysisStatus, project?.id, queryClient]);

  useEffect(() => {
    if (!project?.id || typeof EventSource === "undefined") return;

    // Stage AI results arrive asynchronously after an approval/navigation
    // action. Keep every open workspace synchronized with the server event
    // instead of relying on a manual browser refresh.
    const eventSource = new EventSource(
      `/api/v1/proposals/${encodeURIComponent(project.id)}/stream`,
      { withCredentials: true },
    );

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as ProjectStreamPayload;
        if (payload.event === "CONNECTED") return;

        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["proposals", project.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["project-workspace", "detail", project.id],
          }),
          ...(isExtractionUpdate(payload.stage)
            ? [
                queryClient.invalidateQueries({
                  queryKey: ["outlook-emails", project.id],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["documents", project.id],
                }),
              ]
            : []),
        ]);
      } catch {
        // Ignore malformed keep-alive/application frames and keep the stream
        // connected for the next valid workflow event.
      }
    };

    return () => eventSource.close();
  }, [project?.id, queryClient]);

  useEffect(() => {
    const publicKey = project?.referenceNumber?.trim();
    if (!routeProjectKey || !publicKey || publicKey === routeProjectKey) return;

    const currentPrefix = `/projects/${encodeURIComponent(routeProjectKey)}`;
    if (!location.pathname.startsWith(currentPrefix)) return;

    // Canonicalize legacy ObjectId links without adding a browser-history entry.
    const pathname = `/projects/${encodeURIComponent(publicKey)}${location.pathname.slice(currentPrefix.length)}`;
    navigate(
      { pathname, search: location.search, hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate, project, routeProjectKey]);

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#E9EBF2] text-sm text-gray-500">
        Loading project workspace...
      </div>
    );
  }

  if (projectQuery.isError || (!project && !projectQuery.isLoading)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#E9EBF2] p-6 text-center">
        <p className="text-base font-semibold text-gray-700">Project not found</p>
        <p className="mt-1 text-sm text-gray-500">The project "{rawRouteProjectKey}" could not be loaded.</p>
        <a
          href="/"
          className="mt-4 rounded-md bg-[#0f172a] px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Return to Dashboard
        </a>
      </div>
    );
  }

  return (
    <ProjectRouteContext.Provider
      value={{
        // API calls continue using the Mongo ID after the public route key is resolved.
        projectId: project?.id ?? routeProjectKey,
        publicProjectKey: project?.referenceNumber ?? routeProjectKey,
        project,
      }}
    >
      {children}
    </ProjectRouteContext.Provider>
  );
};

export const useProjectRoute = (): ProjectRouteContextValue => {
  const context = useContext(ProjectRouteContext);
  if (!context) {
    throw new Error("useProjectRoute must be used within ProjectRouteProvider");
  }
  return context;
};
