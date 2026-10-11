// pages/estimator/workspace/tabs/BOMPricing.tsx

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useApproveProposalStage, useProposalStage } from "@/features/projects/query/proposalsQuery";
import type { ProposalStageField } from "@/shared/types/proposalStage.types";
import { useAuth } from "@/context/AuthContext";
import { ReviseStageButton } from "@/features/estimator/workspace/pages/components/ReviseStageButton";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { formatReasoningLines } from "@/features/estimator/workspace/utils/reasoning";

type BOMItem = {
  id: string;
  name: string;
  included: string;
  reasoning: ReactNode;
};

const FRAME_TYPE_LABELS: Record<string, string> = {
  SERIES_2000_PEDESTAL: "Series 2000 - Pedestal",
  SERIES_2000_RECESSED: "Series 2000 - Recessed",
  SERIES_1000_PEDESTAL: "Series 1000 - Pedestal",
  PERIMETER_NON_TB: "Perimeter Non-TB",
  DECK_PERIMETER: "Deck Perimeter",
  ECONOFRAME: "EconoFrame",
  SERIES_3000: "Series 3000",
  MANUAL: "Manual",
};

const formatBackendValue = (value: unknown): string => {
  if (value == null || value === "") return "-";
  if (typeof value !== "string") return String(value);

  if (FRAME_TYPE_LABELS[value]) return FRAME_TYPE_LABELS[value];

  return value
    .split("_")
    .map((word) => {
      if (word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

const formatIncludedValue = (value: unknown): string => {
  if (typeof value === "boolean") return value ? "Y" : "N";
  if (typeof value !== "string") return value == null || value === "" ? "-" : "Y";

  const normalized = value.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes" || normalized === "true") return "Y";
  if (normalized === "n" || normalized === "no" || normalized === "false") return "N";
  if (normalized === "pending") return "Pending";
  if (normalized === "manual") return "Manual";

  return "Y";
};

const formatReasoning = (reasoning: unknown) => {
  const reasons = formatReasoningLines(reasoning);
  if (reasons.length === 0) return "—";

  return (
    <ul className="list-disc space-y-1 py-1 pl-4">
      {reasons.map((reason, index) => (
        <li key={index} className="leading-relaxed text-gray-600">
          {reason}
        </li>
      ))}
    </ul>
  );
};

const getNestedField = (
  fields: Record<string, unknown> | undefined,
  path: string
): ProposalStageField | undefined => {
  if (!fields) return undefined;

  return path
    .split(".")
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, fields) as ProposalStageField | undefined;
};

const buildItem = (
  fields: Record<string, unknown> | undefined,
  path: string,
  name: string,
  includedValue?: unknown,
  fallbackReasoning?: ReactNode
): BOMItem | null => {
  const field = getNestedField(fields, path);
  if (!field) return null;

  const details = [
    field.status ? `Status: ${field.status}` : null,
    field.confidence != null ? `Confidence: ${field.confidence}` : null,
    field.updated_by ? `Updated by: ${field.updated_by}` : null,
  ].filter(Boolean);

  return {
    id: path,
    name,
    included: formatIncludedValue(includedValue ?? field.value),
    reasoning: field.reasoning
      ? formatReasoning(field.reasoning)
      : fallbackReasoning
        ? fallbackReasoning
        : details.length > 0
          ? <span className="text-gray-500">{details.join(" | ")}</span>
          : "-",
  };
};

const compactItems = (items: Array<BOMItem | null>): BOMItem[] =>
  items.filter((item): item is BOMItem => Boolean(item));

const glassSystemItems = (fields: Record<string, unknown> | undefined): BOMItem[] => {
  const glassType = getNestedField(fields, "glass_type");
  const glassValue = String(glassType?.value ?? "");
  const hasIgu = glassValue.includes("IGU") && !glassValue.includes("NO_IGU");

  return compactItems([
    buildItem(
      fields,
      "glass_type",
      formatBackendValue(glassType?.value) === "-" ? "Glass System" : formatBackendValue(glassType?.value),
      "Y"
    ),
    glassType
      ? {
        id: "glass_type.igu_variant",
        name: "IGU / Non-IGU variant",
        included: hasIgu ? "Y" : "N",
        reasoning: glassType.reasoning
          ? formatReasoning(glassType.reasoning)
          : <span className="text-gray-500">Derived from backend glass type: {formatBackendValue(glassType.value)}</span>,
      }
      : null,
  ]);
};

const framingSystemItems = (fields: Record<string, unknown> | undefined): BOMItem[] => {
  const frameType = getNestedField(fields, "decision.frame_type");
  const description = getNestedField(fields, "decision.proposal_description");
  const assemblyType = getNestedField(fields, "decision.assembly_type");

  return compactItems([
    frameType
      ? {
        id: "decision.frame_type",
        name: formatBackendValue(frameType.value),
        included: "Y",
        reasoning: frameType.reasoning
          ? formatReasoning(frameType.reasoning)
          : description?.value
            ? <span className="text-gray-600">{formatBackendValue(description.value)}</span>
            : "-",
      }
      : null,
    assemblyType
      ? {
        id: "decision.assembly_type",
        name: `Assembly Type: ${formatBackendValue(assemblyType.value)}`,
        included: "Y",
        reasoning: assemblyType.reasoning ? formatReasoning(assemblyType.reasoning) : "-",
      }
      : null,
  ]);
};

const fabricationItems = (fields: Record<string, unknown> | undefined): BOMItem[] =>
  compactItems([
    buildItem(fields, "crossbeam", "Crossbeam", "Y"),
    buildItem(fields, "takeoff.panel_count", "Panel Count", "Y", getNestedField(fields, "takeoff.panel_count")?.value != null
      ? <span className="text-gray-600">{formatBackendValue(getNestedField(fields, "takeoff.panel_count")?.value)} panels from backend takeoff</span>
      : undefined),
    buildItem(fields, "takeoff.man_hours", "Man Hours", "Y", getNestedField(fields, "takeoff.man_hours")?.value != null
      ? <span className="text-gray-600">{formatBackendValue(getNestedField(fields, "takeoff.man_hours")?.value)} estimated hours</span>
      : undefined),
    buildItem(fields, "takeoff.packaging", "Packaging", "Y", getNestedField(fields, "takeoff.packaging")?.value != null
    ? <span className="text-gray-600">{formatBackendValue(getNestedField(fields, "takeoff.packaging")?.value)} packaging units from backend takeoff</span>
    : undefined),
  ]);

const addonsItems = (fields: Record<string, unknown> | undefined): BOMItem[] => {
  const itemPaths = [
    ["addons.duty", "Duty"],
    ["addons.heat_soak_testing", "Heat Soak Testing"],
    ["addons.nanodot", "NanoDot"],
    ["addons.seeded_organic", "Seeded Organic"],
    ["addons.sentry_glass", "Sentry Glass"],
    ["addons.krypton_gas", "Krypton Gas"],
    ["addons.custom_shape", "Custom Shape"],
    ["addons.backpaint", "Backpaint"],
    ["calculated.total_sqft", "Total SqFt"],
    ["calculated.total_weight", "Total Weight"],
    ["calculated.perimeter_lf", "Perimeter LF"],
    ["calculated.silicone_tubes", "Silicone Tubes"],
  ] as const;

  return compactItems(itemPaths.map(([path, name]) => buildItem(fields, path, name)));
};

const BOM_GROUPS = [
  { label: "Glass System", stage: 2 },
  { label: "Framing System", stage: 3 },
  { label: "Fabrication & Labor", stage: 4 },
  { label: "Add-ons & Duty", stage: 5 },
] as const;

const BOMPricing = () => {
  const { isSalesManager } = useAuth();
  const [approvedSectionIndex, setApprovedSectionIndex] = useState(0);
  const [activeApprovingStage, setActiveApprovingStage] = useState<number | null>(null);
  const {
    mutate: approveStage,
    isPending: isApproving,
    isError: isApproveError,
    isSuccess: isApproveSuccess,
  } = useApproveProposalStage();

  const { projectId } = useProjectRoute();

  const { data: stage1 } = useProposalStage(projectId, 1);
  const { data: stage2, isLoading: isS2Loading, isError: isS2Error, refetch: refetchS2 } = useProposalStage(projectId, 2);
  const { data: stage3, isLoading: isS3Loading, isError: isS3Error, refetch: refetchS3 } = useProposalStage(projectId, 3);
  const { data: stage4, isLoading: isS4Loading, isError: isS4Error, refetch: refetchS4 } = useProposalStage(projectId, 4);
  const { data: stage5, isLoading: isS5Loading, isError: isS5Error, refetch: refetchS5 } = useProposalStage(projectId, 5);
  const projectName = stage1?.fields_to_show?.project_name?.value;

  const stageDataMap = useMemo(() => [
    { ...BOM_GROUPS[0], status: stage2?.status, items: glassSystemItems(stage2?.fields_to_show), isLoading: isS2Loading, isError: isS2Error, refetch: refetchS2 },
    { ...BOM_GROUPS[1], status: stage3?.status, items: framingSystemItems(stage3?.fields_to_show), isLoading: isS3Loading, isError: isS3Error, refetch: refetchS3 },
    { ...BOM_GROUPS[2], status: stage4?.status, items: fabricationItems(stage4?.fields_to_show), isLoading: isS4Loading, isError: isS4Error, refetch: refetchS4 },
    { ...BOM_GROUPS[3], status: stage5?.status, items: addonsItems(stage5?.fields_to_show), isLoading: isS5Loading, isError: isS5Error, refetch: refetchS5 },
  ], [
    stage2,
    stage3,
    stage4,
    stage5,
    isS2Loading,
    isS3Loading,
    isS4Loading,
    isS5Loading,
    isS2Error,
    isS3Error,
    isS4Error,
    isS5Error,
    refetchS2,
    refetchS3,
    refetchS4,
    refetchS5,
  ]);

  const backendApprovedCount = useMemo(() => {
    let approvedCount = 0;

    for (const group of stageDataMap) {
      if (group.status?.toUpperCase() !== "APPROVED") break;
      approvedCount += 1;
    }

    return approvedCount;
  }, [stageDataMap]);

  const visibleSectionIndex = Math.max(approvedSectionIndex, backendApprovedCount);

  const handleGroupApprove = (
    stageNumber: number,
    index: number,
    refetch?: () => void
  ) => {
    if (!projectId) return;

    setActiveApprovingStage(stageNumber);
    approveStage(
      { projectId, stage: stageNumber },
      {
        onSuccess: () => {
          refetch?.();
          setApprovedSectionIndex((current) => Math.max(current, index + 1));
        },
        onSettled: () => {
          setActiveApprovingStage(null);
        },
      }
    );
  };

  const handleFinalApprove = () => {
    if (!projectId) return;
    setActiveApprovingStage(5);
    approveStage(
      { projectId, stage: 5 },
      {
        onSuccess: () => refetchS5(),
        onSettled: () => setActiveApprovingStage(null),
      }
    );
  };

  return (
    <div className="pb-24">
      <div className="border-l-3 border-red-500 px-4 py-1 mb-2">
        <p className="text-lg text-black font-medium">
          Following is{" "}
          <span className="font-semibold text-red-500">BOM &amp; Pricing</span> of materials for
          {" "}{typeof projectName === "string" ? projectName : "this project"}
        </p>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-black text-white text-left">
              <th className="py-2.5 px-4 font-medium w-1/4">Components</th>
              <th className="py-2.5 px-4 font-medium w-1/4">y/n</th>
              <th className="py-2.5 px-4 font-medium w-1/2">Reasoning</th>
            </tr>
          </thead>

          <tbody>
            {stageDataMap.map((group, index) => {
              if (index > visibleSectionIndex) return null;

              const isApproved =
                group.status?.toUpperCase() === "APPROVED" ||
                index < visibleSectionIndex;
              const isActive = index === visibleSectionIndex && !isApproved;

              return (
                <FragmentGroup
                  key={group.label}
                  groupName={group.label}
                  items={group.items}
                  isLoading={group.isLoading}
                  isError={group.isError}
                  refetch={group.refetch}
                  isApproved={isApproved}
                  isActive={isActive}
                  canApprove={group.status?.toUpperCase() !== "LOCKED"}
                  isApproving={isApproving && activeApprovingStage === group.stage}
                  onApprove={() => handleGroupApprove(group.stage, index, group.refetch)}
                />
              );
            })}
          </tbody>
        </table>
      </section>

      {visibleSectionIndex >= stageDataMap.length && (
        <div className="fixed bottom-0 left-[250px] right-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
          {isApproveError && (
            <span className="text-sm text-red-500 flex items-center gap-1">
              <AlertCircle size={16} /> Failed to approve. Please try again.
            </span>
          )}
          {isApproveSuccess && (
            <span className="text-sm text-green-600 font-medium flex items-center gap-1">
              <Check size={16} /> BOM & Pricing Approved
            </span>
          )}
          {(true) && (
            <button
              type="button"
              onClick={handleFinalApprove}
              disabled={isApproving || isApproveSuccess || stage5?.status?.toUpperCase() === "APPROVED"}
              className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition ${isApproveSuccess || stage5?.status?.toUpperCase() === "APPROVED"
                  ? "bg-green-500 text-white cursor-default"
                  : isApproving
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-red-500 text-white hover:bg-red-600 hover:cursor-pointer"
                }`}
            >
              {isApproving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
              {isApproveSuccess || stage5?.status?.toUpperCase() === "APPROVED" ? "Approved" : "Final Approve"}
            </button>
          )}

          {(isApproveSuccess || stage5?.status?.toUpperCase() === "APPROVED") && (
            <ReviseStageButton
              projectId={projectId!}
              stage={5}
              stageName="Add-ons & Duty"
              onRevised={() => setApprovedSectionIndex(3)}
              className="flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            />
          )}
        </div>
      )}

    </div>
  );
};

const FragmentGroup = ({
  groupName,
  items,
  isLoading,
  isError,
  refetch,
  isApproved,
  isActive,
  canApprove,
  isApproving,
  onApprove,
}: {
  groupName: string;
  items: BOMItem[];
  isLoading?: boolean;
  isError?: boolean;
  refetch?: () => void;
  isApproved?: boolean;
  isActive?: boolean;
  canApprove?: boolean;
  isApproving?: boolean;
  onApprove?: () => void;
}) => {
  return (
    <>
      <tr className="bg-gray-50 border-t border-gray-200">
        <td colSpan={3} className="py-2.5 px-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-black">{groupName}</span>
            {isApproved && (
              <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 border border-green-200">
                <Check size={12} strokeWidth={3} /> Approved
              </span>
            )}
          </div>
        </td>
      </tr>

      {isLoading ? (
        <tr>
          <td colSpan={3} className="py-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-red-500 mx-auto" />
            <p className="mt-2 text-sm text-gray-500">Loading {groupName.toLowerCase()}...</p>
          </td>
        </tr>
      ) : isError ? (
        <tr>
          <td colSpan={3} className="py-8 text-center">
            <AlertCircle className="h-6 w-6 text-red-400 mx-auto" />
            <p className="mt-2 text-sm text-gray-600">Could not load {groupName.toLowerCase()}.</p>
            <button
              type="button"
              onClick={() => refetch?.()}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200 rounded-md hover:bg-red-50 transition"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </td>
        </tr>
      ) : items.length === 0 ? (
        <tr>
          <td colSpan={3} className="py-4 px-4 text-sm text-gray-400 italic">
            No fields returned for this stage.
          </td>
        </tr>
      ) : (
        items.map((item) => (
          <tr key={item.id} className="border-t border-gray-100 text-gray-700">
            <td className="py-2 px-4 align-top w-1/4">{item.name}</td>
            <td className="py-2 px-4 align-top w-1/4">{item.included}</td>
            <td className="py-2 px-4 align-top w-1/2">{item.reasoning}</td>
          </tr>
        ))
      )}

      {isActive && !isLoading && !isError && canApprove && (
        <tr>
          <td colSpan={3} className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-right">
            <button
              type="button"
              onClick={onApprove}
              disabled={isApproving}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 border rounded-md text-sm font-medium transition ${isApproving
                  ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400"
                }`}
            >
              {isApproving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Approve {groupName}
            </button>
          </td>
        </tr>
      )}
    </>
  );
};

export default BOMPricing;
