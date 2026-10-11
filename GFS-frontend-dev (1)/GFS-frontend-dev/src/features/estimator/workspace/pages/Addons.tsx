import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Check, Loader2, RefreshCw, Download } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { apiClient } from "@/shared/api/client";
import { useApproveProposalStage, useProposalStage, usePatchProposalField } from "@/features/projects/query/proposalsQuery";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import type { ProposalStageField } from "@/shared/types/proposalStage.types";
import { formatReasoningLines } from "@/features/estimator/workspace/utils/reasoning";
import { ReviseStageButton } from "@/features/estimator/workspace/pages/components/ReviseStageButton";
import { RevisionInfo } from "@/features/estimator/workspace/pages/components/RevisionInfo";
import { FieldFeedbackModal } from "@/features/estimator/workspace/pages/components/FieldFeedbackModal";
import { useFieldFeedbackQueue } from "@/features/estimator/workspace/hooks/useFieldFeedbackQueue";
import { useStageArrivalRefresh } from "@/features/estimator/workspace/hooks/useStageArrivalRefresh";
import { toFeedbackRequests } from "@/features/estimator/workspace/utils/fieldFeedback";
import WorkspaceAnalysisStatus from "@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus";
import { AIReasoningLabel } from "@/features/estimator/workspace/components/AIReasoningLabel";

type AddonRow = {
  key: string;
  label: string;
  field?: ProposalStageField;
  calculated?: boolean;
};

const ADDON_ROWS: Array<Omit<AddonRow, "field"> & { path: string }> = [
  { key: "duty", label: "Duty", path: "addons.duty" },
  { key: "heat_soak_testing", label: "Heat Soak Testing", path: "addons.heat_soak_testing" },
  { key: "nanodot", label: "Nanodot", path: "addons.nanodot" },
  { key: "seeded_organic", label: "Seeded Organic", path: "addons.seeded_organic" },
  { key: "sentry_glass", label: "Sentry Glass", path: "addons.sentry_glass" },
  { key: "krypton_gas", label: "Krypton Gas", path: "addons.krypton_gas" },
  { key: "custom_shape", label: "Custom Shape", path: "addons.custom_shape" },
  { key: "backpaint", label: "Backpaint", path: "addons.backpaint" }
];

const isStageField = (field: unknown): field is ProposalStageField =>
  Boolean(field) && typeof field === "object" && ("value" in field || "reasoning" in field);

const toField = (value: unknown): ProposalStageField | undefined => {
  if (isStageField(value)) return value;
  if (value == null) return undefined;
  return { value };
};

const readPath = (
  source: Record<string, unknown> | undefined,
  path: string
): unknown => {
  if (!source) return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
};

const getNestedField = (
  fields: Record<string, unknown> | undefined,
  path: string
): ProposalStageField | undefined => {
  const key = path.split(".").at(-1) || path;
  const group = path.split(".")[0];

  const direct = toField(readPath(fields, path));
  if (direct) return direct;

  const flat = toField(fields?.[key]);
  if (flat) return flat;

  const underscored = toField(fields?.[path.replace(/\./g, "_")]);
  if (underscored) return underscored;

  const groupField = fields?.[group];
  if (isStageField(groupField) && groupField.value && typeof groupField.value === "object") {
    const nestedValue = (groupField.value as Record<string, unknown>)[key];
    const nestedField = toField(nestedValue);
    if (nestedField) return nestedField;
  }

  if (groupField && typeof groupField === "object" && !isStageField(groupField)) {
    const nestedValue = (groupField as Record<string, unknown>)[key];
    const nestedField = toField(nestedValue);
    if (nestedField) return nestedField;
  }

  return undefined;
};

const formatValue = (value: unknown): string => {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Y" : "N";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";

  const text = String(value).trim();
  if (["true", "yes", "y"].includes(text.toLowerCase())) return "Y";
  if (["false", "no", "n"].includes(text.toLowerCase())) return "N";

  return text;
};

const rowTone = (row: AddonRow) => {
  if (row.calculated) return "border-gray-100 bg-white";

  const value = formatValue(row.field?.value);
  if (value === "Y") return "border-emerald-100 bg-emerald-50";
  if (value === "N") return "border-red-100 bg-red-50";

  return "border-gray-100 bg-white";
};

const valueTone = (row: AddonRow) => {
  if (row.calculated) return "text-gray-900";

  const value = formatValue(row.field?.value);
  if (value === "Y") return "text-emerald-700";
  if (value === "N") return "text-red-800";

  return "text-gray-900";
};

import { CitationLink } from "@/features/estimator/workspace/components/CitationLink";
import { ConfidenceBadge, hasConfidenceValue } from "@/features/estimator/workspace/components/ConfidenceBadge";

const Reasoning = ({
  field,
  projectId,
  signals,
}: {
  field?: ProposalStageField;
  projectId?: string;
  signals?: Record<string, any>;
}): ReactNode => {
  const confidence = field?.confidence ?? field?.extracted_confidence;
  let reasons = formatReasoningLines(
    field?.reasoning || 
    (field as any)?.extracted_verbatim || 
    (field as any)?.extracted_citation?.verbatim
  );

  if (reasons.length === 0) {
    reasons = ["Evaluated by GFS business rule engine against project scope."];
  }
  const fieldCitation = field?.citation || (field as any)?.extracted_citation;
  const hasAiReasoning = reasons.some((reason) => {
    const lowerReason = reason.toLowerCase();
    return !lowerReason.includes("email") &&
      !lowerReason.includes("inquiry") &&
      !lowerReason.includes("correspondence") &&
      !(fieldCitation?.pdf_name || fieldCitation?.doc_name);
  });

  return (
    <div className="space-y-2">
      <ul className="list-disc space-y-1.5 pl-4 text-gray-600">
        {reasons.map((reason, index) => {
        let matchedSignal: any = null;
        if (signals) {
          const lowerReason = reason.toLowerCase();
          for (const [sigKey, sigVal] of Object.entries(signals)) {
            const cleanSigKey = sigKey.toLowerCase().replace(/^is_|^has_/, "");
            if (lowerReason.includes(cleanSigKey) || lowerReason.includes(sigKey.toLowerCase())) {
              matchedSignal = sigVal;
              break;
            }
          }
        }

        const lowerReason = reason.toLowerCase();
        const isEmailReason =
          lowerReason.includes("email") ||
          lowerReason.includes("inquiry") ||
          lowerReason.includes("correspondence");

        const cit =
          matchedSignal?.citation ||
          matchedSignal?.extracted_citation ||
          field?.citation ||
          (field as any)?.extracted_citation;

        const citDocName = cit?.pdf_name || cit?.doc_name;
        const isDocReason = Boolean(citDocName) && !isEmailReason;
        const pageMatch = reason.match(/p(?:age)?\.?\s*(\d+)/i);
        const pageNumber =
          cit?.page ?? cit?.page_num ?? (pageMatch ? parseInt(pageMatch[1], 10) : 1);
        const docName = isDocReason ? citDocName : undefined;
        const bboxInches = isDocReason ? cit?.bbox_inches : undefined;
        const documentId = cit?.document_id || cit?.documentId;

        return (
          <li key={index} className="leading-relaxed">
            <div className="flex flex-wrap items-center gap-2">
              <span>{reason}</span>
              {isDocReason && projectId && docName && (
                <CitationLink
                  projectId={projectId}
                  citationText={docName}
                  pageNumber={pageNumber}
                  docName={docName}
                  bboxInches={bboxInches}
                  sourceType={cit?.source_type || cit?.sourceType || cit?.source}
                  interactive
                  documentId={documentId}
                  className="ml-1"
                />
              )}
              {isEmailReason && projectId && (
                <CitationLink
                  projectId={projectId}
                  citationText="Email Thread"
                  docName="Email Thread"
                  sourceType="email_body"
                  className="ml-1"
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
    {projectId && hasAiReasoning && <AIReasoningLabel />}
    <ConfidenceBadge confidence={confidence} />
  </div>
  );
};

const HIDDEN_ADDON_OPTIONS = new Set(["manual", "pending"]);

const isHiddenAddonOption = (value: unknown): boolean =>
  HIDDEN_ADDON_OPTIONS.has(String(value ?? "").trim().toLowerCase());

const extractAllowedValues = (field?: ProposalStageField): unknown[] => {
  const values = Array.isArray(field?._meta?.allowed_values)
    ? field._meta.allowed_values
    : field?.allowed_values;

  if (!Array.isArray(values)) return [];

  // Manual and Pending are workflow states, not valid estimator addon decisions.
  return values.filter(
    (value) => !isHiddenAddonOption(value),
  );
};

const Addons = () => {
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, publicProjectKey, project: projectDetail } = useProjectRoute();
  // Approval is an estimator action; sales managers can review the stage.
  const { isSalesManager } = useAuth();
  const { data: stage, isLoading, isError, refetch } = useProposalStage(projectId, 5);
  const shouldRefreshOnArrival =
    (location.state as { refreshWorkflowStage?: number } | null)?.refreshWorkflowStage === 5;
  useStageArrivalRefresh(shouldRefreshOnArrival, refetch);
  const {
    mutateAsync: approveStageAsync,
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
        <p className="mt-3 text-sm text-gray-500">Loading addons data...</p>
      </div>
    );
  }

  if (isError || !stage) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <AlertCircle className="mx-auto h-7 w-7 text-red-400" />
        <p className="mt-3 text-sm text-gray-600">Could not load addons data.</p>
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

  const fields = stage.fields_to_show as Record<string, unknown>;
  const rows: AddonRow[] = ADDON_ROWS.map((row) => ({
    ...row,
    field: getNestedField(fields, row.path),
  }));
  const isApproved = stage.status?.toUpperCase() === "APPROVED" || isApproveSuccess;
  const isLocked = stage.status?.toUpperCase() === "LOCKED";
  const nextPath = `/projects/${encodeURIComponent(publicProjectKey ?? "")}/final-parameters`;

  const handleApprove = async () => {
    if (!projectId) return;
    if (isApproved) {
      navigate(nextPath, { state: { refreshWorkflowStage: 7 } });
      return;
    }

    try {
      // The backend advances internal Stage 6 and initializes Stage 7.
      await approveStageAsync({ projectId, stage: 5 });
      await refetch();
      navigate(nextPath, { state: { refreshWorkflowStage: 7 } });
    } catch (err) {
      console.error("Failed to approve stage 5", err);
    }
  };

  return (
    <div className="space-y-5 pb-6">
      <FieldFeedbackModal {...feedbackModalProps} />
      <div className="flex items-start justify-between border-l-4 border-red-500 px-5 py-1">
        <h2 className="text-2xl font-semibold leading-8 text-red-500">Addons</h2>
        <WorkspaceAnalysisStatus />
      </div>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="bg-[#07111f] text-white">
              <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                Parameter
              </th>
              <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                Value
              </th>
              <th className="w-1/2 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                Reasoning
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={`border-t ${rowTone(row)}`}>
                <td className={`px-5 py-5 align-top text-sm font-bold ${valueTone(row)}`}>
                  {row.label}
                </td>
                <td className={`px-5 py-5 align-top text-sm font-bold ${valueTone(row)}`}>
                  {(() => {
                    const path = `stage_5.${row.path}`;
                    const value = pendingChanges[path] ?? row.field?.value;
                    const allowedValues = extractAllowedValues(row.field);

                    if (row.calculated || isApproved || isLocked) {
                      return formatValue(value);
                    }
                    if (allowedValues && allowedValues.length > 0) {
                      const selectedValue = allowedValues.some(
                        (allowedValue) => String(allowedValue) === String(value),
                      )
                        ? String(value)
                        : "";

                      return (
                        <select
                          value={selectedValue}
                          onChange={(e) => setPendingChanges({ ...pendingChanges, [path]: e.target.value })}
                          className="w-full border border-gray-300 rounded-md p-1.5 text-sm bg-white font-medium text-gray-800"
                        >
                          {selectedValue === "" && (
                            <option value="" disabled>
                              Select
                            </option>
                          )}
                          {allowedValues.map((v) => (
                            <option key={String(v)} value={String(v)}>
                              {formatValue(v)}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    if (typeof row.field?.value === "number") {
                      return (
                        <input
                          type="number"
                          value={value as number}
                          onChange={(e) => setPendingChanges({ ...pendingChanges, [path]: parseFloat(e.target.value) })}
                          className="w-full border border-gray-300 rounded-md p-1.5 text-sm bg-white font-medium text-gray-800"
                        />
                      );
                    }
                    const isYn = typeof row.field?.value === "boolean" || (typeof row.field?.value === "string" && ["y", "n", "yes", "no"].includes(row.field.value.toLowerCase()));
                    const hasLegacyWorkflowValue = isHiddenAddonOption(value);
                    if (isYn || hasLegacyWorkflowValue || row.field?.value == null) {
                      const stringVal = String(value).toLowerCase();
                      const isY = stringVal === "y" || stringVal === "yes" || stringVal === "true";
                      return (
                        <select
                          value={hasLegacyWorkflowValue ? "" : isY ? "y" : "n"}
                          onChange={(e) => setPendingChanges({ ...pendingChanges, [path]: e.target.value })}
                          className="w-full border border-gray-300 rounded-md p-1.5 text-sm bg-white font-medium text-gray-800"
                        >
                          {hasLegacyWorkflowValue && (
                            <option value="" disabled>
                              Select
                            </option>
                          )}
                          <option value="y">Y</option>
                          <option value="n">N</option>
                        </select>
                      );
                    }
                    return (
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => setPendingChanges({ ...pendingChanges, [path]: e.target.value })}
                        className="w-full border border-gray-300 rounded-md p-1.5 text-sm bg-white font-medium text-gray-800"
                      />
                    );
                  })()}
                </td>
                <td className="px-5 py-5 align-top text-sm leading-6">
                  <Reasoning field={row.field} projectId={projectId} signals={stage.fields_to_show?._signals} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
            ) : (
              <span className="text-gray-500">Review the addon decisions before approving.</span>
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
                        const row = ADDON_ROWS.find((r) => `stage_5.${r.path}` === path);
                        return {
                          key: path,
                          label: row?.label ?? path,
                          previousValue: getNestedField(fields, row?.path ?? "")?.value ?? null,
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
                {isApproving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {isApproved ? "Approved" : "Approve Data"}
              </button>
            )}

            {isApproved && (
              <ReviseStageButton
                projectId={projectId!}
                stage={5}
                stageName="Add-ons & Duty"
                onRevised={() => refetch()}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Addons;
