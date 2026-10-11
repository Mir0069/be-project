// pages/estimator/workspace/tabs/Proposal.tsx

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Download,
  Edit3,
  Eye,
  FileText,
  RefreshCw,
  Save,
  X,
  Loader2,
} from "lucide-react";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import {
  useProposal,
  useProposalStage,
  usePatchProposalCells,
  useGenerateProposalExcel,
  useProposalDocumentFile,
  useProposalDocumentPdf,
} from "@/features/projects/query/proposalsQuery";
import type { ProposalDocumentInfo } from "@/services/proposals";
import { showToast } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { ApproveProposalAction } from "./components/ApproveProposalAction";
import { formatProposalStatus } from "@/features/estimator/workspace/utils/multiUnitDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Hard-coded mapping from the master "Proposal" sheet layout. All three blocks
// (header, unit grid, narrative sections) both RENDER the pre-populated values
// from schema.stage_6_proposal.cells and allow inline editing via Edit Draft.
// ─────────────────────────────────────────────────────────────────────────────

const PROPOSAL_HEADER_FIELDS: Array<{ label: string; cell: string }> = [
  { label: "Proposal #", cell: "K2" },
  { label: "Date", cell: "K3" },
  { label: "Project Name", cell: "K4" },
  { label: "Project Address", cell: "K5" },
  { label: "Project Type", cell: "K6" },
  { label: "Architect", cell: "K7" },
  { label: "Contact", cell: "K8" },
  { label: "Phone", cell: "K9" },
  { label: "Email", cell: "K10" },
  { label: "Quoted By", cell: "K11" },
];

// Unit rows 23-32 on the Proposal sheet map to Units A-J.
const UNIT_ROW_START = 23;
const UNIT_ROW_COUNT = 10;

interface UnitColumnDef {
  key: string;
  label: string;
  /** Column letter on the Proposal sheet; omit for computed/static columns. */
  col?: string;
  /** Static column (the "x" separator) — rendered but never editable. */
  staticValue?: string;
  inputType?: "text" | "number";
}

const UNIT_COLUMNS: UnitColumnDef[] = [
  { key: "unit", label: "Unit", col: "B" },
  { key: "drawing_no", label: "Drawing #", col: "C" },
  { key: "drawing_date", label: "Drawing Date", col: "D" },
  { key: "location", label: "Location", col: "E" },
  { key: "width", label: "Width (in)", col: "F", inputType: "number" },
  { key: "sep", label: "", staticValue: "x" },
  { key: "length", label: "Length (in)", col: "H", inputType: "number" },
  { key: "description", label: "Description", col: "J" },
];

const PROPOSAL_SECTIONS: Array<{
  id: string;
  label: string;
  cells: string[];
  type: "paragraph" | "list";
}> = [
  {
    id: "proposal_description",
    label: "Proposal Description",
    cells: ["B14"],
    type: "paragraph",
  },
  {
    id: "installation_intro",
    label: "Installation Instructions",
    cells: ["B16"],
    type: "paragraph",
  },
  {
    id: "installation_steps",
    label: "Installation Steps",
    cells: ["B17", "B18", "B19"],
    type: "list",
  },
  {
    id: "supply_statement",
    label: "Supply Statement",
    cells: ["B21"],
    type: "paragraph",
  },
  {
    id: "glazing_1",
    label: "Glazing Make-up",
    cells: ["B35", "B36", "B37", "B38", "B39", "B40"],
    type: "list",
  },
  {
    id: "glazing_2",
    label: "Glazing Make-up (Alternate)",
    cells: ["B42", "B43", "B44", "B45", "B46", "B47", "B48", "B49", "B50", "B51"],
    type: "list",
  },
  {
    id: "glazing_3",
    label: "Glazing Make-up - Series 2000",
    cells: ["B53", "B54", "B55", "B56", "B57", "B58", "B59", "B60", "B61", "B62"],
    type: "list",
  },
  {
    id: "frame_finish",
    label: "Frame Finish",
    cells: ["B65"],
    type: "paragraph",
  },
  {
    id: "lead_time",
    label: "Lead Time",
    cells: ["B74"],
    type: "paragraph",
  },
  {
    id: "shop_drawings",
    label: "Shop Drawings",
    cells: ["B77"],
    type: "paragraph",
  },
];

type SheetCell = string | number | boolean | null;

type CellsMap = Record<string, string | number | null>;

interface WorkbookPreview {
  fileName: string;
  sheetName: string;
  rows: SheetCell[][];
}

// Parses the generated/persisted .xlsx client-side and extracts the Proposal
// sheet as a row matrix for read-only rendering.
const parseWorkbookPreview = async (
  blob: Blob,
  fileName: string
): Promise<WorkbookPreview> => {
  const buf = await blob.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName =
    wb.SheetNames.find((n) => /proposal/i.test(n) && !/description/i.test(n)) ??
    wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const ws = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(ws, {
    header: 1,
    blankrows: true,
    defval: null,
  });
  return { fileName, sheetName, rows };
};

const getCellValue = (cells: CellsMap, address: string): string => {
  const value = cells[address];
  if (value === null || value === undefined) return "";
  return String(value);
};

// The seeded unit letter (A-J) always occupies the unit grid's first column
// regardless of whether that unit has real take-off data, so it must be
// excluded when deciding whether a unit row is empty — otherwise every
// placeholder-only unit slot would still look "populated". The sheet's own
// formulas also resolve unfilled fields to a literal "0" (never blank), the
// Description column ships a literal "Description" placeholder for every
// unpopulated unit slot (the backend's extractComputedProposalCells
// special-cases this same literal for the same reason), and the width x
// length separator column is always the static text "x" — so all three
// count as blank here too.
const isBlankUnitCell = (value: SheetCell): boolean => {
  if (value === null || value === undefined) return true;
  const text = String(value).trim().toLowerCase();
  return text === "" || text === "0" || text === "description" || text === "x";
};

const WorkbookPreviewTable = ({ preview }: { preview: WorkbookPreview }) => {
  // Drop fully-empty rows (spacer rows, and rows the backend cleared because
  // they belonged to a glazing block/addon-unit slot that doesn't apply to
  // this quote — e.g. only one of the three "Glass Make-up" blocks is ever
  // populated, and unpopulated units' addon rows are cleared, not just
  // hidden, precisely so this raw-cell preview drops them too), plus any
  // placeholder-only unit rows in the middle of the grid, so the preview
  // only shows real content.
  const trimmed = useMemo(() => {
    // Locate the unit grid by its own "Unit" header cell rather than a fixed
    // row/column — sheet_to_json's column indices are relative to the
    // worksheet's used range (here it starts at column B, not A), and the
    // grid's row position has also shifted between template revisions, so a
    // hardcoded offset silently stops matching real rows/columns.
    let headerRowIdx = -1;
    let unitLetterColIdx = -1;
    outer: for (let r = 0; r < preview.rows.length; r++) {
      const row = preview.rows[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        if (typeof row[c] === "string" && String(row[c]).trim().toLowerCase() === "unit") {
          headerRowIdx = r;
          unitLetterColIdx = c;
          break outer;
        }
      }
    }
    const unitRowStartIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : -1;

    const rows = preview.rows.filter((row, idx) => {
      const isUnitRow =
        unitRowStartIdx >= 0 &&
        idx >= unitRowStartIdx &&
        idx < unitRowStartIdx + UNIT_ROW_COUNT;
      if (!isUnitRow) return true;
      return (row ?? []).some(
        (c, cIdx) => cIdx !== unitLetterColIdx && !isBlankUnitCell(c)
      );
    });

    const isEmptyRow = (row?: SheetCell[]) =>
      !row || row.every((c) => c === null || String(c).trim() === "");
    return rows.filter((row) => !isEmptyRow(row));
  }, [preview.rows]);

  const columnCount = useMemo(
    () => Math.min(26, Math.max(...trimmed.map((r) => r.length), 0)),
    [trimmed]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500 truncate" title={preview.fileName}>
          {preview.fileName} · sheet “{preview.sheetName}”
        </div>
        <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
          Read-only preview
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-md">
        <table className="border-collapse text-[11px] leading-snug">
          <tbody>
            {trimmed.map((row, rIdx) => (
              <tr key={rIdx}>
                <td className="sticky left-0 z-10 border border-gray-200 bg-gray-50 text-center text-gray-400 px-1.5 py-0.5 select-none">
                  {rIdx + 1}
                </td>
                {Array.from({ length: columnCount }, (_, cIdx) => {
                  const value = row[cIdx];
                  const text =
                    value === null || value === undefined ? "" : String(value);
                  return (
                    <td
                      key={cIdx}
                      className={`border border-gray-200 px-1.5 py-0.5 align-top whitespace-pre-wrap max-w-[220px] xl:max-w-[280px] ${
                        text.trim() === "" ? "bg-white" : "bg-white text-gray-800"
                      }`}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Proposal = () => {
  const { isSalesManager } = useAuth();
  const { projectId } = useProjectRoute();
  const {
    data: proposal,
    isLoading: isLoadingProposal,
    isError: isProposalError,
    error: proposalError,
  } = useProposal(projectId);
  const { data: stage7 } = useProposalStage(projectId, 7);
  const patchCells = usePatchProposalCells();
  const generateExcel = useGenerateProposalExcel();
  const documentFile = useProposalDocumentFile();
  const documentPdf = useProposalDocumentPdf();

  const [isEditing, setIsEditing] = useState(false);
  // Sparse map of unsaved user edits (cell address → new value). Displayed
  // values are derived as `edits[address] ?? serverValue`, so no effect is
  // needed to sync server data into local state.
  const [cellEdits, setCellEdits] = useState<CellsMap>({});
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);

  const cells: CellsMap = proposal?.stage_6_proposal?.cells ?? {};
  const targetSheet = proposal?.stage_6_proposal?.target_sheet ?? "Proposal";
  const proposalStatus = proposal?.stage_6_proposal?.status;
  const isStage7Approved = stage7?.status === "APPROVED";
  const documents: ProposalDocumentInfo[] = proposal?.documents ?? [];
  // The backend omits stale generated quotes after Stage 7 changes. Do not
  // fall back to the history list here, or the proposal screen could display
  // an older workbook as if it were current.
  const latestDocument = proposal?.latest_document ?? null;
  const hasContent = useMemo(
    () =>
      Object.values(cells).some(
        (v) => v !== null && v !== undefined && String(v).trim() !== ""
      ),
    [cells]
  );

  const handleEdit = () => setIsEditing(true);
  const handleCancel = () => {
    setCellEdits({});
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!projectId) return;
    try {
      await patchCells.mutateAsync({ projectId, cells: cellEdits, targetSheet });
      setCellEdits({});
      setIsEditing(false);
    } catch {
      // Error toast handled by mutation
    }
  };

  // Generate persists the workbook server-side, then shows the returned
  // workbook inline as a read-only preview instead of downloading it.
  const handleGenerate = async () => {
    if (!projectId) return;
    if (!isStage7Approved) {
      showToast("info", "Stage 7 must be approved before generating the proposal");
      return;
    }
    try {
      const { blob } = await generateExcel.mutateAsync({ projectId });
      const parsed = await parseWorkbookPreview(
        blob,
        latestDocument?.originalName ?? "Proposal.xlsx"
      );
      setIsEditing(false);
      setPreview(parsed);
    } catch (err) {
      console.error("Failed to build proposal preview:", err);
      showToast("error", "Generated the draft but failed to render the preview");
    }
  };

  const openDraftPreview = async (doc: ProposalDocumentInfo) => {
    if (!projectId) return;
    try {
      const { blob } = await documentFile.mutateAsync({
        projectId,
        documentId: doc._id,
        mode: "preview",
        fileName: doc.originalName,
      });
      const parsed = await parseWorkbookPreview(blob, doc.originalName);
      setIsEditing(false);
      setPreview(parsed);
    } catch {
      // Error toast handled by mutation
    }
  };

  const downloadDraft = async (doc: ProposalDocumentInfo) => {
    if (!projectId) return;
    if (!isStage7Approved) {
      showToast("info", "Stage 7 must be approved before downloading the proposal");
      return;
    }
    try {
      await documentPdf.mutateAsync({
        projectId,
        documentId: doc._id,
        fileName: doc.originalName,
      });
    } catch {
      // Error toast handled by mutation
    }
  };

  const updateCell = (address: string, value: string) => {
    setCellEdits((prev) => ({
      ...prev,
      [address]: value.trim() === "" ? null : value,
    }));
  };

  // Effective value shown in edit-mode inputs: unsaved edit wins, else server.
  const getDraftValue = (address: string): string =>
    address in cellEdits
      ? cellEdits[address] === null
        ? ""
        : String(cellEdits[address])
      : getCellValue(cells, address);

  // Which unit rows carry data (read-only view hides fully-empty rows).
  // The template always writes the unit letter into the "unit" column for
  // every one of the 10 seeded slots, so that column must be excluded here —
  // otherwise every placeholder-only unit would still register as "populated".
  // The sheet's own formulas also resolve location/width/length to literal
  // "0" for units the estimator never touched, so "0" counts as blank too.
  const populatedUnitRows = useMemo(() => {
    const rows: number[] = [];
    for (let i = 0; i < UNIT_ROW_COUNT; i++) {
      const row = UNIT_ROW_START + i;
      const hasData = UNIT_COLUMNS.some((colDef) => {
        if (!colDef.col || colDef.key === "unit") return false;
        const value = getCellValue(cells, `${colDef.col}${row}`).trim();
        return value !== "" && value !== "0";
      });
      if (hasData) rows.push(row);
    }
    return rows;
  }, [cells]);

  const visibleHeaderFields = useMemo(
    () =>
      PROPOSAL_HEADER_FIELDS.filter(
        ({ cell }) => getCellValue(cells, cell).trim() !== ""
      ),
    [cells]
  );

  // Early returns must stay BELOW every hook (Rules of Hooks).
  if (isLoadingProposal) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading proposal...
      </div>
    );
  }

  if (isProposalError) {
    const message =
      proposalError instanceof Error
        ? proposalError.message
        : "Failed to load the proposal.";
    return (
      <div className="border-l-3 border-red-500 px-4 mb-4">
        <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
          Proposal Document
        </div>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
          <p className="mt-1 text-xs text-red-500">
            Check that you are the assigned estimator for this project and that
            Stage 5 has been approved so the AI can generate proposal content.
          </p>
        </div>
      </div>
    );
  }

  const renderHeaderBlock = () => {
    const fields =
      isEditing
        ? PROPOSAL_HEADER_FIELDS
        : visibleHeaderFields.length > 0
          ? visibleHeaderFields
          : [];

    if (fields.length === 0) return null;

    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Proposal Details
        </h4>
        <div className="bg-gray-50 rounded-md p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-2.5">
          {fields.map(({ label, cell }) =>
            isEditing ? (
              <label key={cell} className="block">
                <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">
                  {label}
                </span>
                <input
                  type="text"
                  value={getDraftValue(cell)}
                  onChange={(e) => updateCell(cell, e.target.value)}
                  placeholder={label}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              </label>
            ) : (
              <div key={cell} className="flex gap-2 text-xs min-w-0">
                <span className="text-gray-500 w-28 shrink-0">{label}</span>
                <span className="text-gray-800 font-medium min-w-0 [overflow-wrap:anywhere]">
                  {getCellValue(cells, cell)}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    );
  };

  const renderUnitGrid = () => {
    // Edit mode shows every unit slot; read-only mode only populated rows.
    const rows = isEditing
      ? Array.from({ length: UNIT_ROW_COUNT }, (_, i) => UNIT_ROW_START + i)
      : populatedUnitRows;

    if (rows.length === 0) return null;

    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Units
        </h4>
        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="w-full min-w-[600px] xl:min-w-[680px] text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200">
                {UNIT_COLUMNS.map((col, idx) => (
                  <th
                    key={`${col.key}-${idx}`}
                    className={`px-2 py-1.5 ${col.staticValue !== undefined ? "w-6 text-center" : ""}`}
                  >
                    {col.label || col.staticValue}
                  </th>
                ))}
              </tr>
              </thead>
              <tbody>
              {rows.map((row) => {
                return (
                <tr key={row} className="border-b border-gray-100 last:border-b-0">
                  {UNIT_COLUMNS.map((col, idx) => {
                    if (col.staticValue !== undefined) {
                      return (
                        <td
                          key={`${col.key}-${idx}`}
                          className="px-2 py-1 text-center text-gray-400 text-xs select-none"
                        >
                          {col.staticValue}
                        </td>
                      );
                    }
                    const address = `${col.col}${row}`;
                    if (!isEditing) {
                      const value = getCellValue(cells, address);
                      return (
                        <td
                          key={`${col.key}-${idx}`}
                          className="px-2 py-1 text-xs text-gray-800 whitespace-pre-wrap"
                        >
                          {value || <span className="text-gray-300">—</span>}
                        </td>
                      );
                    }
                    return (
                      <td key={`${col.key}-${idx}`} className="px-1 py-1">
                        <input
                          type={col.inputType ?? "text"}
                          value={getDraftValue(address)}
                          onChange={(e) => updateCell(address, e.target.value)}
                          aria-label={`Row ${row} ${col.label}`}
                           className="w-full min-w-[56px] rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-red-500 focus:ring-1 focus:ring-red-500"
                        />
                      </td>
                    );
                  })}
                </tr>
                );
              })}
              </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderNarrativeSections = (
    sections: typeof PROPOSAL_SECTIONS = PROPOSAL_SECTIONS
  ) =>
    sections.map((section) => {
      const source = cells;
      const sectionCells = section.cells.filter((c) => {
        if (isEditing) return true;
        return getCellValue(cells, c).trim() !== "";
      });

      if (sectionCells.length === 0) return null;

      return (
        <div key={section.id}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {section.label}
          </h4>

          {isEditing ? (
            <div className="space-y-2">
              {section.cells.map((address) => (
                <textarea
                  key={address}
                  value={getDraftValue(address)}
                  onChange={(e) => updateCell(address, e.target.value)}
                  placeholder={`Cell ${address}`}
                  rows={section.type === "paragraph" ? 4 : 2}
                  className="w-full rounded-md border border-gray-300 p-2.5 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              ))}
            </div>
          ) : (
            <div className="bg-gray-50 rounded-md p-4">
              {section.type === "paragraph" ? (
                <p className="whitespace-pre-wrap leading-relaxed">
                  {getCellValue(source, sectionCells[0]!)}
                </p>
              ) : (
                <ul className="list-disc list-inside space-y-1">
                  {sectionCells.map((address) => {
                    const value = getCellValue(cells, address);
                    if (!value) return null;
                    return (
                      <li key={address} className="leading-relaxed">
                        {value}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      );
    });

  const docAreaHasBlocks =
    visibleHeaderFields.length > 0 ||
    populatedUnitRows.length > 0 ||
    PROPOSAL_SECTIONS.some((s) =>
      s.cells.some((c) => getCellValue(cells, c).trim() !== "")
    );

  return (
    <>
      <div className="border-l-3 border-red-500 px-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
            Proposal Document
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${proposalStatus === "READY_FOR_PROPOSAL_EXCEL" || proposalStatus === "READY_FOR_EXCEL"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-gray-100 text-gray-700"
              }`}
            title="Proposal workbook readiness"
          >
            {formatProposalStatus(proposalStatus)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_272px] xl:grid-cols-[minmax(0,1fr)_304px] 2xl:grid-cols-[minmax(0,1fr)_352px] gap-4 lg:gap-6 h-full pb-12">
        {/* Left: doc area */}
        <section className="bg-white rounded-lg border border-gray-200 p-4 lg:p-6 flex flex-col h-full min-h-0">
          {preview ? (
            <>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="self-start mb-3 inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
              >
                <X size={16} /> Close preview
              </button>
              <div className="flex-1 min-h-0">
                <WorkbookPreviewTable preview={preview} />
              </div>
            </>
          ) : !docAreaHasBlocks && !isEditing ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
              <p className="text-sm text-gray-500 mb-3">
                No proposal content yet. Click Edit Draft to add content, then Generate to create a draft preview.
              </p>
              <FileText size={28} className="text-gray-400" />
            </div>
          ) : (
            <div className="space-y-6 text-sm text-gray-700 overflow-auto pr-1">
              {renderHeaderBlock()}
              {renderNarrativeSections(
                PROPOSAL_SECTIONS.filter((s) => s.id === "proposal_description")
              )}
              {renderUnitGrid()}
              {renderNarrativeSections(
                PROPOSAL_SECTIONS.filter((s) => s.id !== "proposal_description")
              )}
            </div>
          )}
        </section>

        {/* Right: Draft Actions + Previous Drafts */}
        <aside className="space-y-4">
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-red-500 mb-3">
              Draft Actions
            </h3>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!isStage7Approved || generateExcel.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:border-red-500 hover:text-white hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:text-gray-700"
            >
              {generateExcel.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {documents.length > 0 ? "Regenerate" : "Generate"}
            </button>

            {!isStage7Approved && (
              <p className="text-[10px] text-gray-500 mt-1.5">
                Approve Stage 7 (Final Parameters) to enable generation.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 mt-2">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={patchCells.isPending}
                    className="flex flex-col items-center justify-center gap-1 px-3 py-2.5 border border-gray-200 rounded-md text-xs text-gray-700 hover:border-red-500 hover:text-red-500 transition disabled:opacity-50"
                  >
                    {patchCells.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex flex-col items-center justify-center gap-1 px-3 py-2.5 border border-gray-200 rounded-md text-xs text-gray-700 hover:border-red-500 hover:text-red-500 transition"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleEdit}
                    disabled={!!preview}
                    className="flex flex-col items-center justify-center gap-1 px-3 py-2.5 border border-gray-200 rounded-md text-xs text-gray-700 hover:border-red-500 hover:text-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Edit3 size={14} />
                    Edit Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => latestDocument && downloadDraft(latestDocument)}
                    disabled={!latestDocument || !isStage7Approved || documentPdf.isPending}
                    title={!isStage7Approved ? "Approve Stage 7 before downloading" : undefined}
                    className="flex flex-col items-center justify-center gap-1 px-3 py-2.5 border border-gray-200 rounded-md text-xs text-gray-700 hover:border-red-500 hover:text-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download size={14} />
                    Download
                  </button>
                </>
              )}
            </div>

            <ApproveProposalAction
              projectId={projectId!}
              approval={proposal?.lead_approval}
              hasDraft={!!latestDocument}
              canSend={proposal?.send_readiness?.canSend ?? false}
              sendReason={proposal?.send_readiness?.reason}
            />
          </section>

        </aside>
      </div>
    </>
  );
};

export default Proposal;
