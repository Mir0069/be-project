import React, { useEffect, useState, useMemo, useDeferredValue } from "react";
import {
  X,
  RefreshCw,
  Mail,
  Paperclip,
  Eye,
  Loader2,
  Check,
  Search,
  Building2,
  MapPin,
  User,
  ChevronRight
} from "lucide-react";
import { fetchProjects } from "@/services/projects";
import { moveOutlookEmail } from "@/services/outlook";
import { showToast } from "@/components/ui/toast";
import { openDocumentPreview } from "@/shared/lib/filePreview";
import type { OutlookEmail } from "@/shared/types/email.types";
import type { Project } from "@/shared/types/project.types";

interface MoveEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: OutlookEmail | null;
  currentProjectId?: string;
  onMovedSuccess?: () => void;
}

export const MoveEmailModal: React.FC<MoveEmailModalProps> = ({
  isOpen,
  onClose,
  email,
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

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
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
  }, [isOpen, currentProjectId]);

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
  if (!email) return null;

  const handlePreviewAttachment = (att: { id?: string; name: string; storageKey?: string }) => {
    const docId = att.storageKey || att.id || "";
    if (docId) {
      openDocumentPreview(docId, att.name);
    } else {
      showToast("error", "Document preview unavailable for this attachment");
    }
  };

  const handleMove = async () => {
    if (!selectedProject) {
      showToast("error", "Please select a destination project");
      return;
    }

    const emailIdToMove = email.id || (email as any)._id || email.messageId;
    if (!emailIdToMove) {
      showToast("error", "Invalid email ID");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await moveOutlookEmail(emailIdToMove, selectedProject.id, false);
      showToast(
        "success",
        `Email and ${result.movedDocumentCount || 0} document(s) transferred to ${selectedProject.projectName}!`
      );
      handleInitiateClose();
      if (onMovedSuccess) {
        onMovedSuccess();
      }
    } catch (err: any) {
      console.error("Failed to move email:", err);
      showToast(
        "error",
        err.response?.data?.error?.message || err.message || "Failed to change project for email"
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
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Move Email to Project</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Re-assign this email and its attachments to another project
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
          {/* Left Column: Destination Project Selection (6 Cols) */}
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
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white shadow-sm overscroll-contain">
                  {loadingProjects ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400 gap-2 p-6">
                      <Loader2 size={16} className="animate-spin text-red-500" /> Loading project directory...
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400 p-6 text-center">
                      No matching projects found for "{searchQuery}".
                    </div>
                  ) : (
                    <>
                      {deferredSearch ? (
                        <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-600 flex items-center justify-between sticky top-0 z-10">
                          <span>Found {filteredProjects.length} matching project{filteredProjects.length === 1 ? '' : 's'}</span>
                          <span className="text-[10px] text-slate-400">Showing top matches</span>
                        </div>
                      ) : projects.length > 20 ? (
                        <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-600 flex items-center justify-between sticky top-0 z-10">
                          <span>Recent projects</span>
                          <span className="text-[10px] text-slate-400">Type to search {projects.length.toLocaleString()}</span>
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

          {/* Right Column: Email Content & Attachments & AI Option (6 Cols) */}
          <div className="md:col-span-7 p-5 sm:p-6 flex flex-col min-h-0 space-y-4 bg-white">
            {/* Email Header Info */}
            <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl shrink-0">
              <div className="flex items-center gap-2">
                <Mail size={16} className="text-red-500 shrink-0" />
                <h3 className="text-xs font-bold text-slate-900 truncate">{email.subject}</h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                From: <span className="text-slate-700 font-semibold">{email.fromName || email.fromAddress}</span>{" "}
                &lt;{email.fromAddress}&gt; •{" "}
                {email.receivedDateTime &&
                  new Date(email.receivedDateTime).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
              </p>
            </div>

            {/* Email Body & Attachments (Scrollable Container) */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 overscroll-contain">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Email content
                </label>
                <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-sans bg-slate-50 p-3.5 rounded-lg border border-slate-200 shadow-sm">
                  {email.bodyText || "(No plain-text body content available)"}
                </div>
              </div>

              {email.attachments && email.attachments.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                    Attachments ({email.attachments.length})
                  </label>
                  <div className="space-y-2">
                    {email.attachments.map((att: any, idx: number) => (
                      <div
                        key={att.id || idx}
                        className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg text-xs hover:border-slate-300 transition-colors shadow-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <Paperclip size={13} className="text-slate-400 shrink-0" />
                          <span className="truncate font-medium text-slate-800" title={att.name}>
                            {att.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePreviewAttachment(att)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 bg-white hover:bg-red-50 border border-red-200 rounded-md transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                          title="Preview Document"
                        >
                          <Eye size={12} />
                          Preview
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-4 shrink-0">
          <span className="text-xs text-slate-500 font-medium truncate">
            {selectedProject ? (
                <span className="text-slate-700 font-semibold">
                Destination: <span className="text-red-600">{selectedProject.projectName}</span>
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
                  Updating Project & Dropbox...
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
