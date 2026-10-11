import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Check, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { useApproveProposalStage, useProposalStage, usePatchProposalField } from "@/features/projects/query/proposalsQuery";
import type { ProposalFieldMeta, ProposalStageField } from "@/shared/types/proposalStage.types";
import { formatReasoningLines } from "@/features/estimator/workspace/utils/reasoning";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { ReviseStageButton } from "@/features/estimator/workspace/pages/components/ReviseStageButton";
import { RevisionInfo } from "@/features/estimator/workspace/pages/components/RevisionInfo";
import { FieldFeedbackModal } from "@/features/estimator/workspace/pages/components/FieldFeedbackModal";
import { useFieldFeedbackQueue } from "@/features/estimator/workspace/hooks/useFieldFeedbackQueue";
import { buildParameterFeedbackRequests, unitKeyOfPath } from "@/features/estimator/workspace/utils/fieldFeedback";
import { CitationLink } from "@/features/estimator/workspace/components/CitationLink";
import { AIReasoningLabel } from "@/features/estimator/workspace/components/AIReasoningLabel";
import { ConfidenceBadge, hasConfidenceValue } from "@/features/estimator/workspace/components/ConfidenceBadge";
import NeedsReviewBadge from "@/features/estimator/workspace/components/NeedsReviewBadge";
import { useStageArrivalRefresh } from "@/features/estimator/workspace/hooks/useStageArrivalRefresh";
import WorkspaceAnalysisStatus from "@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus";
import { MULTI_UNIT_CROSSBEAM_TYPES, MULTI_UNIT_KEYS } from "@/shared/types/multiUnit.types";
import type { MultiUnitFieldMeta, MultiUnitStageFields } from "@/shared/types/multiUnit.types";
import { UnitSpecificationTable } from "@/features/estimator/workspace/pages/components/UnitSpecificationTable";

type RawValue = number | string | null | undefined;
type UnitFieldName =
  | "value_location"
  | "value_drawing_number"
  | "value_frame_type"
  | "value_glass_type"
  | "value_cross_beam"
  | "value_glass_thickness"
  | "value_width_in"
  | "value_length_in"
  | "value_panel_count"
  | "value_num_units"
  | "value_vertical_rafter_count"
  | "value_horizontal_rafter_count"
  | "value_man_hours";

type UnitRow = {
  key: string;
  unit: string;
  locationRaw: RawValue;
  drawingRaw: RawValue;
  frameTypeRaw: RawValue;
  glassTypeRaw: RawValue;
  crossbeamRaw: RawValue;
  crossbeamSuggestedRaw: RawValue;
  widthRaw: RawValue;
  lengthRaw: RawValue;
  panelsRaw: RawValue;
  numUnitsRaw: RawValue;
  verticalRaftersRaw: RawValue;
  horizontalRaftersRaw: RawValue;
  glassThicknessRaw: RawValue;
  manHoursRaw: RawValue;
  locationPath: string;
  drawingPath: string;
  frameTypePath: string;
  glassTypePath: string;
  crossbeamPath: string;
  widthPath: string;
  lengthPath: string;
  panelsPath: string;
  numUnitsPath: string;
  verticalRaftersPath: string;
  horizontalRaftersPath: string;
  glassThicknessPath: string;
  manHoursPath: string;
  status?: string | null;
  fieldStatuses: Partial<Record<UnitFieldName, string | null>>;
  citation?: any;
};

const VALUE_LABELS: Record<string, string> = {
  I_BEAM_TB_2000: "I-Beam TB 2000",
  I_BEAM_TB: "I-Beam TB",
  NO_BEAM: "No Beam",
  MANUAL: "Needs Review",
  ECONOFRAME_2_5: 'Econoframe 2.5"',
  ECONOFRAME_3_5: 'Econoframe 3.5"',
  T_SECTION_NTB: "T-Section NTB",
  T_SECTION_TB: "T-Section TB",
  I_BEAM_NTB: "I-Beam NTB",
  SERIES_1000_T_SECTION_TB: "Series 1000 T-Section TB",
  SERIES_1000_I_BEAM_TB: "Series 1000 I-Beam TB",
  SERIES_1000_T_SECTION: "Series 1000 T-Section",
  SERIES_1000_I_BEAM: "Series 1000 I-Beam",
  SERIES_2000_T_SECTION_TB: "Series 2000 T-Section TB",
  SERIES_2000_I_BEAM_TB: "Series 2000 I-Beam TB",
};

const isStageField = (field: unknown): field is ProposalStageField =>
  field !== null && typeof field === "object" && ("value" in field || "reasoning" in field);

const toField = (
  value: unknown,
  inheritedReasoning?: unknown,
): ProposalStageField | undefined => {
  if (isStageField(value)) {
    return inheritedReasoning && !value.reasoning
      ? { ...value, reasoning: inheritedReasoning as string }
      : value;
  }

  if (value == null) return undefined;

  return { value, reasoning: inheritedReasoning as string | undefined };
};

const readPath = (
  source: Record<string, unknown> | undefined,
  path: string,
): unknown => {
  if (!source) return undefined;

  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
};

const formatValue = (value: unknown): string => {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Y" : "N";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value !== "string") return String(value);

  return VALUE_LABELS[value] || value.replace(/_/g, " ");
};

const getField = (
  fields: Record<string, unknown> | undefined,
  path: string,
): ProposalStageField | undefined => {
  const group = path.split(".")[0];
  const key = path.split(".").at(-1) || path;

  const direct = toField(readPath(fields, path));
  if (direct) return direct;

  const flat = toField(fields?.[key]);
  if (flat) return flat;

  const underscored = toField(fields?.[path.replace(/\./g, "_")]);
  if (underscored) return underscored;

  const groupField = fields?.[group];

  if (isStageField(groupField) && groupField.value && typeof groupField.value === "object") {
    const nestedValue = (groupField.value as Record<string, unknown>)[key];
    const nestedField = toField(nestedValue, groupField.reasoning);
    if (nestedField) return nestedField;
  }

  if (groupField && typeof groupField === "object" && !isStageField(groupField)) {
    const nestedValue = (groupField as Record<string, unknown>)[key];
    const nestedField = toField(nestedValue);
    if (nestedField) return nestedField;
  }

  return undefined;
};

const getFirstField = (
  fields: Record<string, unknown> | undefined,
  paths: string[],
): (ProposalStageField & { _path?: string }) | undefined => {
  for (const path of paths) {
    const field = getField(fields, path);
    if (field) return { ...field, _path: path };
  }

  return undefined;
};

const getFieldReasoning = (
  field: ProposalStageField | undefined,
  key: string,
  fields: Record<string, unknown> | undefined,
): unknown => {
  // 1. Direct field reasoning
  if (field?.reasoning && (Array.isArray(field.reasoning) ? field.reasoning.length > 0 : Boolean(field.reasoning))) {
    return field.reasoning;
  }

  // 2. Direct property on field like extracted_reasoning
  const rawField = field as Record<string, unknown> | undefined;
  if (rawField?.extracted_reasoning) return rawField.extracted_reasoning;

  // 3. Look in signals or _signals
  const signals = (fields?._signals || fields?.signals) as Record<string, any> | undefined;
  if (signals) {
    const sig = signals[key];
    if (sig) {
      if (typeof sig === "string" && sig.trim()) return sig;
      if (sig.reasoning) return sig.reasoning;
      if (sig.extracted_reasoning) return sig.extracted_reasoning;
    }
  }

  // 4. For stage 4 fields, look in takeoff section
  if (fields?.takeoff && typeof fields.takeoff === "object") {
    const takeoff = fields.takeoff as Record<string, any>;
    const takeoffField = takeoff[key];
    if (takeoffField && typeof takeoffField === "object") {
      if (takeoffField.reasoning) return takeoffField.reasoning;
      if (takeoffField.extracted_reasoning) return takeoffField.extracted_reasoning;
    }
  }

  // 6. Look for cross_beam_reasoning directly in fields
  if (key === "crossbeam" && fields?.cross_beam_reasoning) {
    return fields.cross_beam_reasoning;
  }
  if (key === "crossbeam" && fields?.crossbeam_reasoning) {
    return fields.crossbeam_reasoning;
  }

  // 7. Dynamic fallbacks if no database reasoning is available
  if (key === "panel_count") {
    return ["Calculated as the sum of panel counts across all takeoff units."];
  }
  if (key === "man_hours") {
    return ["Estimated installation labor based on the total panel count and scope complexity."];
  }
  if (key === "packaging") {
    return ["Estimated packaging crate requirements based on total unit dimensions."];
  }
  if (key === "crossbeam") {
    const value = field?.value;
    if (value === "NO_BEAM") {
      return ["Single panel opening does not require intermediate structural crossbeams."];
    }
    if (value === "T_SECTION_TB" || value === "SERIES_1000_T_SECTION_TB" || value === "SERIES_2000_T_SECTION_TB") {
      return ["Thermal-break T-Section crossbeam specified for multi-panel structural load support."];
    }
    return ["Intermediate crossbeam specified for multi-panel structural support."];
  }

  return undefined;
};

const Reasoning = ({
  field,
  fieldKey,
  fields,
  projectId,
}: {
  field?: ProposalStageField;
  fieldKey?: string;
  fields?: Record<string, unknown>;
  projectId?: string;
}): ReactNode => {
  const confidence = field?.confidence ?? field?.extracted_confidence;
  const reasoningData = getFieldReasoning(field, fieldKey || "", fields);
  let reasons = formatReasoningLines(reasoningData);
  if (reasons.length === 0) {
    reasons = [`Calculated parameter derived from project specifications.`];
  }
  const cit = field?.citation || (field as any)?.extracted_citation;

  if (reasons.length > 0) {
    const hasAiReasoning = reasons.some((reason) => {
      const lowerReason = reason.toLowerCase();
      return !lowerReason.includes("email") &&
        !lowerReason.includes("inquiry") &&
        !lowerReason.includes("correspondence") &&
        !(cit?.pdf_name || cit?.doc_name);
    });
    return (
      <div className="space-y-2.5">
        <ul className="space-y-2.5">
          {reasons.map((reason, index) => {
            const lowerReason = reason.toLowerCase();
            const isEmailReason =
              lowerReason.includes("email") ||
              lowerReason.includes("inquiry") ||
              lowerReason.includes("correspondence");
            const citDocName = cit?.pdf_name || cit?.doc_name;
            const isDocReason = Boolean(citDocName) && !isEmailReason;

            const docName = isDocReason ? citDocName : undefined;
            const pageMatch = reason.match(/p(?:age)?\.?\s*(\d+)/i);
            const pageNumber =
              cit?.page ?? cit?.page_num ?? (pageMatch ? parseInt(pageMatch[1], 10) : 1);
            const bboxInches = cit?.bbox_inches;
            const documentId = cit?.document_id || cit?.documentId;

            return (
              <li key={index} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                  />
                  <span className="min-w-0 text-sm leading-6 text-gray-600">{reason}</span>
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
                {index === 0 && (
                  <ConfidenceBadge confidence={confidence} className="shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
        {hasAiReasoning && projectId && <AIReasoningLabel />}
      </div>
    );
  }

  return hasConfidenceValue(confidence) ? <ConfidenceBadge confidence={confidence} /> : "-";
};

const normalizeUnitSource = (fields: Record<string, unknown> | undefined): unknown => {
  const units = fields?.units;
  if (isStageField(units)) return units.value;
  if (units) return units;

  const takeoff = fields?.takeoff;
  if (isStageField(takeoff) && takeoff.value && typeof takeoff.value === "object") {
    return (takeoff.value as Record<string, unknown>).units;
  }

  if (takeoff && typeof takeoff === "object") {
    return (takeoff as Record<string, unknown>).units;
  }

  return undefined;
};

// All unit letters currently present in the schema, populated or not — used to
// find the next free A-J slot. Distinct from buildUnitRows' output, which only
// includes units that already carry real take-off data.
const getExistingUnitKeys = (fields: Record<string, unknown> | undefined): Set<string> => {
  const units = normalizeUnitSource(fields);
  if (!units || typeof units !== "object") return new Set();
  return new Set(Object.keys(units).map((key) => key.toUpperCase()));
};

const UNIT_EDITABLE_FIELDS = [
  "value_location",
  "value_drawing_number",
  // Mirrors value_drawing_number (see backend schema-registry.ts) — the
  // backend's hasRealUnitData check reads both, so both must be cleared or a
  // "removed" unit can still count as real data and survive Excel generation.
  "value_drawing_no",
  "value_frame_type",
  "value_glass_type",
  "value_cross_beam",
  "value_glass_thickness",
  "value_width_in",
  "value_length_in",
  "value_panel_count",
  "value_num_units",
  "value_vertical_rafter_count",
  "value_horizontal_rafter_count",
  "value_man_hours",
] as const;

const isNeedsReviewStatus = (status: unknown): boolean =>
  typeof status === "string" && status.trim().toUpperCase() === "NEEDS_REVIEW";

const readUnitField = (
  unit: Record<string, unknown>,
  primary: string,
  fallback: string,
): { value: RawValue; status?: string | null } => {
  const raw = unit[primary] ?? unit[fallback];
  const status = unit[`${primary}_status`] ?? unit[`${fallback}_status`];

  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
    const field = raw as Record<string, unknown>;
    return {
      value: field.value as RawValue,
      status: (field.status ?? status) as string | null | undefined,
    };
  }

  return { value: raw as RawValue, status: status as string | null | undefined };
};

const hasValue = (value: unknown): boolean =>
  value != null && value !== "" && formatValue(value) !== "-";

const buildUnitRows = (fields: Record<string, unknown> | undefined): UnitRow[] => {
  const units = normalizeUnitSource(fields);
  const isTakeoff = !fields?.units && !!fields?.takeoff;
  const basePath = isTakeoff ? "stage_4.takeoff.units" : "stage_4.units";

  if (!units || typeof units !== "object") return [];

  return Object.entries(units as Record<string, Record<string, unknown>>)
    .map(([key, unit]) => {
      const location = readUnitField(unit, "value_location", "location");
      const drawing = readUnitField(unit, "value_drawing_number", "drawing_number");
      const drawingNo = readUnitField(unit, "value_drawing_no", "drawing_no");
      const frameType = readUnitField(unit, "value_frame_type", "frame_type");
      const glassType = readUnitField(unit, "value_glass_type", "glass_type");
      const crossbeam = readUnitField(unit, "value_cross_beam", "value_crossbeam");
      const extractedCrossbeam = readUnitField(unit, "extracted_cross_beam", "extracted_crossbeam");
      const width = readUnitField(unit, "value_width_in", "width_in");
      const length = readUnitField(unit, "value_length_in", "length_in");
      const panels = readUnitField(unit, "value_panel_count", "panel_count");
      const numUnits = readUnitField(unit, "value_num_units", "num_units");
      const verticalRafters = readUnitField(unit, "value_vertical_rafter_count", "vertical_rafter_count");
      const legacyRafters = readUnitField(unit, "value_rafter_count", "rafter_count");
      const horizontalRafters = readUnitField(unit, "value_horizontal_rafter_count", "horizontal_rafter_count");
      const glassThickness = readUnitField(unit, "value_glass_thickness", "glass_thickness");
      const manHours = readUnitField(unit, "value_man_hours", "man_hours");

      return {
        key,
        unit: formatValue(unit.unit_id || key).toUpperCase(),
        locationRaw: location.value || (unit as any).description,
        drawingRaw: drawing.value ?? drawingNo.value,
        frameTypeRaw: frameType.value,
        glassTypeRaw: glassType.value,
        crossbeamRaw: crossbeam.value,
        crossbeamSuggestedRaw: extractedCrossbeam.value,
        widthRaw: width.value,
        lengthRaw: length.value,
        panelsRaw: panels.value ?? (unit as any).quantity,
        numUnitsRaw: numUnits.value ?? 1,
        verticalRaftersRaw: verticalRafters.value ?? legacyRafters.value,
        horizontalRaftersRaw: horizontalRafters.value,
        glassThicknessRaw: glassThickness.value,
        manHoursRaw: manHours.value,
        locationPath: `${basePath}.${key}.value_location`,
        drawingPath: `${basePath}.${key}.value_drawing_number`,
        frameTypePath: `${basePath}.${key}.value_frame_type`,
        glassTypePath: `${basePath}.${key}.value_glass_type`,
        crossbeamPath: `${basePath}.${key}.value_cross_beam`,
        widthPath: `${basePath}.${key}.value_width_in`,
        lengthPath: `${basePath}.${key}.value_length_in`,
        panelsPath: `${basePath}.${key}.value_panel_count`,
        numUnitsPath: `${basePath}.${key}.value_num_units`,
        verticalRaftersPath: `${basePath}.${key}.value_vertical_rafter_count`,
        horizontalRaftersPath: `${basePath}.${key}.value_horizontal_rafter_count`,
        glassThicknessPath: `${basePath}.${key}.value_glass_thickness`,
        manHoursPath: `${basePath}.${key}.value_man_hours`,
        status: (unit.status as string | null | undefined) ?? null,
        fieldStatuses: {
          value_location: location.status,
          value_drawing_number: drawing.status ?? drawingNo.status,
          value_frame_type: frameType.status,
          value_glass_type: glassType.status,
          value_cross_beam: crossbeam.status ?? extractedCrossbeam.status,
          value_glass_thickness: glassThickness.status,
          value_width_in: width.status,
          value_length_in: length.status,
          value_panel_count: panels.status,
          value_num_units: numUnits.status,
          value_vertical_rafter_count: verticalRafters.status ?? legacyRafters.status,
          value_horizontal_rafter_count: horizontalRafters.status,
          value_man_hours: manHours.status,
        },
        citation: (unit.citation || (unit as any).extracted_citation) as any,
      };
    })
    .filter((row) =>
      // Backend pre-seeds A-J with a default unit count. That default alone does not
      // mean a takeoff row exists, so only show rows containing real project data.
      [
        row.locationRaw,
        row.frameTypeRaw,
        row.glassTypeRaw,
        row.drawingRaw,
        row.widthRaw,
        row.lengthRaw,
        row.panelsRaw,
        row.verticalRaftersRaw,
        row.horizontalRaftersRaw,
        row.glassThicknessRaw,
        row.crossbeamRaw,
        row.crossbeamSuggestedRaw,
      ].some(hasValue),
    );
};

const getPendingValue = (
  pendingChanges: Record<string, unknown>,
  path: string,
  fallback: RawValue,
): unknown => (Object.prototype.hasOwnProperty.call(pendingChanges, path) ? pendingChanges[path] : fallback);

const getFieldMeta = (field?: ProposalStageField): ProposalFieldMeta => field?._meta ?? {};

// Use backend metadata first; a missing value must never be guessed to be a Y/N field.
const getValueType = (field?: ProposalStageField): ProposalFieldMeta["value_type"] => {
  const meta = getFieldMeta(field);
  if (meta.value_type) return meta.value_type;
  if (Array.isArray(meta.allowed_values) && meta.allowed_values.length > 0) return "select";
  if (typeof field?.value === "number") return "number";
  return "text";
};

const validateValue = (value: unknown, meta: ProposalFieldMeta): string | undefined => {
  if (value == null || value === "") return undefined;
  if ((meta.value_type === "number" || meta.value_type === "integer") &&
    (typeof value !== "number" || !Number.isFinite(value))) {
    return "Enter a valid number.";
  }
  if (meta.value_type === "integer" && !Number.isInteger(value)) return "Enter a whole number.";
  if (typeof value === "number" && meta.min !== undefined && value < meta.min) {
    return `Value must be at least ${meta.min}.`;
  }
  if (typeof value === "number" && meta.max !== undefined && value > meta.max) {
    return `Value must be at most ${meta.max}.`;
  }
  if (meta.value_type === "yn" && value !== "y" && value !== "n" && value !== true && value !== false) {
    return "Choose Y or N.";
  }
  return undefined;
};

const Parameters = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, publicProjectKey } = useProjectRoute();
  // Approval is an estimator action; sales managers can review the stage.
  const { isSalesManager } = useAuth();
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [isAddingUnit, setIsAddingUnit] = useState(false);
  const [removingUnitKey, setRemovingUnitKey] = useState<string | null>(null);
  const [unitToRemove, setUnitToRemove] = useState<UnitRow | null>(null);

  const { data: stage, isLoading, isError, refetch } = useProposalStage(projectId, 4);
  const shouldRefreshOnArrival =
    (location.state as { refreshWorkflowStage?: number } | null)?.refreshWorkflowStage === 4;
  useStageArrivalRefresh(shouldRefreshOnArrival, refetch);
  const {
    mutate: approveStage,
    isPending: isApproving,
    isError: isApproveError,
    isSuccess: isApproveSuccess,
    error: approveError,
  } = useApproveProposalStage();
  const { mutateAsync: patchField, isPending: isPatching } = usePatchProposalField();
  const { collect: collectFeedback, modalProps: feedbackModalProps } = useFieldFeedbackQueue();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-red-500" />
        <p className="mt-3 text-sm text-gray-500">Loading system parameters...</p>
      </div>
    );
  }

  if (isError || !stage) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <AlertCircle className="mx-auto h-7 w-7 text-red-400" />
        <p className="mt-3 text-sm text-gray-600">Could not load system parameters.</p>
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

  const fields = (
    stage.fields_to_show && typeof stage.fields_to_show === "object"
      ? stage.fields_to_show
      : {}
  ) as Record<string, unknown>;
  const unitStageFields = fields as MultiUnitStageFields;
  const unitFieldMeta = unitStageFields.unit_field_meta ?? {};
  const panelCount = getField(fields, "takeoff.panel_count");
  const manHours = getField(fields, "takeoff.man_hours");
  const packaging = getField(fields, "takeoff.packaging");
  const crossbeam = getFirstField(fields, [
    "crossbeam",
    "crossbeam_type",
    "takeoff.crossbeam",
    "takeoff.crossbeam_type",
    "parameters.crossbeam",
    "system.crossbeam",
    "decision.crossbeam",
    "decision.crossbeam_type",
  ]);
  const crossbeamPath = crossbeam?._path ? `stage_4.${crossbeam._path}` : "stage_4.crossbeam";
  const unitRows = buildUnitRows(fields);
  const existingUnitKeys = getExistingUnitKeys(fields);
  // Excel template rows 23-32 / 115-124 are physically fixed at one row per
  // letter A-J, so 10 units is a hard ceiling, not just a UI convenience.
  // The letter itself carries no meaning beyond identity, so any free slot is
  // a valid choice — this list is offered to the estimator rather than always
  // forcing the next one in sequence.
  const availableUnitKeys = MULTI_UNIT_KEYS.filter((key) => !existingUnitKeys.has(key));

  const rowHeight = 73; // Height of each takeoff row (including padding and border)
  const containerHeight = 600; // max-h-[600px] viewport
  const buffer = 5; // Extra rows to render above and below to prevent blank flashes

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
  const endIndex = Math.min(unitRows.length, Math.floor((scrollTop + containerHeight) / rowHeight) + buffer);

  const visibleRows = unitRows.slice(startIndex, endIndex);

  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = (unitRows.length - endIndex) * rowHeight;

  const derivedPanelCount = unitRows.reduce((sum, row) => {
    const val = getPendingValue(pendingChanges, row.panelsPath, row.panelsRaw);
    const parsed = Number(val);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  const isApproved = stage.status?.toUpperCase() === "APPROVED" || isApproveSuccess;
  const isLocked = stage.status?.toUpperCase() === "LOCKED";
  const crossbeamValue = getPendingValue(
    pendingChanges,
    crossbeamPath,
    crossbeam?.value as RawValue,
  );
  const isResolvedCrossbeam = (value: unknown): boolean =>
    typeof value === "string" && value.trim() !== "" && value.trim().toUpperCase() !== "MANUAL";
  const crossbeamNeedsReview = unitRows.length > 0
    ? unitRows.some((row) => {
        const pendingUnitValue = getPendingValue(pendingChanges, row.crossbeamPath, row.crossbeamRaw);
        const unitValue = hasValue(pendingUnitValue) ? pendingUnitValue : crossbeamValue;
        return !isResolvedCrossbeam(unitValue);
    })
    : !isResolvedCrossbeam(crossbeamValue);
  const crossbeamReviewMessage = unitRows.length > 0
    ? "Choose a crossbeam for each unit before approving."
    : "Choose a project crossbeam before approving.";
  const sourceUnits = normalizeUnitSource(fields) as Record<string, Record<string, unknown>> | undefined;
  const crossbeamUnitSpecifications = Object.fromEntries(unitRows.map((row) => {
    const unit = sourceUnits?.[row.key] ?? {};
    const hasUnitCrossbeam = hasValue(row.crossbeamRaw) || hasValue(row.crossbeamSuggestedRaw);
    const usesProjectFallback = !hasUnitCrossbeam;
    const globalReasoning = usesProjectFallback && isResolvedCrossbeam(crossbeamValue)
      ? getFieldReasoning(crossbeam, "crossbeam", fields)
      : undefined;

    return [row.key, {
      ...unit,
      value_cross_beam: row.crossbeamRaw ?? row.crossbeamSuggestedRaw ??
        (usesProjectFallback ? crossbeamValue : null),
      cross_beam_reasoning:
        unit.cross_beam_reasoning ?? unit.crossbeam_reasoning ?? globalReasoning,
      cross_beam_confidence:
        unit.cross_beam_confidence ?? unit.crossbeam_confidence ??
        (usesProjectFallback ? crossbeam?.confidence ?? crossbeam?.extracted_confidence : undefined),
      cross_beam_citation:
        unit.cross_beam_citation ?? unit.crossbeam_citation ?? unit.extracted_citation ??
        (usesProjectFallback ? crossbeam?.citation : undefined),
    }];
  }));
  const crossbeamAllowedValues = (
    unitFieldMeta.value_cross_beam?.allowed_values ?? MULTI_UNIT_CROSSBEAM_TYPES
  ).filter((value): value is string => typeof value === "string" && value !== "MANUAL");
  const approveErrorMessage =
    (approveError as { message?: string } | null)?.message || "Failed to approve. Please try again.";
  const nextPath = `/projects/${encodeURIComponent(publicProjectKey ?? "")}/addons`;
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const updatePendingValue = (
    path: string,
    value: unknown,
    meta: ProposalFieldMeta = {},
  ) => {
    const error = validateValue(value, meta);
    setValidationErrors((current) => {
      const next = { ...current };
      if (error) next[path] = error;
      else delete next[path];
      return next;
    });
    setPendingChanges((current) => ({ ...current, [path]: value }));
  };

  // Creates the unit by writing a real field to it — there's no dedicated
  // "create unit" endpoint; applyPatches (schema-merge.engine.ts) creates the
  // units.<key> record on first write to any field under it. value_panel_count
  // is set (not just value_num_units) because the take-off table's visibility
  // filter checks panel count, not unit count — without it the new row would
  // save successfully but never appear.
  const handleAddUnit = async (key: string) => {
    if (!projectId || !key || isApproved || isLocked) return;
    setIsAddingUnit(true);
    try {
      await patchField({
        projectId,
        fieldPath: `stage_4.units.${key}.value_panel_count`,
        value: 1,
      });
      await patchField({
        projectId,
        fieldPath: `stage_4.units.${key}.value_num_units`,
        value: 1,
      });
      showToast("success", `Unit ${key} added`);
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to add unit");
    } finally {
      setIsAddingUnit(false);
    }
  };

  // There's no delete-unit endpoint; clearing every editable field back to
  // null makes the backend's hasRealUnitData/hasValue checks treat the unit
  // as empty again, so it drops out of this table and out of Excel/PDF
  // generation, without needing a schema change.
  const handleRemoveUnit = (row: UnitRow) => {
    if (!projectId || isApproved || isLocked) return;
    setUnitToRemove(row);
  };

  const confirmRemoveUnit = async () => {
    const row = unitToRemove;
    if (!projectId || !row || isApproved || isLocked || removingUnitKey === row.key) return;
    setRemovingUnitKey(row.key);
    try {
      for (const field of UNIT_EDITABLE_FIELDS) {
        await patchField({
          projectId,
          fieldPath: `stage_4.units.${row.key}.${field}`,
          value: null,
        });
      }
      setPendingChanges((current) => {
        const next = { ...current };
        for (const path of Object.keys(next)) {
          if (path.startsWith(`stage_4.units.${row.key}.`)) delete next[path];
        }
        return next;
      });
      showToast("success", `Unit ${row.unit} removed`);
      await refetch();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to remove unit");
    } finally {
      setRemovingUnitKey(null);
      setUnitToRemove(null);
    }
  };

  const handleApprove = () => {
    if (!projectId || isLocked || hasValidationErrors) return;
    if (crossbeamNeedsReview) {
      showToast("error", crossbeamReviewMessage);
      return;
    }
    if (isApproved) {
      navigate(nextPath, { state: { refreshWorkflowStage: 5 } });
      return;
    }

    approveStage(
      { projectId, stage: 4 },
      {
        onSuccess: async () => {
          await refetch();
          navigate(nextPath, { state: { refreshWorkflowStage: 5 } });
        },
      },
    );
  };

  const panelCountField = panelCount
    ? { ...panelCount, value: derivedPanelCount, _meta: { ...(panelCount._meta || {}), editable: false } }
    : { value: derivedPanelCount, reasoning: [], _meta: { editable: false } };

  // These parameters remain available in the stage data for future use, but
  // are intentionally hidden from this screen only. Remove either key below
  // to restore its row without changing the underlying data or other screens.
  const hiddenParameterKeys = new Set(["man_hours", "packaging"]);

  const rows = [
    { label: "Panel Count", field: panelCountField as ProposalStageField, path: "stage_4.takeoff.panel_count", key: "panel_count" },
    { label: "Man Hours", field: manHours, path: "stage_4.takeoff.man_hours", key: "man_hours" },
    { label: "Packaging", field: packaging, path: "stage_4.takeoff.packaging", key: "packaging" },
    {
      label: "Crossbeam",
      field: crossbeam,
      path: crossbeamPath,
      key: "crossbeam",
    },
  ].filter(({ key }) =>
    !hiddenParameterKeys.has(key) && !(key === "crossbeam" && unitRows.length > 0),
  );

  const renderFieldEditor = (field: ProposalStageField | undefined, path: string) => {
    const meta = getFieldMeta(field);
    const value = getPendingValue(pendingChanges, path, field?.value as RawValue);
    const editable = !isApproved && !isLocked && meta.editable !== false;
    const allowedValues = meta.allowed_values;
    const valueType = getValueType(field);
    const isCrossbeam = path === crossbeamPath;

    if (!editable) return <span>{formatValue(value)}</span>;

    if (valueType === "select" && allowedValues?.length) {
      const selectableValues = isCrossbeam
        ? allowedValues.filter((option) => option !== "MANUAL")
        : allowedValues;

      return (
        <select
          value={String(value ?? "")}
          onChange={(event) => updatePendingValue(path, event.target.value, meta)}
          className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-sm font-medium text-gray-800"
        >
          <option value="">Select</option>
          {isCrossbeam && value === "MANUAL" && (
            <option value="MANUAL" disabled>Needs Review</option>
          )}
          {selectableValues.map((option) => (
            <option key={String(option)} value={String(option)}>
              {formatValue(option)}
            </option>
          ))}
        </select>
      );
    }

    if (valueType === "yn") {
      return (
        <select
          value={String(value ?? "")}
          onChange={(event) => updatePendingValue(path, event.target.value, meta)}
          className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-sm font-medium text-gray-800"
        >
          <option value="">Select</option>
          <option value="y">Y</option>
          <option value="n">N</option>
        </select>
      );
    }

    if (valueType === "number" || valueType === "integer") {
      return (
        <input
          type="number"
          min={meta.min}
          max={meta.max}
          step={valueType === "integer" ? 1 : "any"}
          value={value == null ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            updatePendingValue(path, raw === "" ? null : Number(raw), meta);
          }}
          className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-sm font-medium text-gray-800"
        />
      );
    }

    return (
      <input
        type="text"
        value={value == null ? "" : String(value)}
        onChange={(event) => updatePendingValue(path, event.target.value, meta)}
        className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-sm font-medium text-gray-800"
      />
    );
  };

  const renderUnitInput = (
    row: UnitRow,
    path: string,
    value: RawValue,
    type: "text" | "number" | "integer" | "select",
    fieldName: string,
  ) => {
    const editable = !isApproved && !isLocked;
    const currentValue = getPendingValue(pendingChanges, path, value);
    if (!editable) return formatValue(currentValue);

    const metadata = unitFieldMeta[fieldName] as MultiUnitFieldMeta | undefined;
    const allowedValues = metadata?.allowed_values ?? [];
    const editMeta: ProposalFieldMeta = {
      value_type: metadata?.value_type ?? (type === "select" ? "select" : type),
      min: metadata?.min,
      max: metadata?.max,
      allowed_values: [...allowedValues],
    };

    if (type === "select" || allowedValues.length > 0) {
      return (
        <select
          aria-label={`${row.unit} ${fieldName}`}
          value={currentValue == null ? "" : String(currentValue)}
          onChange={(event) => updatePendingValue(path, event.target.value || null, editMeta)}
          className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-sm text-gray-800"
        >
          <option value="">Select</option>
          {allowedValues.map((option) => (
            <option key={String(option)} value={String(option)}>
              {formatValue(option)}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        aria-label={`${row.unit} ${path.split(".").at(-1)}`}
        type={type === "text" ? "text" : "number"}
        min={type === "text" ? undefined : 0}
        step={type === "integer" ? 1 : type === "number" ? "any" : undefined}
        value={currentValue == null ? "" : String(currentValue)}
        onChange={(event) => {
          const raw = event.target.value;
          const nextValue = type === "text" ? raw : raw === "" ? null : Number(raw);
          updatePendingValue(path, nextValue, editMeta);
        }}
        className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-sm text-gray-800"
      />
    );
  };

  const renderUnitCell = (
    row: UnitRow,
    path: string,
    value: RawValue,
    type: "text" | "number" | "integer" | "select",
    fieldName: UnitFieldName,
  ) => (
    <div className="space-y-1.5">
      {renderUnitInput(row, path, value, type, fieldName)}
      {isNeedsReviewStatus(row.fieldStatuses[fieldName]) && <NeedsReviewBadge />}
    </div>
  );

  return (
    <div className="space-y-5 pb-6">
      <FieldFeedbackModal {...feedbackModalProps} />
      <div className="flex items-start justify-between border-l-4 border-red-500 px-5 py-1">
        <h2 className="text-2xl font-semibold leading-8 text-red-500">System Parameters</h2>
        <WorkspaceAnalysisStatus />
      </div>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="bg-[#07111f] text-white">
              <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">Parameter</th>
              <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">Value</th>
              <th className="w-1/2 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, field, path, key }) => (
              <tr key={label} className="border-t border-gray-100 text-gray-700 odd:bg-white even:bg-gray-50/60">
                <td className="px-5 py-5 align-top text-sm font-semibold text-gray-900">{label}</td>
                <td className="border-l border-gray-100 px-5 py-5 align-top text-sm font-semibold text-gray-900">
                  <div className="space-y-1.5">
                    {renderFieldEditor(field, path)}
                    {isNeedsReviewStatus(field?.status) && <NeedsReviewBadge />}
                  </div>
                  {validationErrors[path] && (
                    <p className="mt-1 text-xs font-normal text-red-600">{validationErrors[path]}</p>
                  )}
                </td>
                <td className="border-l border-gray-100 px-5 py-5 align-top text-sm leading-6">
                  <Reasoning field={field} fieldKey={key} fields={fields} projectId={projectId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {unitRows.length > 0 && (
          <div className="border-t border-gray-200 px-5 py-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Crossbeam</h3>
            </div>
            <UnitSpecificationTable
              units={crossbeamUnitSpecifications}
              field="value_cross_beam"
              variant="detailed"
              editable={!isApproved && !isLocked}
              pendingChanges={pendingChanges}
              fieldPathPrefix="stage_4.units"
              allowedValues={crossbeamAllowedValues}
              projectId={projectId}
              signals={fields._signals as Record<string, unknown>}
              showTitle={false}
              showMissing
              formatOption={(value) => formatValue(value)}
              onValueChange={(fieldPath, value) => updatePendingValue(fieldPath, value, {
                value_type: "select",
                allowed_values: [...crossbeamAllowedValues],
              })}
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-4">
          <span className="text-sm font-semibold text-gray-900">Take Off Sheet</span>
          {!isApproved && !isLocked && (
            <div className="relative inline-block">
              <select
                key={availableUnitKeys.join(",")}
                aria-label="Add a unit"
                defaultValue=""
                disabled={availableUnitKeys.length === 0 || isAddingUnit}
                title={availableUnitKeys.length === 0 ? "All 10 unit slots (A-J) are in use" : undefined}
                onChange={(e) => {
                  const key = e.target.value;
                  if (key) void handleAddUnit(key);
                }}
                className="appearance-none rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-3 text-xs font-semibold text-gray-700 transition hover:border-red-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  {isAddingUnit ? "Adding..." : "Add Unit"}
                </option>
                {availableUnitKeys.map((key) => (
                  <option key={key} value={key}>Unit {key}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                {isAddingUnit ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              </span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1850px] table-fixed text-left text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-white text-gray-500">
                <th className="sticky left-0 z-10 w-[80px] bg-white px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Unit</th>
                <th className="w-[170px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Drawing</th>
                <th className="w-[200px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Location</th>
                <th className="w-[170px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Frame Type</th>
                <th className="w-[170px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Glass Type</th>
                <th className="w-[140px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Glass Thickness</th>
                <th className="w-[110px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Width (In)</th>
                <th className="w-[110px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Length (In)</th>
                <th className="w-[100px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide"># Of Panels</th>
                <th className="w-[100px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide"># Of Units</th>
                <th className="w-[130px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide"># Vertical Crossbeams</th>
                <th className="w-[130px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide"># Horizontal Crossbeams</th>
                <th className="w-[110px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Man Hours</th>
                {!isApproved && !isLocked && (
                  <th className="w-[110px] px-3 py-4 text-[12px] font-semibold uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {unitRows.length === 0 ? (
                <tr>
                  <td colSpan={!isApproved && !isLocked ? 14 : 13} className="px-5 py-5 text-sm italic text-gray-400">No take off units returned by backend.</td>
                </tr>
              ) : (
                unitRows.map((row) => (
                  <tr key={row.key} className="border-t border-gray-100 text-gray-800">
                    <td className="sticky left-0 z-10 bg-white px-3 py-5 align-top text-base font-semibold">
                      <div className="space-y-1.5">
                        <span>{row.unit}</span>
                        {(isNeedsReviewStatus(row.status) || Object.values(row.fieldStatuses).some(isNeedsReviewStatus)) && (
                          <NeedsReviewBadge />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-5 align-top">
                      <div className="space-y-2">
                        {renderUnitCell(row, row.drawingPath, row.drawingRaw, "text", "value_drawing_number")}
                        {(row.citation || row.drawingRaw) && projectId && (
                          <CitationLink
                            projectId={projectId}
                            citationText={typeof row.citation === 'string' ? row.citation : (row.citation?.pdf_name || formatValue(row.drawingRaw) || 'Drawing Sheet')}
                            docName={typeof row.citation === 'string' ? row.citation : (row.citation?.pdf_name || (row.drawingRaw ? String(row.drawingRaw) : undefined))}
                            pageNumber={typeof row.citation === 'object' ? row.citation?.page : undefined}
                            bboxInches={typeof row.citation === 'object' ? (row.citation?.bbox_inches || row.citation?.bbox) : undefined}
                            sourceType={typeof row.citation === 'object' ? (row.citation?.source_type || row.citation?.sourceType || row.citation?.source) : "drawing"}
                            interactive
                            documentId={typeof row.citation === 'object' ? (row.citation?.document_id || row.citation?.documentId) : undefined}
                            className="max-w-full"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-5 align-top text-base">{renderUnitCell(row, row.locationPath, row.locationRaw, "text", "value_location")}</td>
                  <td className="px-3 py-5 align-top">
                    {renderUnitCell(row, row.frameTypePath, row.frameTypeRaw, "select", "value_frame_type")}
                  </td>
                  <td className="px-3 py-5 align-top">
                    {renderUnitCell(row, row.glassTypePath, row.glassTypeRaw, "select", "value_glass_type")}
                  </td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.glassThicknessPath, row.glassThicknessRaw, "text", "value_glass_thickness")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.widthPath, row.widthRaw, "number", "value_width_in")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.lengthPath, row.lengthRaw, "number", "value_length_in")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.panelsPath, row.panelsRaw, "integer", "value_panel_count")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.numUnitsPath, row.numUnitsRaw, "integer", "value_num_units")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.verticalRaftersPath, row.verticalRaftersRaw, "integer", "value_vertical_rafter_count")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.horizontalRaftersPath, row.horizontalRaftersRaw, "integer", "value_horizontal_rafter_count")}</td>
                    <td className="px-3 py-5 align-top">{renderUnitCell(row, row.manHoursPath, row.manHoursRaw, "number", "value_man_hours")}</td>
                    {!isApproved && !isLocked && (
                      <td className="px-3 py-5 align-top">
                        <button
                          type="button"
                          onClick={() => handleRemoveUnit(row)}
                          disabled={removingUnitKey === row.key}
                          aria-label={`Remove Unit ${row.unit}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {removingUnitKey === row.key ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
              <span className="inline-flex items-center gap-1.5 text-red-500"><AlertCircle size={16} /> {approveErrorMessage}</span>
            ) : crossbeamNeedsReview ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600"><AlertCircle size={16} /> {crossbeamReviewMessage}</span>
            ) : (
              <span className="text-gray-500">Review the parameters before approving.</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!isApproved && !isLocked && (
              <button
                type="button"
                disabled={isPatching || Object.keys(pendingChanges).length === 0 || hasValidationErrors}
                onClick={async () => {
                  const changesToSubmit = { ...pendingChanges };

                  const hasPanelChange = Object.keys(changesToSubmit).some(k => k.includes("panel_count") && !k.endsWith("takeoff.panel_count"));
                  if (hasPanelChange && derivedPanelCount !== panelCount?.value) {
                    changesToSubmit["stage_4.takeoff.panel_count"] = derivedPanelCount;
                  }

                  const answers = await collectFeedback(
                    buildParameterFeedbackRequests(changesToSubmit, rows, unitRows)
                  );

                  try {
                    for (const [path, value] of Object.entries(changesToSubmit)) {
                      const feedback = answers[path] ?? answers[unitKeyOfPath(path) ?? ""] ?? null;
                      await patchField({
                        projectId: projectId!,
                        fieldPath: path,
                        value,
                        ...(feedback ? { feedback } : {}),
                      });
                    }
                    showToast("success", "Changes updated successfully");
                    setPendingChanges({});
                    setValidationErrors({});
                    await refetch();
                  } catch (err) {
                    showToast("error", err instanceof Error ? err.message : "Failed to update some fields");
                  }
                }}
                className={`inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold text-white transition ${Object.keys(pendingChanges).length > 0 && !isPatching && !hasValidationErrors
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "cursor-not-allowed bg-gray-300"
                  }`}
              >
                {isPatching ? <Loader2 size={16} className="animate-spin" /> : "Update"}
              </button>
            )}

            {(true) && (
              <button
                type="button"
                onClick={() => {
                  if (hasValidationErrors) {
                    showToast("error", "Please correct the highlighted values before approving.");
                    return;
                  }
                  if (!isApproved && Object.keys(pendingChanges).length > 0) {
                    showToast("error", "Please click Update to save your changes before approving.");
                    return;
                  }
                  handleApprove();
                }}
                disabled={isApproving || isLocked || hasValidationErrors || (!isApproved && crossbeamNeedsReview)}
                className={`inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold text-white transition ${isApproved
                    ? "bg-green-600 hover:bg-green-700"
                    : isLocked || isApproving || hasValidationErrors || crossbeamNeedsReview
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
                stage={4}
                stageName="Dimensions & Crossbeam"
                onRevised={() => refetch()}
              />
            )}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(unitToRemove)}
        title={`Remove Unit ${unitToRemove?.unit ?? ""}?`}
        message="This clears all of the unit's take-off data and removes it from the table."
        confirmLabel="Remove unit"
        isConfirming={Boolean(unitToRemove && removingUnitKey === unitToRemove.key)}
        onCancel={() => setUnitToRemove(null)}
        onConfirm={() => void confirmRemoveUnit()}
      />
    </div>
  );
};

export default Parameters;
