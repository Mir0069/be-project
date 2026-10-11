import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Loader2, Download, AlertCircle, UserPlus } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { apiClient } from "@/shared/api/client";
import { useProposal, useProposalStage, useApproveProposalStage, usePatchProposalField, usePatchStage7Cost, usePatchStage7Quantity, usePatchStage7ChargeSelection, usePatchStage7OptionalAddOnStatus, useFinalParametersSchema } from "@/features/projects/query/proposalsQuery";
import { ReviseStageButton } from "@/features/estimator/workspace/pages/components/ReviseStageButton";
import { RevisionInfo } from "@/features/estimator/workspace/pages/components/RevisionInfo";
import { FieldFeedbackModal } from "@/features/estimator/workspace/pages/components/FieldFeedbackModal";
import AssignApproverModal from "@/features/estimator/workspace/pages/components/AssignApproverModal";
import { useFieldFeedbackQueue } from "@/features/estimator/workspace/hooks/useFieldFeedbackQueue";
import { toFeedbackRequests } from "@/features/estimator/workspace/utils/fieldFeedback";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { useAuth } from "@/context/AuthContext";
import type { EligibleApprover, Stage7Approval } from "@/services/proposals";

import { formatFinalParameterReasoning } from "@/features/estimator/workspace/utils/finalParameterReasoning";
import WorkspaceAnalysisStatus from "@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus";
import { ConfidenceBadge } from "@/features/estimator/workspace/components/ConfidenceBadge";
import { useStageArrivalRefresh } from "@/features/estimator/workspace/hooks/useStageArrivalRefresh";
import {
  buildCalculationSummary,
  expandUnitPricingRows,
  formatCalculationValue,
  getCalculationGrandTotal,
  getCalculationPricingTotals,
  normalizePricingCategories,
  type BackendPricingCategory,
  type CalculationPricingCategory,
  type CalculationPricingRow,
  type OptionalAddOnStatus,
} from "@/features/estimator/workspace/utils/calculationContract";
import {
  formatUnitOption,
  formatUnitValue,
  formatProposalStatus,
  getApprovedUnitRows,
  getUnitValue,
  summarizeMixedUnitOption,
} from "@/features/estimator/workspace/utils/multiUnitDisplay";

// Cell mappings and categories are now fetched from the backend via useFinalParametersSchema

const toSafeFilenamePart = (value?: string | null): string =>
  (value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);

type ComputedPricingSnapshot = {
  final_price?: number | null;
  grand_total?: number | null;
  optional_add_on_total?: number | null;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const OPTIONAL_ADD_ON_CELLS = new Set(["C107", "C109", "C110"]);
const ADDITIONAL_CHARGE_CELLS = new Set([
  "C75", "C76", "C77", "C78", "C79", "C80", "C81", "C82",
  "C69", "C85", "C89", "C90", "C91", "C93", "C94",
]);

const isDutyField = (field: { cell: string; label: string }): boolean =>
  field.cell === "C90" || field.label.trim().toLowerCase().startsWith("duty");

const formatCurrency = (value: number | null): string =>
  value === null ? "—" : currencyFormatter.format(value);

const formatPercentageInput = (fraction: number): string =>
  Number.isFinite(fraction) ? String(Number((fraction * 100).toFixed(2))) : "0";

const formatApprovalDate = (value?: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
const FinalParameters = () => {
  const { projectId, project } = useProjectRoute();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, role } = useAuth();
  const [showAssignApprover, setShowAssignApprover] = useState(false);
  const [recentlyAssignedApprover, setRecentlyAssignedApprover] = useState<EligibleApprover | null>(null);

  const { data: stage7, isLoading: isLoading7, isError: isError7, refetch: refetch7 } = useProposalStage(projectId, 7);
  const { data: stage4, isLoading: isLoading4, refetch: refetch4 } = useProposalStage(projectId, 4);
  const { data: stage5, isLoading: isLoading5, refetch: refetch5 } = useProposalStage(projectId, 5);
  const { data: proposal } = useProposal(projectId);
  const { data: schemaCategories, refetch: refetchSchema } = useFinalParametersSchema(projectId);
  const shouldRefreshOnArrival =
    (location.state as { refreshWorkflowStage?: number } | null)?.refreshWorkflowStage === 7;
  const refetchFinalParameters = useCallback(
    () => Promise.all([refetch7(), refetchSchema()]),
    [refetch7, refetchSchema],
  );
  useStageArrivalRefresh(shouldRefreshOnArrival, refetchFinalParameters);
  const approveMutation = useApproveProposalStage();
  const patchCostMutation = usePatchStage7Cost();
  const patchQuantityMutation = usePatchStage7Quantity();
  const patchChargeSelectionMutation = usePatchStage7ChargeSelection();
  const patchOptionalAddOnStatusMutation = usePatchStage7OptionalAddOnStatus();
  const patchFieldMutation = usePatchProposalField();
  const { collect: collectFeedback, modalProps: feedbackModalProps } = useFieldFeedbackQueue();

  const [costOverrides, setCostOverrides] = useState<Record<string, number>>({});
  const [quantityOverrides, setQuantityOverrides] = useState<Record<string, number>>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [editingQtyCell, setEditingQtyCell] = useState<string | null>(null);
  const [editQtyValue, setEditQtyValue] = useState<string>("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRevisionInProgress, setIsRevisionInProgress] = useState(false);
  const [chargeSelections, setChargeSelections] = useState<Record<string, "Y" | "N">>({});
  const [lastKnownFinalPrice, setLastKnownFinalPrice] = useState<number | null>(null);
  const [optionalAddOnStatuses, setOptionalAddOnStatuses] = useState<Record<string, OptionalAddOnStatus>>({});
  const [editingUnitCell, setEditingUnitCell] = useState<{ unitKey: string; fieldName: string } | null>(null);
  const [editUnitCellVal, setEditUnitCellVal] = useState<string>("");

  const handleUnitCellSave = async (unitKey: string, fieldName: string, rawVal: string, isNumeric = false) => {
    setEditingUnitCell(null);
    let parsedVal: any = rawVal.trim();
    if (isNumeric) {
      if (parsedVal === "") return;
      const num = Number(parsedVal);
      if (!Number.isFinite(num) || num < 0) {
        showToast("error", "Must be a valid non-negative number");
        return;
      }
      parsedVal = num;
    }

    try {
      await patchFieldMutation.mutateAsync({
        projectId: projectId!,
        fieldPath: `stage_4.units.${unitKey}.${fieldName}`,
        value: parsedVal,
      });
      showToast("success", `Updated Unit ${unitKey} ${fieldName.replace("value_", "").replace(/_/g, " ")}`);
      await Promise.all([refetch7(), refetch4(), refetch5(), refetchSchema()]);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to update unit field");
    }
  };

  const renderEditableUnitCell = (
    unitKey: string,
    fieldName: string,
    currentValue: unknown,
    isNumeric = false,
    step?: string
  ) => {
    const isEditing = editingUnitCell?.unitKey === unitKey && editingUnitCell?.fieldName === fieldName;
    const canEdit = !isApproved && !isLocked;

    if (isEditing && canEdit) {
      return (
        <input
          autoFocus
          type={isNumeric ? "number" : "text"}
          step={step ?? (isNumeric ? "0.01" : undefined)}
          min={isNumeric ? "0" : undefined}
          value={editUnitCellVal}
          onChange={(e) => setEditUnitCellVal(e.target.value)}
          onBlur={() => void handleUnitCellSave(unitKey, fieldName, editUnitCellVal, isNumeric)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void handleUnitCellSave(unitKey, fieldName, editUnitCellVal, isNumeric);
            } else if (e.key === "Escape") {
              setEditingUnitCell(null);
            }
          }}
          className="w-20 px-1.5 py-0.5 text-xs border-2 border-red-400 rounded text-center outline-none bg-white shadow-sm"
        />
      );
    }

    const displayVal = formatUnitValue(currentValue);

    if (!canEdit) {
      return <span>{displayVal}</span>;
    }

    return (
      <button
        type="button"
        onClick={() => {
          setEditingUnitCell({ unitKey, fieldName });
          setEditUnitCellVal(currentValue != null && currentValue !== "" ? String(currentValue) : "");
        }}
        title="Click to edit value"
        className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-800 hover:bg-yellow-100 hover:text-yellow-900 border border-transparent hover:border-yellow-400 transition-colors"
      >
        <span className="font-medium underline decoration-dashed decoration-gray-300 underline-offset-2">{displayVal}</span>
      </button>
    );
  };

  useEffect(() => {
    if (stage7?.fields_to_show?.cost_overrides) {
      setCostOverrides(stage7.fields_to_show.cost_overrides as unknown as Record<string, number>);
    }
    if (stage7?.fields_to_show?.quantity_overrides) {
      setQuantityOverrides(stage7.fields_to_show.quantity_overrides as unknown as Record<string, number>);
    }
    if (stage7?.fields_to_show?.additional_charge_selections) {
      setChargeSelections(stage7.fields_to_show.additional_charge_selections as unknown as Record<string, "Y" | "N">);
    }
    if (stage7?.fields_to_show?.optional_add_on_statuses) {
      setOptionalAddOnStatuses(stage7.fields_to_show.optional_add_on_statuses as unknown as Record<string, OptionalAddOnStatus>);
    }
  }, [stage7]);

  useEffect(() => {
    if (!projectId) return;

    // Use typical EventSource logic withCredentials to bypass cross origin token limits where applicable
    // or same origin.
    const url = `/api/v1/proposals/${projectId}/stages/7/stream`;

    const evtSource = new EventSource(url, { withCredentials: true });

    evtSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "STAGE_7_COST_UPDATED" && payload.cost_overrides) {
          setCostOverrides(payload.cost_overrides);
          void Promise.all([refetch7(), refetchSchema()]);
        } else if (payload.event === "STAGE_7_QUANTITY_UPDATED" && payload.quantity_overrides) {
          setQuantityOverrides(payload.quantity_overrides);
          void Promise.all([refetch7(), refetchSchema()]);
        } else if (
          payload.event === "STAGE_7_CHARGE_SELECTION_UPDATED" ||
          payload.event === "STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED"
        ) {
          void Promise.all([refetch7(), refetchSchema()]);
        } else if (payload.event === "STAGE_PUSHED") {
          if (payload.fields_to_show?.cost_overrides) {
            setCostOverrides(payload.fields_to_show.cost_overrides);
          }
          if (payload.fields_to_show?.quantity_overrides) {
            setQuantityOverrides(payload.fields_to_show.quantity_overrides);
          }
          void refetch7();
        }
      } catch (err) {
        console.error("Failed to parse SSE event", err);
      }
    };

    evtSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      evtSource.close();
    };

    return () => {
      evtSource.close();
    };
  }, [projectId, refetch7, refetchSchema]);

  const { computed_snapshot } = (stage7?.fields_to_show || {}) as {
    computed_snapshot?: ComputedPricingSnapshot;
  };
  const isApproved = stage7?.status === "APPROVED";
  const isReprocessing = project?.analysisStatus === "PROCESSING";
  const pricingSnapshot = computed_snapshot || {};

  const backendCalculation =
    schemaCategories && typeof schemaCategories === "object" && !Array.isArray(schemaCategories)
      ? (schemaCategories as {
        categories?: BackendPricingCategory[];
        finalPrice?: number;
        optionalAddOnTotal?: number;
        grandTotal?: number;
      })
      : null;
  const rawSchemaCategories = Array.isArray(schemaCategories)
    ? schemaCategories
    : backendCalculation?.categories;

  const normalizedPricingCategories = normalizePricingCategories(
    rawSchemaCategories as BackendPricingCategory[] | undefined,
    costOverrides,
    quantityOverrides,
  ).map((category) => ({
    ...category,
    fields: category.fields.map((field) => ({
      ...field,
      optionalStatus: OPTIONAL_ADD_ON_CELLS.has(field.cell)
        ? optionalAddOnStatuses[field.cell] ?? field.optionalStatus
        : field.optionalStatus,
    })),
  }));
  const basePricingCategories = normalizedPricingCategories.filter(
    (category) => !category.fields.some((field) => OPTIONAL_ADD_ON_CELLS.has(field.cell)),
  );
  const optionalAddOnCategories = normalizedPricingCategories.filter(
    (category) => category.fields.some((field) => OPTIONAL_ADD_ON_CELLS.has(field.cell)),
  );
  const pricingTotals = getCalculationPricingTotals(normalizedPricingCategories);

  // Keep a live preview available while the latest worksheet snapshot is not
  // available. The backend supplies percentage-row amounts after applying the
  // workbook subtotal rules, so the visible total remains formula-aware.
  const liveLineItemTotal = pricingTotals.all;

  const snapshotFinalPrice = asFiniteNumber(pricingSnapshot.final_price);
  const usableSnapshotFinalPrice = snapshotFinalPrice !== null && snapshotFinalPrice > 0
    ? snapshotFinalPrice
    : null;
  const liveFinalPrice = liveLineItemTotal > 0 ? liveLineItemTotal : null;
  const persistedFinalPrice = asFiniteNumber(project?.estimatedCost);
  // A zero estimatedCost means the backend's Graph-based snapshot has never
  // successfully computed a price for this project — not that it costs $0.
  const usablePersistedFinalPrice = persistedFinalPrice !== null && persistedFinalPrice > 0
    ? persistedFinalPrice
    : null;

  // A zero snapshot is an empty/uncomputed result, not a valid replacement for
  // the price already shown to the estimator.
  useEffect(() => {
    if (isReprocessing) return;

    if (usableSnapshotFinalPrice !== null) {
      setLastKnownFinalPrice(usableSnapshotFinalPrice);
      return;
    }

    // Only learn from the live worksheet while Stage 7 is not yet approved.
    // This prevents a stale project-level value from overwriting the price
    // that was visible immediately before approval.
    if (!isApproved && liveFinalPrice !== null) {
      setLastKnownFinalPrice(liveFinalPrice);
      return;
    }

    if (lastKnownFinalPrice === null && persistedFinalPrice !== null && persistedFinalPrice > 0) {
      setLastKnownFinalPrice(persistedFinalPrice);
    }
  }, [isApproved, isReprocessing, liveFinalPrice, persistedFinalPrice, usableSnapshotFinalPrice, lastKnownFinalPrice]);

  // The authoritative computed snapshot wins whenever it's available; the
  // remembered value covers a refetch that hasn't produced one yet; the live
  // line-item estimate covers a fresh mount (e.g. navigating back to this
  // page) before either of those exist; the persisted project cost is the
  // last resort, and only counts if it's a real number, not the zero a
  // never-computed project defaults to. Applies whether or not Stage 7 is
  // approved — approval doesn't retroactively make the live estimate invalid,
  // it just stops being editable.
  const contractFinalPrice = asFiniteNumber(backendCalculation?.finalPrice);
  const usableContractFinalPrice = contractFinalPrice !== null && contractFinalPrice > 0
    ? contractFinalPrice
    : null;

  const finalPrice = isReprocessing
    ? null
    : usableSnapshotFinalPrice
      ?? usableContractFinalPrice
      ?? lastKnownFinalPrice
      ?? liveFinalPrice
      ?? usablePersistedFinalPrice;
  const optionalAddOnTotal = asFiniteNumber(backendCalculation?.optionalAddOnTotal) ?? pricingTotals.optional;
  const grandTotal = isReprocessing
    ? null
    : asFiniteNumber(backendCalculation?.grandTotal)
      ?? asFiniteNumber(pricingSnapshot.grand_total)
      ?? getCalculationGrandTotal(finalPrice, optionalAddOnTotal);

  if (isLoading7 || isLoading4 || isLoading5) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (isError7) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600">
        <p>Failed to load final parameters.</p>
        <button
          onClick={() => refetch7()}
          className="mt-4 rounded-md bg-red-100 px-4 py-2 font-medium hover:bg-red-200"
        >
          Retry
        </button>
      </div>
    );
  }


  const getStage5Field = (path: string): Record<string, any> | undefined => {
    const val = path.split(".").reduce((obj: any, key) => obj?.[key], stage5?.fields_to_show);
    return val && typeof val === "object" ? val : undefined;
  };

  const getStage5Reasoning = (path: string, label: string): string[] => {
    const defaults: Record<string, string> = {
      "calculated.total_sqft": "Width × length ÷ 144 per approved unit.",
      "calculated.total_weight": "Total Sqft × glass weight rate.",
      "calculated.perimeter_lf": "2 × (width + length) ÷ 12 per approved unit.",
      "calculated.silicone_tubes": "Approved silicone quantity from the calculation stage.",
    };

    const val = path.split(".").reduce((obj: any, key) => obj?.[key], stage5?.fields_to_show);
    const field = val && typeof val === "object" ? val : undefined;

    return formatFinalParameterReasoning({
      reason: defaults[path] || field?.reasoning,
      citation: field?.extracted_citation ?? field?.citation,
      fallback: defaults[path] || `Calculated for ${label.toLowerCase()} based on approved project specifications.`,
      label,
    });
  };

  const { approved_stages_summary } = (stage7?.fields_to_show || {}) as any;
  const approvedUnits = getApprovedUnitRows(approved_stages_summary?.units);
  const proposalStatus = proposal?.stage_6_proposal?.status;

  const totalSqFt = asFiniteNumber(Number(approved_stages_summary?.stage_5?.calculated?.total_sqft));
  const pricePerSqFt = finalPrice !== null && totalSqFt !== null && totalSqFt > 0
    ? finalPrice / totalSqFt
    : null;

  // The backend now locks Stage 7 whenever an earlier stage reopens (see
  // _lockStage7IfUpstreamOpen), but that only takes effect on the next AI
  // push/re-extraction. This is a safety net for proposals already stuck in
  // the stale state — it never unlocks anything status="LOCKED" wouldn't.
  const previousStagesApproved =
    (stage7?.fields_to_show as any)?.previous_stages_approved !== false;
  const isLocked = stage7?.status === "LOCKED" || (!isApproved && !previousStagesApproved);

  const approval = ((stage7?.fields_to_show as any)?.approval ?? null) as Stage7Approval | null;
  const displayedApproverId = recentlyAssignedApprover?.id ?? approval?.approverId;
  const displayedApproverName = recentlyAssignedApprover?.name ?? approval?.approverName;
  const isAssignedApprover =
    !!displayedApproverId && !!user?.id && String(displayedApproverId) === String(user.id);
  const canApproveAsAdmin = role === "SUPER_ADMIN" || role === "SYSTEM_ADMIN";
  const canApproveNow = isAssignedApprover || canApproveAsAdmin;
  const calculationSummary = buildCalculationSummary(stage4?.fields_to_show, stage5?.fields_to_show)
    .filter((item) => !["panel_count", "total_man_hours", "total_packaging"].includes(item.key))
    .map((item) => item.key === "perimeter_lf" ? { ...item, label: "Perimeter LF" } : item);

  const getCalculationReasoning = (item: ReturnType<typeof buildCalculationSummary>[number]): string[] => {
    if (item.sourcePath.startsWith("stage_5.")) {
      return getStage5Reasoning(item.sourcePath.replace(/^stage_5\./, ""), item.label);
    }

    return formatFinalParameterReasoning({
      reason: item.reasoning,
      fallback: `Backend supplied ${item.label.toLowerCase()} from the approved takeoff.`,
      label: item.label,
    });
  };

  const handleApprove = () => {
    approveMutation.mutate(
      { projectId: projectId!, stage: 7 },
      {
        onSuccess: () => {
          showToast("success", "Stage 7 Approved");
        },
      }
    );
  };

  // This screen has no Update button: a cost cell saves on blur, so the feedback
  // prompt hangs off that commit instead.
  const handleCostEdit = async (cell: string, value: number, label: string) => {
    const previousValue = costOverrides[cell];
    setCostOverrides(prev => ({ ...prev, [cell]: value }));

    const answers = await collectFeedback(
      toFeedbackRequests([{ key: cell, label, previousValue, newValue: value }])
    );

    patchCostMutation.mutate(
      { projectId: projectId!, cell, cost: value, ...(answers[cell] ? { feedback: answers[cell]! } : {}) },
      {
        onSuccess: () => {
          void refetchSchema();
        },
        onError: () => {
          showToast("error", `Failed to update ${label}. Please try again.`);
          refetch7();
        }
      }
    );
  };

  // editKey identifies the row being edited; unit lines of one product share its cost cell.
  const onCellBlur = (cell: string, label = cell, isPercentage = false, editKey = cell) => {
    if (editingCell === editKey) {
      if (!editValue.trim()) {
        setEditingCell(null);
        return;
      }
      const parsed = Number(editValue);
      const value = isPercentage ? parsed / 100 : parsed;
      if (!Number.isFinite(parsed)) {
        setEditingCell(null);
        return;
      }
      if (value < 0) {
        showToast("error", "Negative values are not allowed");
        setEditingCell(null);
        return;
      }
      if (value !== costOverrides[cell]) {
        void handleCostEdit(cell, value, label);
      }
      setEditingCell(null);
    }
  };

  const onCellKeyDown = (e: React.KeyboardEvent, cell: string, label?: string, isPercentage = false, editKey = cell) => {
    if (e.key === "Enter") {
      onCellBlur(cell, label, isPercentage, editKey);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const onQtyBlur = (cell: string, label = cell) => {
    if (editingQtyCell === cell) {
      if (!editQtyValue.trim()) {
        setEditingQtyCell(null);
        return;
      }
      const parsed = Number(editQtyValue);
      if (!Number.isFinite(parsed)) {
        setEditingQtyCell(null);
        return;
      }
      if (parsed < 0) {
        showToast("error", "Negative quantities are not allowed");
        setEditingQtyCell(null);
        return;
      }
      if (parsed !== quantityOverrides[cell]) {
        void handleQuantityEdit(cell, parsed, label);
      }
      setEditingQtyCell(null);
    }
  };

  const onQtyKeyDown = (e: React.KeyboardEvent, cell: string, label?: string) => {
    if (e.key === "Enter") {
      onQtyBlur(cell, label);
    } else if (e.key === "Escape") {
      setEditingQtyCell(null);
    }
  };

  const handleQuantityEdit = async (cell: string, newQuantity: number, label: string) => {
    const previousQuantity = quantityOverrides[cell];
    setQuantityOverrides((prev) => ({ ...prev, [cell]: newQuantity }));

    try {
      await patchQuantityMutation.mutateAsync({
        projectId: projectId!,
        cell,
        quantity: newQuantity,
      });
      showToast("success", `Updated ${label} quantity to ${newQuantity}`);
      void Promise.all([refetch7(), refetchSchema()]);
    } catch {
      showToast("error", `Failed to update ${label} quantity. Please try again.`);
      setQuantityOverrides((prev) => {
        const next = { ...prev };
        if (previousQuantity !== undefined) {
          next[cell] = previousQuantity;
        } else {
          delete next[cell];
        }
        return next;
      });
    }
  };

  const handleChargeSelectionChange = (
    cell: string,
    label: string,
    selection: "Y" | "N",
  ) => {
    // Keep the control responsive while the server persists and recalculates
    // the updated final price in the background.
    setChargeSelections((current) => ({ ...current, [cell]: selection }));
    patchChargeSelectionMutation.mutate(
      { projectId: projectId!, cell, selection },
      {
        onError: () => {
          showToast("error", `Failed to update ${label}. Please try again.`);
          void Promise.all([refetch7(), refetchSchema()]);
        },
      },
    );
  };

  const handleOptionalAddOnStatusChange = (cell: string, label: string, status: OptionalAddOnStatus) => {
    const previousStatus = optionalAddOnStatuses[cell];
    setOptionalAddOnStatuses((current) => ({ ...current, [cell]: status }));
    patchOptionalAddOnStatusMutation.mutate(
      { projectId: projectId!, cell, status },
      {
        onError: () => {
          showToast("error", `Failed to update ${label} acceptance. Please try again.`);
          setOptionalAddOnStatuses((current) => ({
            ...current,
            [cell]: previousStatus ?? "NOT_SELECTED",
          }));
          void Promise.all([refetch7(), refetchSchema()]);
        },
      },
    );
  };

  const renderPricingCategory = (category: CalculationPricingCategory) => (
  <section key={category.title} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
    <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
      <h3 className="text-sm font-semibold text-gray-900">{category.title}</h3>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-200 bg-white text-xs font-semibold uppercase text-gray-500">
            <th className="w-[45%] px-6 py-3">Item</th>
            <th className="w-[25%] px-6 py-3 text-center">Cost / Unit ($)</th>
            <th className="w-[15%] px-6 py-3 text-center">
              {category.fields.some((field) => OPTIONAL_ADD_ON_CELLS.has(field.cell))
                ? "Acceptance"
                : category.fields.some((field) => ADDITIONAL_CHARGE_CELLS.has(field.cell) || isDutyField(field))
                ? category.fields.some((field) => !ADDITIONAL_CHARGE_CELLS.has(field.cell) && !isDutyField(field) && field.quantity !== null && !field.isPercentage)
                  ? "Qty / Y/N"
                  : "Y/N"
                : "Qty"}
            </th>
            <th className="w-[15%] px-6 py-3 text-right">Price ($)</th>
          </tr>
        </thead>
        <tbody>
          {expandUnitPricingRows(category.fields).map((field: CalculationPricingRow) => {
            const cost = field.unitCost ?? 0;
            const quantity = field.quantity ?? 0;
            const isPercentage = field.isPercentage;
            const isEngineering = field.label.toLowerCase() === "engineering";
            const isDuty = isDutyField(field);
            const isAdditionalCharge = ADDITIONAL_CHARGE_CELLS.has(field.cell) || isDuty;
            const defaultSelection = isDuty ? "Y" : "N";
            const isOptionalAddOn = OPTIONAL_ADD_ON_CELLS.has(field.cell);
            const optionalStatus = isOptionalAddOn
              ? optionalAddOnStatuses[field.cell] ?? field.optionalStatus ?? "NOT_SELECTED"
              : null;
            const rowLabel = field.unitKey ? `Unit ${field.unitKey} · ${field.label}` : field.label;

            return (
              <tr key={field.rowKey} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 text-sm text-gray-700 font-medium border-r border-gray-100">
                  <span>{rowLabel}</span>
                </td>
                <td className="px-6 py-3 text-center border-r border-gray-100 bg-yellow-50/30">
                  {editingCell === field.rowKey && !isApproved && !isLocked && !isEngineering ? (
                    <input
                      autoFocus
                      type={isPercentage ? "text" : "number"}
                      inputMode={isPercentage ? "decimal" : "numeric"}
                      min={isPercentage ? undefined : "0"}
                      value={editValue}
                      onChange={(e) =>
                        setEditValue(
                          isPercentage
                            ? e.target.value.replace(/[^\d.]/g, "")
                            : e.target.value,
                        )
                      }
                      onBlur={() => onCellBlur(field.cell, field.label, isPercentage, field.rowKey)}
                      onKeyDown={(e) => onCellKeyDown(e, field.cell, field.label, isPercentage, field.rowKey)}
                      className="w-24 px-2 py-1 text-sm border-2 border-red-400 rounded text-center outline-none bg-white shadow-sm"
                      step={isPercentage ? undefined : "0.01"}
                    />
                  ) : (
                    <button
                      onClick={() => {
                        if (!isApproved && !isLocked && !isEngineering) {
                          setEditingCell(field.rowKey);
                          setEditValue(isPercentage ? formatPercentageInput(cost) : cost.toString());
                        }
                      }}
                      disabled={isApproved || isLocked || isEngineering}
                      className={`w-24 px-2 py-1 text-sm rounded border ${isApproved || isLocked || isEngineering
                          ? "bg-gray-100 border-gray-200 text-gray-600 cursor-not-allowed"
                          : "bg-yellow-100 border-yellow-300 text-yellow-900 hover:bg-yellow-200 shadow-sm"
                        } font-medium transition-colors`}
                    >
                      {isPercentage ? `${formatPercentageInput(cost)}%` : cost.toFixed(2)}
                    </button>
                  )}
                </td>
                <td className="px-6 py-3 text-center text-sm text-gray-600 border-r border-gray-100">
                  {isOptionalAddOn ? (
                    <button
                      type="button"
                      aria-label={`${field.label}: ${optionalStatus === "ACCEPTED" ? "accepted" : "not accepted"}`}
                      title={optionalStatus === "ACCEPTED" ? "Accepted" : "Click to accept"}
                      disabled={isApproved || isLocked || patchOptionalAddOnStatusMutation.isPending}
                      onClick={() =>
                        handleOptionalAddOnStatusChange(
                          field.cell,
                          field.label,
                          optionalStatus === "ACCEPTED" ? "NOT_SELECTED" : "ACCEPTED",
                        )
                      }
                      className={`mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                        optionalStatus === "ACCEPTED"
                          ? "text-emerald-600 hover:bg-emerald-50"
                          : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                      } ${isApproved || isLocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      {optionalStatus === "ACCEPTED" ? (
                        <Check size={20} strokeWidth={2.5} aria-hidden="true" />
                      ) : (
                        <Circle size={20} strokeWidth={2} aria-hidden="true" />
                      )}
                    </button>
                  ) : isAdditionalCharge ? (
                    <select
                      aria-label={`${field.label} selection`}
                      value={chargeSelections[field.cell] ?? field.selection ?? defaultSelection}
                      disabled={isApproved || isLocked || patchChargeSelectionMutation.isPending}
                      onChange={(event) =>
                        handleChargeSelectionChange(
                          field.cell,
                          field.label,
                          event.target.value as "Y" | "N",
                        )
                      }
                      className="mx-auto block min-w-[112px] rounded border border-gray-300 bg-white px-3 py-1 text-left text-sm font-medium text-gray-700 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:bg-gray-100"
                    >
                      <option value="N">N</option>
                      <option value="Y">Y</option>
                    </select>
                  ) : field.cell === "C71" || field.cell === "C73" ? (
                    <span
                      title={
                        field.cell === "C71"
                          ? "Total man hours calculated from Approved Unit Breakdown"
                          : "Total packaging calculated from Approved Unit Breakdown"
                      }
                      className="inline-block w-24 px-2 py-1 text-sm font-semibold text-gray-700 bg-gray-100 rounded border border-gray-200 text-center cursor-default"
                    >
                      {quantity.toFixed(2)}
                    </span>
                  ) : field.unitKey && field.quantity === null ? (
                    <span className="text-xs text-gray-500" title="Add this unit's width and length in the Approved Unit Breakdown">
                      Needs width/length
                    </span>
                  ) : field.quantity !== null && !isPercentage ? (
                    editingQtyCell === field.quantityKey && !isApproved && !isLocked ? (
                      <input
                        autoFocus
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={editQtyValue}
                        onChange={(e) => setEditQtyValue(e.target.value)}
                        onBlur={() => onQtyBlur(field.quantityKey, rowLabel)}
                        onKeyDown={(e) => onQtyKeyDown(e, field.quantityKey, rowLabel)}
                        className="w-24 px-2 py-1 text-sm border-2 border-red-400 rounded text-center outline-none bg-white shadow-sm"
                        step="0.01"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          if (!isApproved && !isLocked) {
                            setEditingQtyCell(field.quantityKey);
                            setEditQtyValue(quantity.toString());
                          }
                        }}
                        disabled={isApproved || isLocked}
                        title={isApproved || isLocked ? undefined : "Click to edit quantity"}
                        className={`w-24 px-2 py-1 text-sm rounded border ${
                          isApproved || isLocked
                            ? "bg-gray-100 border-gray-200 text-gray-600 cursor-not-allowed"
                            : "bg-yellow-100 border-yellow-300 text-yellow-900 hover:bg-yellow-200 shadow-sm"
                        } font-medium transition-colors`}
                      >
                        {quantity.toFixed(2)}
                      </button>
                    )
                  ) : "-"}
                </td>
                <td className="px-6 py-3 text-right text-sm font-semibold text-gray-900 bg-gray-50/50">
                  {field.amount !== null && Math.abs(field.amount) > 0
                    ? currencyFormatter.format(field.amount)
                    : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </section>
);

  return (
    <div className="w-full min-h-[calc(100vh-8rem)] space-y-6 pb-20">
      <FieldFeedbackModal {...feedbackModalProps} />
      <div className="flex items-start justify-between border-l-4 border-red-500 px-5 py-1">
        <div>
          <h2 className="text-2xl font-semibold leading-8 text-red-500">Final Parameters</h2>
        </div>
        <div className="flex items-center gap-3">
          <WorkspaceAnalysisStatus />
          <span
            className={`px-3 py-1 text-xs font-semibold rounded-full uppercase tracking-wider ${stage7?.status === "APPROVED"
                ? "bg-emerald-100 text-emerald-800"
                : stage7?.status === "PENDING_APPROVAL"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-gray-100 text-gray-700"
              }`}
          >
            {stage7?.status ? stage7.status.replace("_", " ") : "PENDING"}
          </span>
          <span
            className={`px-3 py-1 text-xs font-semibold rounded-full uppercase tracking-wider ${proposalStatus === "READY_FOR_PROPOSAL_EXCEL" || proposalStatus === "READY_FOR_EXCEL"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-gray-100 text-gray-700"
              }`}
            title="Proposal workbook readiness"
          >
            Proposal: {formatProposalStatus(proposalStatus)}
          </span>
        </div>
      </div>

      {/* READ-ONLY SUMMARY SECTION */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
          <h3 className="font-semibold text-gray-900">Project Specifications Summary</h3>
        </div>
        <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">Project Name</p>
            <p className="font-medium text-gray-900">{approved_stages_summary?.stage_1?.project_name || "-"}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Glass Type</p>
            <p className="font-medium text-gray-900">
              {summarizeMixedUnitOption(approvedUnits, "value_glass_type") ?? (approved_stages_summary?.stage_2?.glass_type || "-")}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Frame Type</p>
            <p className="font-medium text-gray-900">
              {summarizeMixedUnitOption(approvedUnits, "value_frame_type") ?? (approved_stages_summary?.stage_3?.frame_type || "-")}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Total Sqft</p>
            <p className="font-medium text-gray-900">{approved_stages_summary?.stage_5?.calculated?.total_sqft || "-"}</p>
          </div>
        </div>
        {approvedUnits.length > 0 && (
          <div className="border-t border-gray-200 px-6 py-5">
            <div className="mb-3">
              <h4 className="font-semibold text-gray-900">Approved Unit Breakdown</h4>
              <p className="mt-1 text-sm text-gray-500">
                Each unit keeps its own dimensions, glass, frame, and take-off values.
              </p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-[1360px] w-full text-left text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr>
                    {[
                      "Unit",
                      "Drawing",
                      "Location",
                      "Frame",
                      "Glass",
                      "Thickness",
                      "Width (in)",
                      "Length (in)",
                      "Panels",
                      "Units",
                      "Vertical Crossbeams",
                      "Horizontal Crossbeams",
                      "Man Hours",
                      "Packaging",
                    ].map((label, idx) => (
                      <th
                        key={label}
                        className={`whitespace-nowrap px-3 py-2 font-semibold ${
                          idx === 0 ? "sticky left-0 z-10 bg-gray-50" : ""
                        }`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {approvedUnits.map(({ key, data }) => (
                    <tr key={key} className="border-t border-gray-100 text-gray-700">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-gray-900">{key}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_drawing_number", getUnitValue(data, "value_drawing_number"), false)}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_location", getUnitValue(data, "value_location"), false)}</td>
                      <td className="px-3 py-2">{formatUnitOption(getUnitValue(data, "value_frame_type"))}</td>
                      <td className="px-3 py-2">{formatUnitOption(getUnitValue(data, "value_glass_type"))}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_glass_thickness", getUnitValue(data, "value_glass_thickness"), true)}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_width_in", getUnitValue(data, "value_width_in"), true)}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_length_in", getUnitValue(data, "value_length_in"), true)}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_panel_count", getUnitValue(data, "value_panel_count"), true, "1")}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_num_units", getUnitValue(data, "value_num_units"), true, "1")}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_vertical_rafter_count", getUnitValue(data, "value_vertical_rafter_count"), true, "1")}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_horizontal_rafter_count", getUnitValue(data, "value_horizontal_rafter_count"), true, "1")}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_man_hours", getUnitValue(data, "value_man_hours"), true)}</td>
                      <td className="px-3 py-2">{renderEditableUnitCell(key, "value_packaging", getUnitValue(data, "value_packaging"), true)}</td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {stage5 && (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm mb-6">
          <table className="w-full table-fixed text-left text-sm">
            <tbody>
              {calculationSummary.map((item, idx) => {
                const stage5Field = item.sourcePath.startsWith("stage_5.")
                  ? getStage5Field(item.sourcePath.replace(/^stage_5\./, ""))
                  : undefined;

                return (
                  <tr key={item.key} className={`border-gray-100 bg-white ${idx > 0 ? "border-t" : ""}`}>
                    <td className="w-1/4 px-5 py-5 align-top text-sm font-bold text-gray-900">
                      {item.label}
                    </td>
                    <td className="w-1/4 px-5 py-5 align-top text-gray-700 font-medium">
                      {formatCalculationValue(item.value)}
                    </td>
                    <td className="w-1/2 px-5 py-5 align-top">
                      <div className="space-y-1.5">
                        {getCalculationReasoning(item).map((reason, reasonIndex) => {
                          const isSource = /^Source:/i.test(reason);
                          return (
                            <div
                              key={reasonIndex}
                              className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-1 leading-relaxed ${isSource ? "pt-0.5 text-xs text-gray-400" : "text-sm text-gray-600"}`}
                            >
                              <div className="flex min-w-0 items-start gap-2">
                                <span
                                  aria-hidden="true"
                                  className={isSource ? "w-1.5 shrink-0" : "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400"}
                                />
                                <span className="min-w-0">{reason}</span>
                              </div>
                              {reasonIndex === 0 && (
                                <ConfidenceBadge
                                  confidence={item.confidence ?? stage5Field?.confidence ?? stage5Field?.extracted_confidence}
                                  className="shrink-0"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Main Pricing Table Starts Below */}

      {/* Keep each pricing category visually distinct while retaining its Excel cell mapping internally. */}
      <div className="space-y-4">
        {basePricingCategories.map(renderPricingCategory)}
      </div>

      {/* FINAL PRICE */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Final Calculated Price</h3>
        </div>

        <div className="divide-y divide-gray-100">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <p className="text-sm font-medium text-gray-700">Final price</p>
            <p className="text-right text-2xl font-semibold tracking-tight text-gray-900">
              {formatCurrency(finalPrice)}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <p className="text-sm font-medium text-gray-700">Price per Square Foot</p>
            <p className="text-right text-base font-semibold tracking-tight text-gray-600">
              {pricePerSqFt !== null ? `${formatCurrency(pricePerSqFt)} / sq ft` : "—"}
            </p>
          </div>
        </div>
      </section>

      {optionalAddOnCategories.length > 0 && (
        <section className="space-y-3">
          <div className="border-l-4 border-amber-400 px-4 py-1">
            <h3 className="text-lg font-semibold text-gray-900">Optional Add-ons</h3>
            <p className="mt-1 text-sm text-gray-500">
              Only accepted add-ons are included in the Grand Total. Pending or declined add-ons remain available for review.
            </p>
          </div>
          <div className="space-y-4">
            {optionalAddOnCategories.map(renderPricingCategory)}
          </div>
          {optionalAddOnTotal > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-6 py-3 text-sm">
              <span className="font-medium text-amber-900">Accepted optional add-ons total</span>
              <span className="font-semibold text-amber-900">{currencyFormatter.format(optionalAddOnTotal)}</span>
            </div>
          )}
        </section>
      )}

      <section className="flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-6 py-4 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-emerald-900">
            Grand Total, including optional add-ons
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Final price plus accepted optional add-ons.
          </p>
        </div>
        <p className="text-right text-2xl font-semibold tracking-tight text-emerald-900">
          {formatCurrency(grandTotal)}
        </p>
      </section>

      {/* APPROVE ACTION */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="flex-1 min-w-0 pr-4">
          <h4 className="font-semibold text-gray-900">Sales Manager Approval</h4>
          <p className="text-sm text-gray-500 mt-1">
            Excel and PDF download are locked until an assigned Sales Manager reviews and explicitly approves this proposal.
          </p>
          {isLocked ? (
            <span className="mt-2 inline-flex items-center gap-1.5 text-amber-600"><AlertCircle size={16} /> This stage is locked until the previous step is approved.</span>
          ) : isApproved ? (
            <div className="mt-2 space-y-1">
              {approval?.approvedByName && (
                <p className="text-sm text-emerald-700">
                  Approved by <span className="font-medium">{approval.approvedByName}</span>
                  {formatApprovalDate(approval.approvedAt) ? ` on ${formatApprovalDate(approval.approvedAt)}` : ""}
                </p>
              )}
              <RevisionInfo
                revisionCount={stage7?.revision_count}
                latestRevision={stage7?.revisions?.[0]}
              />
            </div>
          ) : displayedApproverId ? (
            <p className="mt-2 text-sm text-gray-600">
              Awaiting approval from <span className="font-medium text-gray-900">{displayedApproverName}</span>.
              {!canApproveNow && " Only they (or an admin) can approve this proposal."}
            </p>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              No approver assigned yet. Assign a Sales Manager to review and approve this proposal.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4 items-center justify-end w-full md:w-auto">
          {isApproved && (
            <button
              type="button"
              disabled={isDownloading}
              onClick={async () => {
                try {
                  setIsDownloading(true);
                  const response = await apiClient.get(`/proposals/${projectId}/excel`, { responseType: 'blob' });
                  const url = window.URL.createObjectURL(new Blob([response.data]));
                  const a = document.createElement('a');
                  a.href = url;
                  const reference = toSafeFilenamePart(project?.referenceNumber);
                  const projectName = toSafeFilenamePart(project?.projectName);
                  const businessName = [reference, projectName].filter(Boolean).join("_");
                  a.download = `${businessName || "GFS_Project"}_Pricing.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.URL.revokeObjectURL(url);
                  await queryClient.invalidateQueries({
                    queryKey: ["project-workspace"],
                  });
                  await queryClient.invalidateQueries({
                    queryKey: ["project-workspace", "detail", projectId],
                  });
                } catch (error) {
                  const message = (error as { message?: unknown })?.message;
                  showToast(
                    "error",
                    typeof message === "string" && message.trim()
                      ? message
                      : "Failed to download Excel file",
                  );
                } finally {
                  setIsDownloading(false);
                }
              }}
              className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all bg-blue-600 text-white hover:bg-blue-700 shadow-sm whitespace-nowrap"
            >
              {isDownloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {isDownloading ? "Downloading..." : "Download Excel"}
            </button>
          )}

          {isApproved ? (
            <>
              <button
                disabled
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all whitespace-nowrap bg-emerald-100 text-emerald-700 cursor-not-allowed border border-emerald-200"
              >
                <Check size={18} />
                Approved
              </button>
              <ReviseStageButton
                projectId={projectId!}
                stage={7}
                stageName="Pricing Review"
                onRevised={() => refetch7()}
                onRevisionStateChange={setIsRevisionInProgress}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all whitespace-nowrap bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              />
            </>
          ) : isLocked ? (
            <>
              <button
                disabled
                title="Approve all previous stages first"
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all whitespace-nowrap bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200"
              >
                <UserPlus size={18} />
                {displayedApproverId ? "Reassign Approver" : "Assign Approver"}
              </button>
              <button
                disabled
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all whitespace-nowrap bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200"
              >
                <Check size={18} />
                Approve
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowAssignApprover(true)}
                disabled={isRevisionInProgress}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all whitespace-nowrap bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserPlus size={18} />
                {displayedApproverId ? "Reassign Approver" : "Assign Approver"}
              </button>

              <button
                onClick={handleApprove}
                disabled={approveMutation.isPending || isRevisionInProgress || !canApproveNow}
                title={!canApproveNow && displayedApproverId ? `Only ${displayedApproverName} can approve this proposal.` : undefined}
                className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                  canApproveNow && !isRevisionInProgress
                    ? "bg-red-500 text-white hover:bg-red-600 shadow-sm"
                    : "bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200"
                }`}
              >
                {approveMutation.isPending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Check size={18} />
                )}
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {showAssignApprover && (
        <AssignApproverModal
          key={projectId}
          open
          onClose={() => setShowAssignApprover(false)}
          projectId={projectId!}
          currentApproverId={displayedApproverId}
          currentApproverName={displayedApproverName}
          onAssigned={setRecentlyAssignedApprover}
        />
      )}
    </div>
  );
};

export default FinalParameters;
