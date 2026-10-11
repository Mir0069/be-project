import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchProposalTimeline, fetchProposalStage, approveProposalStage, unapproveProposalStage, patchProposalField, patchStage7Cost, patchStage7Quantity, patchStage7ChargeSelection, patchStage7OptionalAddOnStatus, saveStageFields, fetchFinalParametersSchema, manualRetrigger, fetchProposal, patchProposalCells, downloadProposal, generateProposalExcel, fetchProposalDocumentFile, fetchProposalDocumentPdf, approveProposalLead, fetchStage7EligibleApprovers, assignStage7Approver, fetchPendingApprovals, fetchPendingApprovalCount, type FieldPatchInput, type OptionalAddOnStatus, type PendingApproval } from "@/services/proposals";
import { showToast } from "@/components/ui/toast";
import type { ApiProject } from "@/services/project-workspace";
import type { FieldFeedbackInput } from "@/shared/types/fieldFeedback.types";
import type { ProposalStage } from "@/shared/types/proposalStage.types";
import type { ProposalCellsResponse, ProposalLeadApproval } from "@/services/proposals";

export const pendingApprovalsQueryKey = (projectId: string) =>
  ["projects", projectId, "pending-approvals"] as const;

export const usePendingApprovals = (projectId: string | undefined) =>
  useQuery({
    queryKey: pendingApprovalsQueryKey(projectId ?? ""),
    queryFn: async () => {
      const [approvalsData, countData] = await Promise.all([
        fetchPendingApprovals(projectId!),
        fetchPendingApprovalCount(projectId!),
      ]);
      return {
        approvals: (approvalsData.data || []) as PendingApproval[],
        count: countData.data?.count || 0,
      };
    },
    enabled: !!projectId,
    staleTime: 15_000,
    refetchOnMount: "always",
  });

// Keep workflow screens in sync after a successful action without reloading
// the page or polling the backend continuously.
export const synchronizeProjectWorkflow = async (
  queryClient: QueryClient,
  projectId: string,
  stage?: number,
) => {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["projects", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["project-workspace"] }),
    queryClient.invalidateQueries({
      queryKey: ["project-workspace", "detail", projectId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["proposals", projectId, "timeline"],
    }),
    queryClient.invalidateQueries({
      queryKey: pendingApprovalsQueryKey(projectId),
    }),
  ];

  if (stage !== undefined) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: ["proposals", projectId, "stages", stage],
      }),
      queryClient.invalidateQueries({
        queryKey: ["proposals", projectId, "stages"],
      }),
    );
  }

  await Promise.all(invalidations);
};

export const useProposalStage = (
  projectId: string | undefined,
  stage: number
) =>
  useQuery({
    queryKey: ["proposals", projectId, "stages", stage],
    queryFn: () => fetchProposalStage(projectId!, stage),
    enabled: !!projectId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

export const useFinalParametersSchema = (
  projectId: string | undefined
) =>
  useQuery({
    queryKey: ["proposals", projectId, "final-parameters-schema"],
    queryFn: () => fetchFinalParametersSchema(projectId!),
    enabled: !!projectId,
    refetchOnMount: "always",
  });

export const useProposalTimeline = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["proposals", projectId, "timeline"],
    queryFn: () => fetchProposalTimeline(projectId!),
    enabled: !!projectId,
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

export const useManualRetrigger = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      documentIds,
    }: {
      projectId: string;
      documentIds: string[];
    }) => manualRetrigger(projectId, documentIds),
    onMutate: async (variables) => {
      // The trigger endpoint starts an asynchronous AI job. Mark the project
      // as processing before the request completes so the workspace indicator
      // appears immediately and duplicate re-triggers are hidden/disabled.
      await queryClient.cancelQueries({
        queryKey: ["project-workspace", "detail"],
      });

      const previousDetails = queryClient.getQueriesData<ApiProject>({
        queryKey: ["project-workspace", "detail"],
      });

      queryClient.setQueriesData<ApiProject>(
        { queryKey: ["project-workspace", "detail"] },
        (current) =>
          current?.id === variables.projectId
            ? { ...current, analysisStatus: "PROCESSING" }
            : current
      );

      return { previousDetails };
    },
    onSuccess: async (_data, variables) => {
      // The trigger endpoint accepts the job before AI processing completes.
      // Reflect only the analysis state; the workflow status is backend-owned.
      queryClient.setQueriesData<ApiProject>(
        { queryKey: ["project-workspace", "detail"] },
        (current) =>
          current?.id === variables.projectId
            ? { ...current, analysisStatus: "PROCESSING" }
            : current
      );
      await synchronizeProjectWorkflow(queryClient, variables.projectId);
    },
    onError: (_error, _variables, context) => {
      // The request failed before an AI job was accepted. Restore the exact
      // cached values so a failed attempt does not leave a stale loader up.
      context?.previousDetails.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
  });
};

export const useApproveProposalStage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, stage }: { projectId: string; stage: number }) =>
      approveProposalStage(projectId, stage),
    onSuccess: async (_data, variables) => {
      queryClient.setQueryData<ProposalStage>(
        ["proposals", variables.projectId, "stages", variables.stage],
        (current) => (current ? { ...current, status: "APPROVED" } : current)
      );
      await synchronizeProjectWorkflow(
        queryClient,
        variables.projectId,
        variables.stage,
      );
    },
    onError: (error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : "Failed to approve stage. Please try again.";
      showToast("error", message);
    }
  });
};

export const useUnapproveProposalStage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      stage,
      reason,
    }: {
      projectId: string;
      stage: number;
      reason?: string;
    }) => unapproveProposalStage(projectId, stage, reason),
    onSuccess: async (_data, variables) => {
      await synchronizeProjectWorkflow(
        queryClient,
        variables.projectId,
        variables.stage,
      );
    },
  });
};

export const usePatchProposalField = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      fieldPath,
      value,
      feedback,
    }: {
      projectId: string;
      fieldPath: string;
      value: unknown;
      feedback?: FieldFeedbackInput;
    }) => patchProposalField(projectId, fieldPath, value, feedback),
    onSuccess: async (_data, variables) => {
      // Batch editors refetch their current stage once after all fields are saved.
      // Invalidate list/detail data here so either role sees the saved value after navigation.
      await synchronizeProjectWorkflow(queryClient, variables.projectId);
    },
  });
};

// NEW: batch mutation hook for saving multiple pending field edits in a single request.
// Use this instead of firing usePatchProposalField() once per field in a Promise.all —
// that pattern caused parallel read-modify-write calls to race against each other.
export const useSaveStageFields = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      stage,
      fields,
    }: {
      projectId: string;
      stage: number;
      fields: FieldPatchInput[];
    }) => saveStageFields(projectId, stage, fields),
    onSuccess: async (_data, variables) => {
      await synchronizeProjectWorkflow(
        queryClient,
        variables.projectId,
        variables.stage,
      );
    },
  });
};
// END NEW

export const usePatchStage7Cost = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      cell,
      cost,
      feedback,
    }: {
      projectId: string;
      cell: string;
      cost: number;
      feedback?: FieldFeedbackInput;
    }) => patchStage7Cost(projectId, cell, cost, feedback),
    onSuccess: async (_data, variables) => {
      // SSE remains the primary live update path; this targeted sync is a
      // reliable fallback and does not reload the current screen.
      await synchronizeProjectWorkflow(queryClient, variables.projectId, 7);
    },
  });
};

export const usePatchStage7Quantity = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      cell,
      quantity,
      feedback,
    }: {
      projectId: string;
      cell: string;
      quantity: number;
      feedback?: FieldFeedbackInput;
    }) => patchStage7Quantity(projectId, cell, quantity, feedback),
    onSuccess: async (_data, variables) => {
      await synchronizeProjectWorkflow(queryClient, variables.projectId, 7);
    },
  });
};

export const usePatchStage7ChargeSelection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      cell,
      selection,
      feedback,
    }: {
      projectId: string;
      cell: string;
      selection: "Y" | "N";
      feedback?: FieldFeedbackInput;
    }) => patchStage7ChargeSelection(projectId, cell, selection, feedback),
    onSuccess: (_data, variables) => {
      // Only refresh the active pricing data. The previous broad workflow
      // invalidation refreshed project lists, timelines, and approvals too,
      // which made a small Y/N change feel unnecessarily slow.
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["proposals", variables.projectId, "stages", 7],
        }),
        queryClient.invalidateQueries({
          queryKey: ["proposals", variables.projectId, "final-parameters-schema"],
        }),
      ]);
    },
  });
};

export const useStage7EligibleApprovers = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["proposals", projectId, "stages", 7, "eligible-approvers"],
    queryFn: () => fetchStage7EligibleApprovers(projectId!),
    enabled: !!projectId,
  });

export const useAssignStage7Approver = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      approverId,
    }: {
      projectId: string;
      approverId: string;
    }) => assignStage7Approver(projectId, approverId),
    onSuccess: async (_data, variables) => {
      await synchronizeProjectWorkflow(queryClient, variables.projectId, 7);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : "Failed to assign approver. Please try again.";
      showToast("error", message);
    },
  });
};

export const usePatchStage7OptionalAddOnStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, cell, status }: {
      projectId: string;
      cell: string;
      status: OptionalAddOnStatus;
    }) => patchStage7OptionalAddOnStatus(projectId, cell, status),
    onSuccess: (_data, variables) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["proposals", variables.projectId, "stages", 7] }),
        queryClient.invalidateQueries({ queryKey: ["proposals", variables.projectId, "final-parameters-schema"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", variables.projectId] }),
      ]);
    },
  });
};

export const useProposal = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["proposals", projectId, "proposal"],
    queryFn: () => fetchProposal(projectId!),
    enabled: !!projectId,
    refetchOnMount: "always",
  });

/**
 * Marks the project's Zoho lead as quoted from the proposal page.
 *
 * Only the proposal cache and the workspace detail are touched: nothing in our
 * own workflow moves, so synchronizeProjectWorkflow would wrongly imply it did.
 */
export const useApproveProposalLead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) => approveProposalLead(projectId),
    onSuccess: (approval: ProposalLeadApproval, { projectId }) => {
      queryClient.setQueryData<ProposalCellsResponse>(
        ["proposals", projectId, "proposal"],
        (current) =>
          current
            ? {
                ...current,
                lead_approval: approval,
                send_readiness: current.send_readiness
                  ? { ...current.send_readiness, sent: true, canSend: false, reason: "The proposal has already been sent." }
                  : current.send_readiness,
              }
            : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["proposals", projectId, "timeline"] });
      // The Overview panel renders Lead Status, which has just changed.
      queryClient.invalidateQueries({ queryKey: ["project-workspace", "detail", projectId] });

      showToast(
        "success",
        approval.changed
          ? `Zoho lead marked "${approval.lead_status}"`
          : `Zoho lead was already marked "${approval.lead_status}"`
      );
    },
    onError: (error: unknown) => {
      // The axios interceptor rejects a plain object, not an Error, so the usual
      // `error instanceof Error` check would discard the backend message.
      const message = (error as { message?: string })?.message;
      showToast("error", message || "Could not update the Zoho lead. Please try again.");
    },
  });
};

export const usePatchProposalCells = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      cells,
      targetSheet,
    }: {
      projectId: string;
      cells: Record<string, string | number | null>;
      targetSheet?: string;
    }) => patchProposalCells(projectId, cells, targetSheet),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["proposals", variables.projectId, "proposal"],
      });
      showToast("success", "Proposal draft saved");
    },
    onError: () => {
      showToast("error", "Failed to save proposal draft");
    },
  });
};

export const useDownloadProposal = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) => downloadProposal(projectId),
    onSuccess: async (data, variables) => {
      if (!data.download_url) {
        showToast("error", "Download URL not available");
        return;
      }
      window.open(data.download_url, "_blank");
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace", "detail", variables.projectId],
      });
    },
    onError: () => {
      showToast("error", "Failed to get download link");
    },
  });
};

// Generates (and persists server-side) the proposal workbook. Does NOT trigger
// a browser download — the caller receives the blob so it can render a preview.
export const useGenerateProposalExcel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId }: { projectId: string }) =>
      generateProposalExcel(projectId).then((blob) => ({ blob })),
    onSuccess: async (_data, variables) => {
      // The backend persisted the new draft as the latest quote document.
      await queryClient.invalidateQueries({
        queryKey: ["proposals", variables.projectId, "proposal"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace"],
      });
      showToast("success", "Proposal draft generated");
    },
    onError: (error: unknown) => {
      const message = (error as { message?: unknown })?.message;
      showToast(
        "error",
        typeof message === "string" && message.trim()
          ? message
          : "Failed to generate proposal",
      );
    },
  });
};

const saveBlobToFile = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

// Fetches one previously generated draft workbook through the backend.
export const useProposalDocumentFile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      documentId,
      mode,
      fileName,
    }: {
      projectId: string;
      documentId: string;
      mode: "preview" | "download";
      fileName?: string;
    }) =>
      fetchProposalDocumentFile(projectId, documentId).then((blob) => ({
        blob,
        mode,
        fileName,
      })),
    onSuccess: async ({ blob, mode, fileName }, variables) => {
      if (mode === "download") {
        saveBlobToFile(blob, fileName ?? "proposal.xlsx");
        showToast("success", "Draft downloaded");
      }
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace", "detail", variables.projectId],
      });
    },
    onError: (error: unknown) => {
      const message = (error as { message?: unknown })?.message;
      showToast(
        "error",
        typeof message === "string" && message.trim()
          ? message
          : "Failed to fetch proposal draft",
      );
    },
  });
};

// Downloads a PDF of just the customer-facing Proposal sheet for a
// previously generated draft (converted/cached server-side via Graph).
export const useProposalDocumentPdf = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      documentId,
      fileName,
    }: {
      projectId: string;
      documentId: string;
      fileName?: string;
    }) =>
      fetchProposalDocumentPdf(projectId, documentId).then((blob) => ({
        blob,
        fileName,
      })),
    onSuccess: async ({ blob, fileName }, variables) => {
      const pdfFileName = (fileName ?? "proposal.xlsx").replace(/\.xlsx$/i, ".pdf");
      saveBlobToFile(blob, pdfFileName);
      showToast("success", "Proposal PDF downloaded");
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["project-workspace", "detail", variables.projectId],
      });
    },
    onError: (error: unknown) => {
      const message = (error as { message?: unknown })?.message;
      showToast(
        "error",
        typeof message === "string" && message.trim()
          ? message
          : "Failed to download proposal PDF",
      );
    },
  });
};
