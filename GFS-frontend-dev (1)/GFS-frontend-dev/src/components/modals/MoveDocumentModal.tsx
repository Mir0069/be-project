import React, { useEffect, useState, useMemo, useDeferredValue } from "react";
import {
  X,
  RefreshCw,
  FileText,
  Eye,
  Loader2,
  Check,
  Search,
  Building2,
  MapPin,
  User,
  ChevronRight,
  Trash2
} from "lucide-react";
import { fetchProjects } from "@/services/projects";
import { moveDocuments } from "@/services/documents";
import { showToast } from "@/components/ui/toast";
import { openDocumentPreview } from "@/shared/lib/filePreview";
import type { ApiDocument } from "@/services/documents";
import type { Project } from "@/shared/types/project.types";

interface MoveDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  documents: ApiDocument[];
  currentProjectId?: string;
  onMovedSuccess?: () => void;
}

export const MoveDocumentModal: React.FC<MoveDocumentModalProps> = ({
  isOpen,
  onClose,
  documents: initialDocuments,
  currentProjectId,
  onMovedSuccess,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<ApiDocument[]>([]);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setSelectedDocs(initialDocuments);
      setSelectedProject(null);
      setSearchQuery("");
      setLoadingProjects(true);

      fetchProjects()
        .then((data) => {
          setProjects(
            data.filter(
              (p) =>
                p.id !== currentProjectId &&
                p.referenceNumber !== currentProjectId &&
                p.projectCode !== currentProjectId
            )
          );
        })
        .catch((err) => {
          console.error("Failed to load projects:", err);
          showToast("error", "Failed to load projects list");
        })
        .finally(() => setLoadingProjects(false));
    }
  }, [isOpen, initialDocuments, currentProjectId]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        handleInitiateClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting]);

  const handleInitiateClose = () => {
    if (isClosing || isSubmitting) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 280);
  };

  // Case-insensitive search across referenceNumber, projectCode, name, customer, address
  const filteredProjects = useMemo(() => {
    if (!deferredSearch.trim()) {
      return projects.slice(0, 30);
    }
    const q = deferredSearch.toLowerCase().trim();
    const qClean = q.replace(/[\s\-_]/g, "");

    return projects
      .filter((p) => {
        const name = (p.projectName || "").toLowerCase();
        const ref = (p.referenceNumber || p.projectCode || (p as any).quoteNumber || "").toLowerCase();
        const refClean = ref.replace(/[\s\-_]/g, "");
        const customer = (p.customerName || (p as any).company || "").toLowerCase();
        const address = (p.projectAddress || (p as any).jobAddress || "").toLowerCase();

        return (
          name.includes(q) ||
          ref.includes(q) ||
          (qClean.length > 1 && refClean.includes(qClean)) ||
          customer.includes(q) ||
          address.includes(q)
        );
      })
      .slice(0, 60);
  }, [projects, deferredSearch]);

  if (!isOpen && !isClosing) return null;

  const handlePreview = (doc: ApiDocument) => {
    const docId = doc.id || (doc as any)._id;
    if (docId) {
      openDocumentPreview(docId, doc.originalName || doc.name || "Document");
    } else {
      showToast("error", "Document preview unavailable for this item");
    }
  };

  const handleRemoveDocFromSelection = (docIdToRemove: string) => {
    const next = selectedDocs.filter((d) => (d.id || (d as any)._id) !== docIdToRemove);
    if (next.length === 0) {
      handleInitiateClose();
    } else {
      setSelectedDocs(next);
    }
  };

  const handleMove = async () => {
    if (!selectedProject) {
      showToast("error", "Please select a destination project");
      return;
    }

    const docIds = selectedDocs
      .map((d) => d.id || (d as any)._id)
      .filter((id): id is string => !!id);

    if (docIds.length === 0) {
      showToast("error", "No valid document IDs to move");
      return;
    }

    setIsSubmitting(true);
    try {
      const sourceProjectId = currentProjectId || selectedDocs[0].projectId || "";
      const result = await moveDocuments(sourceProjectId, docIds, selectedProject.id, false);
      showToast(
        "success",
        `Successfully transferred ${result.movedCount || docIds.length} document(s) to ${selectedProject.projectName}!`
      );
      handleInitiateClose();
      if (onMovedSuccess) {
        onMovedSuccess();
      }
    } catch (err: any) {
      console.error("Failed to move documents:", err);
      showToast(
        "error",
        err.response?.data?.error?.message || err.message || "Failed to change project for documents"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedRef =
    selectedProject?.referenceNumber ||
    selectedProject?.projectCode ||
    (selectedProject as any)?.quoteNumber;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 transition-opacity duration-300 ${
        isClosing ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{
        animation: isClosing ? undefined : "modalBackdropFade 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {/* Decoupled Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs transition-opacity"
        onClick={handleInitiateClose}
      />

      {/* Modal Dialog (Spacious Widescreen 5xl & Consistent Height) */}
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full max-w-6xl h-[78vh] max-h-[780px] min-h-[560px] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden transition-all duration-300 ${
          isClosing ? "opacity-0 scale-95 translate-y-3" : ""
        }`}
        style={{
          animation: isClosing ? undefined : "modalDialogSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 border border-red-100 flex items-center justify-center shrink-0">
              <RefreshCw size={19} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Move Document{selectedDocs.length > 1 ? `s (${selectedDocs.length})` : ""} to Project
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Re-assign these attachments to another project
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInitiateClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
          >
            <X size={19} />
          </button>
        </div>

        {/* 2-Column Modal Body (Spacious & Clean) */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-slate-50">
          {/* Left Column: Destination Project Selection (5 Cols) */}
          <div className="md:col-span-5 p-5 sm:p-6 flex flex-col min-h-0 bg-slate-50/70">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <label className="text-xs font-bold tracking-wider text-slate-700 uppercase flex items-center gap-1">
                <span>Select Destination Project</span>
                <span className="text-red-500">*</span>
              </label>
              {projects.length > 0 && (
                <span className="text-xs font-medium text-slate-500">
                  {projects.length.toLocaleString()} projects
                </span>
              )}
            </div>

            {selectedProject ? (
              <div className="p-4 bg-white border border-red-200 rounded-lg flex items-center justify-between gap-3 shadow-sm animate-in fade-in duration-200 mb-auto">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-red-600 text-white flex items-center justify-center shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {selectedProject.projectName}
                      </span>
                      {selectedRef && (
                        <span className="text-xs px-2.5 py-0.5 rounded bg-red-50 text-red-700 font-semibold shrink-0">
                          {selectedRef}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate flex items-center gap-3 mt-1">
                      {selectedProject.customerName && (
                          <span className="flex items-center gap-1 font-medium text-slate-600">
                            <User size={12} className="text-slate-400" />
                          {selectedProject.customerName}
                        </span>
                      )}
                      {selectedProject.projectAddress && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} className="text-slate-400" />
                          {selectedProject.projectAddress}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProject(null)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:text-red-800 bg-white hover:bg-red-50 border border-red-200 rounded-md transition shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0 space-y-2.5">
                <div className="relative shrink-0">
                  <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search by project name, reference code (e.g. GFS-2026-1004)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-9 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition shadow-sm placeholder:text-slate-400"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white shadow-sm overscroll-contain">
                  {loadingProjects ? (
                    <div className="h-full flex items-center justify-center text-xs text-gray-400 gap-2 p-6">
                      <Loader2 size={16} className="animate-spin text-red-500" /> Loading project directory...
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-gray-400 p-6 text-center">
                      No matching projects found for "{searchQuery}".
                    </div>
                  ) : (
                    <>
                      {deferredSearch ? (
                        <div className="px-3.5 py-1.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 flex items-center justify-between sticky top-0 bg-white z-10">
                          <span>Found {filteredProjects.length} matching project{filteredProjects.length === 1 ? '' : 's'}</span>
                          <span className="text-[10px] text-gray-400">Showing top matches</span>
                        </div>
                      ) : projects.length > 20 ? (
                        <div className="px-3.5 py-1.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 flex items-center justify-between sticky top-0 bg-white z-10">
                          <span>Recent projects</span>
                          <span className="text-[10px] text-gray-400">Type to search {projects.length.toLocaleString()}</span>
                        </div>
                      ) : null}
                      {filteredProjects.map((proj) => {
                        const ref =
                          proj.referenceNumber ||
                          proj.projectCode ||
                          (proj as any).quoteNumber;
                        return (
                          <button
                            key={proj.id}
                            type="button"
                            onClick={() => {
                              setSelectedProject(proj);
                              setSearchQuery("");
                            }}
                            className="w-full text-left px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-red-50/50 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:bg-red-50/50"
                          >
                            <div className="flex flex-col min-w-0 pr-3">
                              <span className="font-semibold text-sm text-slate-900 truncate group-hover:text-red-600 transition-colors">
                                {proj.projectName}
                              </span>
                              <div className="flex items-center gap-2 mt-1 min-w-0">
                                {ref && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono font-medium shrink-0">
                                    {ref}
                                  </span>
                                )}
                                <span className="text-[11px] text-slate-500 truncate">
                                  {proj.customerName ? `Client: ${proj.customerName}` : ""}
                                  {proj.customerName && proj.projectAddress ? " • " : ""}
                                  {proj.projectAddress || ""}
                                </span>
                              </div>
                            </div>
                            <div className="w-7 h-7 rounded-full bg-slate-100 group-hover:bg-red-100 text-slate-400 group-hover:text-red-600 flex items-center justify-center shrink-0 transition-colors">
                              <ChevronRight size={14} />
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Selected Documents & AI Option (7 Cols) */}
          <div className="md:col-span-7 p-5 sm:p-6 flex flex-col min-h-0 space-y-4 bg-white">
            <div className="flex items-center justify-between shrink-0">
              <label className="text-xs font-bold tracking-wider text-gray-700 uppercase">
                Attachments to transfer ({selectedDocs.length})
              </label>
              <span className="text-xs text-gray-400">
                Preview or remove files before moving
              </span>
            </div>

            {/* Scrollable Document Cards */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 overscroll-contain">
              {selectedDocs.map((doc, idx) => {
                const name = doc.originalName || doc.name || `Document-${idx + 1}`;
                return (
                  <div
                    key={doc.id || idx}
                    className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors shadow-2xs group"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                        <FileText size={16} />
                      </div>
                      <span className="text-xs font-medium text-gray-800 truncate" title={name}>
                        {name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePreview(doc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-white hover:bg-red-50 border border-red-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                        title="Preview Document"
                      >
                        <Eye size={13} />
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveDocFromSelection(doc.id || (doc as any)._id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Remove document from transfer selection"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-4 shrink-0">
          <span className="text-xs text-slate-500 font-medium truncate">
            {selectedProject ? (
              <span className="text-gray-700 font-semibold">
                Destination: <span className="text-red-600">{selectedProject.projectName}</span> ({selectedDocs.length} file{selectedDocs.length === 1 ? '' : 's'})
              </span>
            ) : "Please select a destination project on the left"}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleInitiateClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleMove}
              disabled={!selectedProject || isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Transferring Documents & Dropbox...
                </>
              ) : (
                <>
                  Move to Project
                  <RefreshCw size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
