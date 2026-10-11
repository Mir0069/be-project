import type { EstimatorTask } from "@/features/estimator/types/estimator-dashboard.types"

const generateTaskTitle = (
  project: any
) => {

  const details =
    project?.formData?.projectDetails;

  const documents =
    project?.formData?.documents || [];

  const status =
    details?.status;

  const action =
    details?.action;


  /*
    =========================================
    NOT STARTED
    =========================================
  */

  if (
    status?.toLowerCase() === "not started"
  ) {

    const firstDocument =
      documents[0];

    return `Ingest ${firstDocument?.name || "project"
      } document`;

  }


  /*
    =========================================
    WORKFLOW PIPELINE
    =========================================

    Document Ingestion
      ↓

    AI Analysis
      ↓

    Set Parameters
      ↓

    BOM & Pricing
      ↓

    Proposal Generation
      ↓

    Regenerate Proposal
  */


  /* DOCUMENT INGESTION COMPLETED */

  if (
    action === "Document Ingestion"
  ) {

    return "Run AI analysis";

  }


  /* AI ANALYSIS COMPLETED */

  if (
    action === "AI Analysis"
  ) {

    return "Set parameters";

  }


  /* PARAMETERS COMPLETED */

  if (
    action === "Parameter Setting"
  ) {

    return "Generate BOM";

  }


  /* BOM COMPLETED */

  if (
    action === "BOM & Pricing"
  ) {

    return "Generate proposal";

  }


  /* PROPOSAL COMPLETED */

  if (
    action === "Proposal Generation"
  ) {

    return "Regenerate proposal";

  }


  /* REVIEW */

  if (
    action === "Proposal Review"
  ) {

    return "Review proposal";

  }


  /* REGENERATE */

  if (
    action === "Regenerate Proposal"
  ) {

    return "Regenerate proposal";

  }


  /*
    DEFAULT
  */

  return "Review project";

};



export const generateEstimatorTasks = (
  projects: any[]
): EstimatorTask[] => {
  return projects.map((project: any) => {
    const details = project?.formData?.projectDetails;

    return {
      id: project.id,

      title: generateTaskTitle(project),

      projectCode: details?.projectId,

      projectName: details?.projectName,

      status: details?.status,

      action: details?.action,

      assignments:
        project?.formData?.assignments || [],
    };
  });
};



