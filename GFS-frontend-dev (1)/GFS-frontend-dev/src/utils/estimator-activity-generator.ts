import type { DashboardActivity } from "@/features/estimator/types/estimator-dashboard.types";

const generateActivityAction = (action: string) => {
  switch (action) {
    case "AI Analysis":
      return "AI analysis completed";

    case "Proposal Review":
      return "Proposal reviewed";

    case "Proposal Review":
      return "Proposal reviewed";

    case "Set Parameter":
      return "Set Paramter";

    case "Proposal Generation":
      return "Proposal generated";

    default:
      return "Document ingestion";
  }
};

const formatActivityDate = (dateString: string) => {
  const date = new Date(dateString);

  const now = new Date();

  const diffMs = now.getTime() - date.getTime();

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  const diffDays = Math.floor(diffHours / 24);

  /* WITHIN 24 HOURS */

  if (diffHours < 24) {
    if (diffHours <= 1) {
      return "1 hour ago";
    }

    return `${diffHours} hours ago`;
  }

  /* YESTERDAY */

  if (diffDays === 1) {
    return `Yesterday, ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  /* DEFAULT */

  return date.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
};

export const generateEstimatorActivities = (
  projects: any[],
): DashboardActivity[] => {
  return (
    projects

      .filter((project: any) => {
        const status = project?.formData?.projectDetails?.status;

        return status && status.toLowerCase() !== "not started";
      })

      /* SORT FIRST USING REAL DATE */

      .sort((a, b) => {
        const dateA = new Date(a?.updatedAt || a?.createdAt).getTime();

        const dateB = new Date(b?.updatedAt || b?.createdAt).getTime();

        return dateB - dateA;
      })

      /* THEN MAP */

      .map((project: any) => {
        const details = project?.formData?.projectDetails;

        return {
          id: `activity-${project.id}`,

          projectName: details?.projectName,

          projectCode: details?.projectId,

          action: generateActivityAction(details?.action),

          status: details?.status,

          date: formatActivityDate(project?.updatedAt || project?.createdAt),

          assignments: project?.formData?.assignments || [],
        };
      })
  );
};
