import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { showToast } from "@/components/ui/toast";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { useDocuments } from "@/features/projects/query/documentsQuery";
import {
  useManualRetrigger,
  usePendingApprovals,
} from "@/features/projects/query/proposalsQuery";

interface ProjectOverviewAnalysisActionProps {
  projectId: string;
}

const ProjectOverviewAnalysisAction = ({ projectId }: ProjectOverviewAnalysisActionProps) => {
  const { project } = useProjectRoute();
  const projectApiId = project?.id ?? projectId;
  const { data: documents = [], isLoading: isLoadingDocuments } = useDocuments(projectApiId);
  const pendingApprovalsQuery = usePendingApprovals(projectId);
  const manualRetriggerMutation = useManualRetrigger();
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const approvals = pendingApprovalsQuery.data?.approvals ?? [];
  const documentIds = documents
    .filter((document) => !document.isDeleted)
    .map((document) => document.id);
  const isAnalysisRunning = project?.analysisStatus === "PROCESSING";
  const isAnalysisFailed = project?.analysisStatus === "FAILED";
  const isAnalysisStalled = isAnalysisRunning && project?.updatedAt
    ? currentTime - new Date(project.updatedAt).getTime() > 5 * 60 * 1000
    : false;
  const canShowRetrigger =
    (!isAnalysisRunning || isAnalysisStalled) &&
    (approvals.length === 0 || isAnalysisFailed || isAnalysisStalled);

  if (!pendingApprovalsQuery.data || !canShowRetrigger) return null;

  const handleRetrigger = async () => {
    if (!project) {
      showToast("error", "Project not found");
      return;
    }

    if (documentIds.length === 0) {
      showToast("error", "No project documents are available for analysis");
      return;
    }

    try {
      await manualRetriggerMutation.mutateAsync({
        projectId: projectApiId,
        documentIds,
      });
      showToast("success", "Project analysis started. This screen will refresh automatically.");
    } catch (error) {
      console.error("Failed to re-run project analysis:", error);
      showToast("error", "Failed to start project analysis");
    }
  };

  const isPreparing = manualRetriggerMutation.isPending || isLoadingDocuments;

  return (
    <button
      type="button"
      onClick={() => void handleRetrigger()}
      disabled={isPreparing || documentIds.length === 0}
      title={
        documentIds.length === 0 && !isLoadingDocuments
          ? "No project documents are available for analysis"
          : "Re-run analysis using the project's active documents"
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RotateCcw size={15} className={manualRetriggerMutation.isPending ? "animate-spin" : undefined} />
      {isPreparing ? "Preparing..." : "Re-run Analysis"}
    </button>
  );
};

export default ProjectOverviewAnalysisAction;
