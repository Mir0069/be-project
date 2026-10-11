// pages/estimator/workspace/WorkspaceLayout.tsx

import { Outlet } from "react-router-dom";
import WorkspaceSidebar from "./WorkspaceSidebar";
import WorkspaceHeader from "./WorkspaceHeader";
import { ProjectRouteProvider } from "@/features/projects/context/ProjectRouteContext";

const WorkspaceLayout = () => {
  return (
    <ProjectRouteProvider>
      <div className="flex h-screen overflow-hidden bg-[#E9EBF2]">
        <div className="h-full min-h-0 shrink-0 overflow-hidden">
          <WorkspaceSidebar />
        </div>

        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceHeader />
          <main className="min-h-0 flex-1 overflow-y-auto p-6 no-scrollbar">
            <Outlet />
          </main>
        </div>
      </div>
    </ProjectRouteProvider>
  );
};

export default WorkspaceLayout;
