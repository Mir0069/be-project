import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { useApproveProposalStage, useProposalStage, usePatchProposalField } from "@/features/projects/query/proposalsQuery";
import type { ProposalStageField } from "@/shared/types/proposalStage.types";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { ReviseStageButton } from "@/features/estimator/workspace/pages/components/ReviseStageButton";
import { RevisionInfo } from "@/features/estimator/workspace/pages/components/RevisionInfo";
import { FieldFeedbackModal } from "@/features/estimator/workspace/pages/components/FieldFeedbackModal";
import { useFieldFeedbackQueue } from "@/features/estimator/workspace/hooks/useFieldFeedbackQueue";
import { useStageArrivalRefresh } from "@/features/estimator/workspace/hooks/useStageArrivalRefresh";
import { toFeedbackRequests } from "@/features/estimator/workspace/utils/fieldFeedback";
import WorkspaceAnalysisStatus from "@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus";
import { UnitSpecificationTable } from "@/features/estimator/workspace/pages/components/UnitSpecificationTable";
import { SpecValueSelect } from "@/features/estimator/workspace/pages/components/SpecValueSelect";
import { getApprovedUnitRows, getUnitValue } from "@/features/estimator/workspace/utils/multiUnitDisplay";

const GLASS_LABELS: Record<string, string> = {
  GLASS_NO_IGU: "GLASS WITHOUT IGU",
  GLASS_WITH_IGU: "GLASS WITH IGU",
  GLASS_2_0: "GLASS 2.0",
  STAIR_TREAD: "STAIR TREAD",
  NON_WALKABLE: "NON-WALKABLE",
  EGR: "EGR",
};

const formatGlassLabel = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") return "-";
  return GLASS_LABELS[value] || value.replaceAll("_", " ");
};

const isStageField = (field: unknown): field is ProposalStageField =>
  Boolean(field) && typeof field === "object" && ("value" in field || "reasoning" in field);

const toStageField = (field: unknown): ProposalStageField | undefined => {
  if (isStageField(field)) return field;
  if (field == null) return undefined;
  return { value: field };
};

import { StageReasoning } from "@/features/estimator/workspace/components/StageReasoning";

const GlassType = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, publicProjectKey } = useProjectRoute();
  // Approval is an estimator action; sales managers can review the stage.
  const { isSalesManager } = useAuth();
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});

  const { data: stage, isLoading, isError, refetch } = useProposalStage(projectId, 2);
  const shouldRefreshOnArrival =
    (location.state as { refreshWorkflowStage?: number } | null)?.refreshWorkflowStage === 2;
  useStageArrivalRefresh(shouldRefreshOnArrival, refetch);
  const {
    mutate: approveStage,
    isPending: isApproving,
    isError: isApproveError,
    isSuccess: isApproveSuccess,
  } = useApproveProposalStage();
  const { mutateAsync: patchField, isPending: isPatching } = usePatchProposalField();
  const { collect: collectFeedback, modalProps: feedbackModalProps } = useFieldFeedbackQueue();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-red-500" />
        <p className="mt-3 text-sm text-gray-500">Loading glass type data...</p>
      </div>
    );
  }

  if (isError || !stage) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <AlertCircle className="mx-auto h-7 w-7 text-red-400" />
        <p className="mt-3 text-sm text-gray-600">Could not load glass type data.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  const rawGlassField = toStageField(stage.fields_to_show?.glass_type);
  const glassField: ProposalStageField = rawGlassField ?? {
    value: "GLASS_NO_IGU",
    reasoning: "Glass specification derived from project inquiry and application scope.",
    citation: { sourceType: "rule_engine", docName: "AI Inferred", citationText: "AI Inferred" } as any,
    _meta: {
      allowed_values: [
        "GLASS_NO_IGU",
        "GLASS_WITH_IGU",
        "GLASS_2_0",
        "STAIR_TREAD",
        "NON_WALKABLE",
        "EGR",
      ],
    },
  };

  let allowedValues: any[] | undefined = undefined;
  if (Array.isArray(glassField?._meta?.allowed_values)) {
    allowedValues = glassField?._meta?.allowed_values;
  } else if (Array.isArray(glassField?.allowed_values)) {
    allowedValues = glassField?.allowed_values;
  }
  // Older projects may not carry the registry metadata returned by newer
  // extraction runs. Keep their per-unit glass selectors fully editable.
  if (!allowedValues || allowedValues.length === 0) {
    allowedValues = Object.keys(GLASS_LABELS);
  }
  const allowedGlassValues = (allowedValues ?? []).filter((value): value is string => typeof value === "string");

  const selectedGlassType = pendingChanges["stage_2.glass_type"] ?? glassField?.value;
  const hasSelectedGlassType =
    typeof selectedGlassType === "string" && allowedGlassValues.includes(selectedGlassType);
  const selectionValue = hasSelectedGlassType ? "Y" : "N";
  const units = (stage.fields_to_show as Record<string, unknown>).units;
  const unitGlassDecisions = getApprovedUnitRows(units).filter(({ data }) => {
    const value = getUnitValue(data, "value_glass_type");
    return value !== null && value !== undefined && value !== "";
  });
  // A single-unit project has one overall glass decision. When AI returns
  // decisions for multiple units, those rows are the source of truth and the
  // global selector would be a duplicate, potentially misleading fallback.
  const hasMultipleUnitGlassDecisions = unitGlassDecisions.length > 1;
  // The AI saves MANUAL when it cannot tell the glass; the estimator must choose before approving.
  const glassNeedsChoice =
    !hasMultipleUnitGlassDecisions &&
    !(typeof glassField.value === "string" && allowedGlassValues.includes(glassField.value));
  const isApproved = stage.status?.toUpperCase() === "APPROVED" || isApproveSuccess;
  const isLocked = stage.status?.toUpperCase() === "LOCKED";
  const nextPath = `/projects/${encodeURIComponent(publicProjectKey ?? "")}/frame-type`;

  const handleApprove = () => {
    if (!projectId) return;
    if (isApproved) {
      navigate(nextPath, { state: { refreshWorkflowStage: 3 } });
      return;
    }

    approveStage(
      { projectId, stage: 2 },
      {
        onSuccess: async () => {
          await refetch();
          navigate(nextPath, { state: { refreshWorkflowStage: 3 } });
        },
      }
    );
  };

  return (
    <div className="space-y-5 pb-24">
      <FieldFeedbackModal {...feedbackModalProps} />
      <div className="flex items-start justify-between border-l-4 border-red-500 px-5 py-1">
        <h2 className="text-2xl font-semibold leading-8 text-red-500">Glass Type</h2>
        <WorkspaceAnalysisStatus />
      </div>

      <section className="overflow-visible rounded-lg border border-gray-200 bg-white shadow-sm">
        {!hasMultipleUnitGlassDecisions && (
          <table className="w-full table-fixed overflow-hidden rounded-t-lg text-left text-sm">
            <thead>
              <tr className="bg-[#07111f] text-white">
                <th className="w-1/4 rounded-tl-lg px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                  Parameter
                </th>
                <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                  Value
                </th>
                <th className="w-1/2 rounded-tr-lg px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                  Reasoning
                </th>
              </tr>
            </thead>
            <tbody>
              {glassField ? (
                <tr className="border-t border-emerald-100 bg-emerald-50 text-gray-700">
                  <td className="px-5 py-5 align-top text-sm font-bold text-emerald-700">
                    {allowedValues && allowedValues.length > 0 && !isApproved && !isLocked ? (
                      <SpecValueSelect
                        value={selectedGlassType}
                        options={allowedValues}
                        formatOption={formatGlassLabel}
                        placeholder="Select glass type"
                        ariaLabel="Glass type"
                        onChange={(value) => setPendingChanges({ ...pendingChanges, "stage_2.glass_type": value })}
                      />
                    ) : (
                      formatGlassLabel(pendingChanges["stage_2.glass_type"] ?? glassField.value)
                    )}
                  </td>
                  <td className="border-l border-emerald-100 px-5 py-5 align-top text-sm font-bold text-emerald-700">
                    {selectionValue}
                  </td>
                  <td className="border-l border-emerald-100 px-5 py-5 align-top text-sm leading-6">
                    <StageReasoning field={glassField} projectId={projectId} signals={stage.fields_to_show?._signals} />
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-5 text-sm italic text-gray-400">
                    No glass type field returned by backend.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {hasMultipleUnitGlassDecisions && (
          <UnitSpecificationTable
            units={units}
            field="value_glass_type"
            variant="detailed"
            editable={!isApproved && !isLocked}
            pendingChanges={pendingChanges}
            fieldPathPrefix="stage_2.units"
            allowedValues={allowedGlassValues}
            projectId={projectId}
            signals={stage.fields_to_show?._signals}
            showTitle={false}
            formatOption={formatGlassLabel}
            onValueChange={(fieldPath, value) =>
              setPendingChanges((current) => ({ ...current, [fieldPath]: value }))
            }
          />
        )}

        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-5 py-4">
          <div className="text-sm">
            {isApproved ? (
              <div>
                <span className="text-gray-600">Stage approved successfully.</span>
                <div className="mt-1">
                  <RevisionInfo
                    revisionCount={stage.revision_count}
                    latestRevision={stage.revisions?.[0]}
                  />
                </div>
              </div>
            ) : isLocked ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600"><AlertCircle size={16} /> This stage is locked until the previous step is approved.</span>
            ) : isApproveError ? (
              <span className="inline-flex items-center gap-1.5 text-red-500">
                <AlertCircle size={16} /> Failed to approve. Please try again.
              </span>
            ) : glassNeedsChoice ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600">
                <AlertCircle size={16} /> The AI could not determine the glass type. Select one and click Update before approving.
              </span>
            ) : (
              <span className="text-gray-500">Review the selected glass type before approving.</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!isApproved && !isLocked && (
              <button
                type="button"
                disabled={isPatching || Object.keys(pendingChanges).length === 0}
                onClick={async () => {
                  const answers = await collectFeedback(
                    toFeedbackRequests(
                      Object.entries(pendingChanges).map(([path, value]) => {
                        const unitMatch = /^stage_2\.units\.([A-J])\.value_glass_type$/.exec(path);
                        const unit = unitMatch
                          ? ((stage.fields_to_show as Record<string, any>).units?.[unitMatch[1]!])
                          : undefined;

                        return {
                          key: path,
                          label: unitMatch ? `Unit ${unitMatch[1]} Glass Type` : "Glass Type",
                          previousValue: unit?.value_glass_type ?? glassField?.value ?? null,
                          newValue: value,
                        };
                      })
                    )
                  );

                  try {
                    for (const [path, value] of Object.entries(pendingChanges)) {
                      await patchField({
                        projectId: projectId!,
                        fieldPath: path,
                        value,
                        ...(answers[path] ? { feedback: answers[path]! } : {}),
                      });
                    }
                    showToast("success", "Changes updated successfully");
                    setPendingChanges({});
                    refetch();
                  } catch (err) {
                    showToast("error", "Failed to update some fields");
                  }
                }}
                className={`inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold text-white transition ${Object.keys(pendingChanges).length > 0 && !isPatching
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-gray-300 cursor-not-allowed"
                  }`}
              >
                {isPatching ? <Loader2 size={16} className="animate-spin" /> : "Update"}
              </button>
            )}

            {(true) && (
              <button
                type="button"
                onClick={() => {
                  if (!isApproved && Object.keys(pendingChanges).length > 0) {
                    showToast("error", "Please click Update to save your changes before approving.");
                    return;
                  }
                  if (!isApproved && glassNeedsChoice) {
                    showToast("error", "Select a glass type before approving.");
                    return;
                  }
                  handleApprove();
                }}
                disabled={isApproving || isLocked}
                className={`inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold text-white transition ${isApproved
                    ? "bg-green-600 hover:bg-green-700"
                    : isLocked || isApproving
                      ? "cursor-not-allowed bg-gray-300"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
              >
                {isApproving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                {isApproved ? "Approved" : "Approve Data"}
              </button>
            )}

            {isApproved && (
              <ReviseStageButton
                projectId={projectId!}
                stage={2}
                stageName="Glass Type"
                onRevised={() => refetch()}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default GlassType;
