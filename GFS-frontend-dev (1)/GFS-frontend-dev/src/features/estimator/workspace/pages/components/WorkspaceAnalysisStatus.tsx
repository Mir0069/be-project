import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";

/**
 * Shows the project-wide AI lifecycle. The project detail query is the source
 * of truth and polls until the backend reports a terminal status. The same
 * full status treatment is used in Project Overview and each AI stage.
 */
const WorkspaceAnalysisStatus = () => {
  const { project } = useProjectRoute();
  const analysisStatus = project?.analysisStatus;
  const isCompleted = ["COMPLETED", "COMPLETE", "APPROVED", "ADMIN_PACKAGING"].includes(
    project?.status?.trim().toUpperCase() || ""
  );

  if (isCompleted || analysisStatus === "COMPLETED") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="AI Extraction Complete"
        title="AI Extraction Complete"
        className="inline-flex shrink-0 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm"
      >
        <CheckCircle2 size={18} aria-hidden="true" />
        <span>AI Extraction Complete</span>
      </span>
    );
  }

  if (analysisStatus === "PROCESSING") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="AI extraction in progress"
        title="AI extraction in progress"
        className="inline-flex shrink-0 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 shadow-sm"
      >
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        <span>AI extraction in progress</span>
      </span>
    );
  }

  if (analysisStatus === "FAILED") {
    return (
      <span
        role="alert"
        aria-label="AI extraction failed"
        title="AI extraction failed. Re-run analysis from Project Overview."
        className="inline-flex shrink-0 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-sm"
      >
        <AlertCircle size={18} aria-hidden="true" />
        <span>AI extraction failed</span>
      </span>
    );
  }

  return null;
};

export default WorkspaceAnalysisStatus;
