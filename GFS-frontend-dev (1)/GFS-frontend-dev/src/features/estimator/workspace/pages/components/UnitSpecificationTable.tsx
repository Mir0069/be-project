import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  formatUnitOption,
  getApprovedUnitRows,
  getUnitValue,
} from "@/features/estimator/workspace/utils/multiUnitDisplay";
import { StageReasoning } from "@/features/estimator/workspace/components/StageReasoning";
import type { ProposalStageField } from "@/shared/types/proposalStage.types";

type UnitSpecificationField = "value_frame_type" | "value_glass_type" | "value_cross_beam";

interface UnitSpecificationTableProps {
  units: unknown;
  field: UnitSpecificationField;
  variant?: "summary" | "detailed";
  editable?: boolean;
  pendingChanges?: Record<string, unknown>;
  fieldPathPrefix?: string;
  allowedValues?: readonly string[];
  projectId?: string;
  signals?: Record<string, unknown>;
  onValueChange?: (fieldPath: string, value: string) => void;
  showTitle?: boolean;
  showMissing?: boolean;
  formatOption?: (value: unknown) => string;
}

const labels: Record<UnitSpecificationField, string> = {
  value_frame_type: "Frame Type",
  value_glass_type: "Glass Type",
  value_cross_beam: "Crossbeam",
};

export const AnimatedUnitSelect = ({
  value,
  options,
  formatOption,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: readonly string[];
  formatOption: (value: unknown) => string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selectedOption = options.find((option) => option === value);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative ${isOpen ? "z-50" : "z-10"}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white p-1.5 text-left text-sm font-semibold text-gray-800 transition hover:border-red-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
      >
        <span className="truncate">{selectedOption ? formatOption(selectedOption) : value ? formatOption(value) : "Select"}</span>
        <ChevronDown
          size={16}
          className={`ml-2 shrink-0 text-gray-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="animate-project-filter-menu-in absolute z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg"
        >
          {options.map((option) => {
            const isSelected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition ${isSelected ? "bg-red-50 font-medium text-red-600" : "text-gray-700 hover:bg-gray-50"}`}
              >
                <span>{formatOption(option)}</span>
                {isSelected && <Check size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const unitDecisionField = (
  data: Record<string, unknown>,
  field: UnitSpecificationField,
): ProposalStageField => {
  const rawReasoning = field === "value_cross_beam"
    ? data.cross_beam_reasoning ?? data.crossbeam_reasoning ?? data.reasoning
    : data.reasoning;
  const reasoning = Array.isArray(rawReasoning)
    ? rawReasoning.filter((line): line is string => typeof line === "string")
    : typeof rawReasoning === "string" ? rawReasoning : undefined;
  const confidence = field === "value_cross_beam"
    ? data.cross_beam_confidence ?? data.extracted_confidence
    : data.extracted_confidence;
  const citation = field === "value_cross_beam"
    ? data.cross_beam_citation ?? data.crossbeam_citation ?? data.extracted_citation ?? data.citation
    : data.extracted_citation ?? data.citation;

  return {
    value: getUnitValue(data, field),
    reasoning,
    ...(typeof confidence === "number" || typeof confidence === "string"
      ? { extracted_confidence: confidence }
      : {}),
    status: typeof data.status === "string" ? data.status : undefined,
    ...(citation !== undefined && citation !== null ? { citation } : {}),
    ...(typeof data.extracted_verbatim === "string" ? { extracted_verbatim: data.extracted_verbatim } : {}),
  } as ProposalStageField;
};

/** Shows only the unit decisions actually returned by AI or saved by an estimator. */
export const UnitSpecificationTable = ({
  units,
  field,
  variant = "summary",
  editable = false,
  pendingChanges = {},
  fieldPathPrefix = "units",
  allowedValues = [],
  projectId,
  signals,
  onValueChange,
  showTitle = true,
  showMissing = false,
  formatOption = formatUnitOption,
}: UnitSpecificationTableProps) => {
  const rows = getApprovedUnitRows(units)
    .map(({ key, data }) => ({ key, data, value: formatUnitOption(getUnitValue(data, field)) }))
    .filter(({ value }) => showMissing || value !== "—");

  if (rows.length === 0) return null;

  const label = labels[field];

  if (variant === "detailed") {
    return (
      <section className="bg-white">
        {showTitle && (
          <div className="rounded-md border border-gray-200 bg-white px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-900">{label} by unit</h3>
          </div>
        )}
        <div className={`${showTitle ? "mt-3 " : ""}overflow-visible rounded-lg border border-gray-200 bg-white shadow-sm`}>
          <table className="w-full table-fixed text-left text-sm" aria-label={`${label} by unit`}>
            <thead>
              <tr className="bg-[#07111f] text-white">
                <th className="w-1/4 rounded-tl-lg px-5 py-3 text-[13px] font-semibold uppercase tracking-wide">Parameter</th>
                <th className="w-1/4 px-5 py-3 text-[13px] font-semibold uppercase tracking-wide">Value</th>
                <th className="w-1/2 rounded-tr-lg px-5 py-3 text-[13px] font-semibold uppercase tracking-wide">Reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y-[10px] divide-slate-100 bg-slate-100">
              {rows.map(({ key, data }) => {
                const fieldPath = `${fieldPathPrefix}.${key}.${field}`;
                const selectedValue = pendingChanges[fieldPath] ?? getUnitValue(data, field);
                const fieldData = unitDecisionField(data, field);
                const selector = editable ? (
                  <AnimatedUnitSelect
                    ariaLabel={`Unit ${key} ${label}`}
                    value={typeof selectedValue === "string" ? selectedValue : ""}
                    options={allowedValues}
                    formatOption={formatOption}
                    onChange={(value) => onValueChange?.(fieldPath, value)}
                  />
                ) : (
                  <p className="text-sm font-semibold text-emerald-700">{formatOption(selectedValue)}</p>
                );

                return (
                  <tr key={key} className="bg-emerald-50 text-gray-700">
                    {field === "value_cross_beam" ? (
                      <>
                        <td className="px-5 py-5 align-top">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Unit {key}</p>
                        </td>
                        <td className="border-l border-emerald-100 px-5 py-5 align-top">{selector}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-5 py-5 align-top">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Unit {key}</p>
                          {selector}
                        </td>
                        <td className="border-l border-emerald-100 px-5 py-5 align-top text-sm font-bold text-emerald-700">Y</td>
                      </>
                    )}
                    <td className="border-l border-emerald-100 px-5 py-5 align-top text-sm leading-6">
                      <StageReasoning field={fieldData} projectId={projectId} signals={signals} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="border-t border-gray-200 bg-slate-50/70 px-5 py-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{label} by unit</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Unit-specific values provided by AI or saved during estimation.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-left text-sm" aria-label={`${label} by unit`}>
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="w-32 px-4 py-2.5">Unit</th>
              <th className="px-4 py-2.5">{label}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ key, value }) => (
              <tr key={key}>
                <td className="px-4 py-3 font-semibold text-gray-800">Unit {key}</td>
                <td className="px-4 py-3 text-gray-700">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
