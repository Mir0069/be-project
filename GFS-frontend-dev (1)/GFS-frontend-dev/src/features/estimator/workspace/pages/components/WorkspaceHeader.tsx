// pages/estimator/workspace/WorkspaceHeader.tsx

import {
  ChevronLeft,
} from "lucide-react";

import {
  useNavigate,
} from "react-router-dom";

import { useAuth }
  from "@/context/AuthContext";

import { getDashboardRoute } from "@/utils/authRedirect";
import { getProjectIdentity } from "@/features/projects/utils/projectIdentity";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { TeamsCallButton } from "@/features/teams-call/components/TeamsCallButton";

const WorkspaceHeader = () => {

  const navigate =
    useNavigate();

  const { user } =
    useAuth();

  const { project } = useProjectRoute();

  const projectIdentity = project
    ? getProjectIdentity(project)
    : null;

  return (

    <header className="
      w-full
      bg-white
      border-b border-gray-200
      px-4 py-4
      flex items-center justify-between
    ">

      <div className="flex items-center gap-4">
        <button

          type="button"

          onClick={() => {

            navigate(
              getDashboardRoute(user?.role)
            );

          }}

          className="
            group
            flex items-start
            gap-1.5
          "
        >

          <ChevronLeft
            size={28}
            className="
              group-hover:text-red-500
            "
          />

          <div className="
            flex flex-col justify-start items-start
            ml-1
          ">

            <div className="
              text-md
              font-semibold
              text-black
              group-hover:text-red-500
              transition
              translate-y-0.5
            ">

              Project Workspace
              {projectIdentity ? `: ${projectIdentity}` : ""}

            </div>

          </div>

        </button>
      </div>

      {project && <TeamsCallButton assigned={project.assignedEstimators} />}

    </header>

  );

};

export default WorkspaceHeader;
