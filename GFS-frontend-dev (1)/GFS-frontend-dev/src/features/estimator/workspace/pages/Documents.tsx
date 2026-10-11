// pages/estimator/workspace/tabs/Documents.tsx
// API-source: uses GET/POST/DELETE /documents endpoints via React Query.
// Falls back to localStorage for static/PRJ-XXXX projects.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Image,
  Loader2,
  Music,
  Trash2,
  UploadCloud,
  X,
  Copy,
  Check,
  PhoneCall,
  Plus,
  Play,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { useAuth } from "@/context/AuthContext";

import { showToast } from "@/components/ui/toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { getProjectById } from "@/utils/project-storage";
import {
  useDocuments,
  useUploadDocument,
  useDeleteDocument,
} from "@/features/projects/query/documentsQuery";
import { useProject, useSyncDropbox } from "@/features/projects/query/projectsQuery";
import {
  useProjectCalls,
  useDeleteCallRecord,
  useUploadCallRecordAudio,
  useCreateCallRecordText,
  useUpdateCallRecord,
} from "@/features/comms/query/commsQuery";
import type { CallRecord } from "@/shared/types/comms.types";
import { callRecordings } from "@/features/estimator/workspace/mockData";
import type { ApiDocument } from "@/services/documents";
import { getDocumentSource } from "@/features/estimator/workspace/utils/documentSource";
import { getVisibleProjectDocuments } from "@/shared/lib/documentLabel";
import { openDocumentPreview, openStagedBlobInWindow } from "@/shared/lib/filePreview";
import { MoveDocumentModal } from "@/components/modals/MoveDocumentModal";
import { useQueryClient } from "@tanstack/react-query";
import { DOCUMENTS_KEY, useRestoreDocument } from "@/features/projects/query/documentsQuery";
import { toast } from "sonner";


// ─── Helpers ─────────────────────────────────────────────────────────────────

const isMongoId = (id: string) => /^[a-f\d]{24}$/i.test(id);

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const getFileType = (fileName: string) =>
  fileName.split(".").pop()?.toLowerCase();

// ─── File Icon ────────────────────────────────────────────────────────────────

const FileTypeIcon = ({ type }: { type?: string }) => {
  const cls = "shrink-0";
  if (type === "pdf") return <FileText size={20} className={`${cls} text-red-500`} />;
  if (type === "docx" || type === "doc") return <FileText size={20} className={`${cls} text-blue-500`} />;
  if (["jpg", "jpeg", "png"].includes(type ?? "")) return <Image size={20} className={`${cls} text-emerald-500`} />;
  if (["xlsx", "xls"].includes(type ?? "")) return <FileSpreadsheet size={20} className={`${cls} text-amber-500`} />;
  if (["txt", "vtt"].includes(type ?? "")) return <Captions size={20} className={`${cls} text-indigo-500`} />;
  if (["mp3", "wav", "m4a"].includes(type ?? "")) return <Music size={20} className={`${cls} text-purple-500`} />;
  return <FileText size={20} className={`${cls} text-gray-500`} />;
};

// ─── View button — opens the file in a new tab (renders inline, no download) ──

const ViewButton = ({ documentId, fileName }: { documentId: string; fileName: string }) => {
  const handleView = () => {
    openDocumentPreview(documentId, fileName || "Document");
  };

  return (
    <button
      type="button"
      onClick={handleView}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
      title={`View ${fileName}`}
      aria-label={`View ${fileName}`}
    >
      <FileSearch size={18} />
    </button>
  );
};

const LocalViewButton = ({ dataUrl, fileName }: { dataUrl: string; fileName: string }) => {
  const handleView = async () => {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      showToast("error", "Please allow pop-ups to preview this file");
      return;
    }
    try {
      const blob = await fetch(dataUrl).then((response) => response.blob());
      await openStagedBlobInWindow(blob, previewWindow, fileName);
    } catch {
      previewWindow.close();
      showToast("error", "Failed to open file");
    }
  };

  return (
    <button
      type="button"
      onClick={handleView}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
      title={`View ${fileName}`}
      aria-label={`View ${fileName}`}
    >
      <FileSearch size={18} />
    </button>
  );
};

const CallTranscriptModal = ({ call, onClose }: { call: CallRecord; onClose: () => void }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!call.summaryText) return;
    try {
      await navigator.clipboard.writeText(call.summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy transcript: ", err);
    }
  };

  const displayName = call.customerName ? `Call with ${call.customerName}` : call.transcriptFileName || "Call Record";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 relative max-h-[85vh] flex flex-col animate-in fade-in duration-200">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div className="border-b border-gray-100 pb-4 mb-4 shrink-0 pr-8">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-red-500 bg-red-50 px-2 py-0.5 rounded">
              Transcript
            </span>
            <span className="text-xs text-gray-500">
              {call.date || (call.callDate ? new Date(call.callDate).toLocaleDateString() : "")}
            </span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 truncate">
            {displayName}
          </h3>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {call.summaryText ? (
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed text-justify">
              {call.summaryText}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic py-6 text-center">
              No transcript text is available for this call.
            </p>
          )}
        </div>

        {/* Modal Footer */}
        <div className="mt-6 border-t border-gray-100 pt-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2" />
          <div className="flex items-center gap-3">
            {call.summaryText && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 px-3 py-2 rounded-md font-medium transition"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy Text"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface EditCallDetailsModalProps {
  call: CallRecord;
  onClose: () => void;
  onSave: (fields: { transcriptFileName: string; customerName: string }) => Promise<void>;
  isSaving: boolean;
}

const EditCallDetailsModal = ({ call, onClose, onSave, isSaving }: EditCallDetailsModalProps) => {
  const [fileName, setFileName] = useState(call.transcriptFileName || "Recording.mp3");
  const [customerName, setCustomerName] = useState(call.customerName || "Unknown Customer");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      transcriptFileName: fileName.trim(),
      customerName: customerName.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative flex flex-col animate-in fade-in duration-200"
      >
        {/* Close button */}
        <button
          type="button"
          disabled={isSaving}
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div className="border-b border-gray-100 pb-4 mb-4 pr-8">
          <h3 className="text-lg font-bold text-gray-900">
            Edit Call Details
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Update the metadata of this call recording.
          </p>
        </div>

        {/* Modal Body */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              File Name
            </label>
            <input
              type="text"
              required
              disabled={isSaving}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-2.5 focus:border-red-500 focus:outline-hidden bg-white text-gray-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Caller / Customer Name
            </label>
            <input
              type="text"
              required
              disabled={isSaving}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-3 py-2.5 focus:border-red-500 focus:outline-hidden bg-white text-gray-800"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="mt-6 border-t border-gray-100 pt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 px-4 py-2 rounded-md font-medium transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="text-xs bg-red-500 hover:bg-gray-800 text-white px-4 py-2 rounded-md font-medium transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSaving && <Loader2 size={12} className="animate-spin" />}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const Documents = () => {
  const { projectId, project: projectDetail } = useProjectRoute();
  const {
    user,
    isSuperAdmin,
    isSystemAdmin,
    isSalesManager,
    isEstimator,
    isHeadOfDivision,
  } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const callInputRef = useRef<HTMLInputElement | null>(null);

  // Detect project source
  const isApiProject = (!!projectId && isMongoId(projectId)) || !!projectDetail;

  // Call record states and mutations
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [editingCall, setEditingCall] = useState<CallRecord | null>(null);
  const [callToDelete, setCallToDelete] = useState<string | null>(null);

  const { data: project } = useProject(isApiProject ? projectId : undefined);
  const { data: callRecords, isLoading: callsLoading } = useProjectCalls(
    isApiProject ? projectId : undefined
  );
  const deleteCallMutation = useDeleteCallRecord(projectId);
  const uploadAudioMutation = useUploadCallRecordAudio(projectId);
  const createTextMutation = useCreateCallRecordText(projectId);
  const updateCallMutation = useUpdateCallRecord(projectId);

  // ── API path ──────────────────────────────────────────────────────────────
  const { data: apiDocs, isLoading: apiLoading } = useDocuments(
    isApiProject ? projectId : undefined
  );
  const uploadMutation = useUploadDocument(projectId ?? "");
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteDocument(projectId ?? "");
  const restoreMutation = useRestoreDocument(projectId ?? "");
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [documentsToMove, setDocumentsToMove] = useState<ApiDocument[]>([]);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);

  const syncDropboxMutation = useSyncDropbox();

  const handleSyncDropbox = async () => {
    if (!projectId) return;
    try {
      await syncDropboxMutation.mutateAsync(projectId);
      showToast("success", "Dropbox sync triggered successfully");
    } catch (err: any) {
      showToast("error", err?.message || "Failed to trigger Dropbox sync");
    }
  };

  // ── Static/local path ─────────────────────────────────────────────────────
  const [localFiles, setLocalFiles] = useState<any[]>([]);
  const staticProject = useMemo(
    () => (!isApiProject ? getProjectById(projectId || "") : null),
    [projectId, isApiProject]
  );

  const records: CallRecord[] = isApiProject
    ? (callRecords ?? [])
    : (callRecordings ?? []).map((c) => ({
      id: c.id,
      title: c.fileName.replace(".txt", ""),
      participants: ["Daniel Harper", "Estimator"],
      date: "May 14, 2026 03:30 PM",
      durationMinutes: 15,
      hasTranscript: true,
      customerName: c.fileName.includes("Daniel") ? "Daniel Harper" : c.fileName.includes("Emily") ? "Emily" : "Michael",
      summaryText: `This is a simulated transcript for "${c.fileName}".\n\nThe call discussed the design review, dimensions, specifications, and frame requirements for the GFS project layout. The team confirmed Series 2000 system with thermally broken support structure. Details on anodized finish and structural spans were also reviewed to prepare the final Bill of Materials.`,
      transcriptFileName: c.fileName,
    }));

  const handleCallUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    if (!isApiProject) {
      showToast("error", "Actions are disabled for static projects");
      return;
    }

    const defaultCustomerName =
      project?.customerName ||
      "Client";

    for (const file of Array.from(uploadedFiles)) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !['txt', 'mp3', 'wav', 'm4a'].includes(ext)) {
        showToast("error", `Unsupported file type for ${file.name}. Use .txt, .mp3, .wav, or .m4a`);
        continue;
      }

      try {
        if (ext === "txt") {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const text = event.target?.result as string;
            if (!text) {
              showToast("error", `Failed to read text file ${file.name}`);
              return;
            }
            await createTextMutation.mutateAsync({
              customerName: defaultCustomerName,
              summaryText: text,
              transcriptFileName: file.name,
            });
            showToast("success", `Transcript ${file.name} uploaded successfully`);
          };
          reader.readAsText(file);
        } else {
          await uploadAudioMutation.mutateAsync(file);
          showToast("success", `Audio ${file.name} uploaded and transcription queued`);
        }
      } catch (err) {
        showToast("error", `Failed to upload ${file.name}`);
        console.error(err);
      }
    }

    if (callInputRef.current) callInputRef.current.value = "";
  };

  const handleDeleteCall = (recordId: string) => {
    if (!isApiProject) {
      showToast("error", "Actions are disabled for static projects");
      return;
    }
    setCallToDelete(recordId);
  };

  const confirmDeleteCall = async () => {
    if (!callToDelete || deleteCallMutation.isPending) return;
    try {
      await deleteCallMutation.mutateAsync(callToDelete);
      showToast("success", "Call record deleted successfully");
    } catch (err) {
      showToast("error", "Failed to delete call record");
    } finally {
      setCallToDelete(null);
    }
  };

  const handleSaveCallDetails = async (fields: { transcriptFileName: string; customerName: string }) => {
    if (!editingCall) return;
    try {
      await updateCallMutation.mutateAsync({
        recordId: editingCall.id,
        fields,
      });
      showToast("success", "Call details updated successfully");
      setEditingCall(null);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || "Failed to update call details";
      showToast("error", errMsg);
      console.error(err);
    }
  };

  useEffect(() => {
    if (!staticProject) return;
    const documents = staticProject?.formData?.documents || [];
    const transcripts = staticProject?.integrations?.transcripts?.data || [];
    setLocalFiles([...documents, ...transcripts]);
  }, [staticProject]);

  // ─────────────────────────────────────────────────────────────────────────

  const handleBrowseClick = () => inputRef.current?.click();

  // ── Upload handler ────────────────────────────────────────────────────────

  const uploadFiles = async (uploadedFiles: File[]) => {
    if (uploadedFiles.length === 0) return;

    const cadExtensions = [".dwg", ".dxf", ".cad"];
    const hasCadFile = uploadedFiles.some((f) =>
      cadExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (hasCadFile) {
      showToast("error", "CAD and DWG files are not supported. Please upload PDF, DOCX, ZIP, or text files.");
      uploadedFiles = uploadedFiles.filter(
        (f) => !cadExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (uploadedFiles.length === 0) return;
    }

    if (isApiProject) {
      // Real API upload
      for (const file of uploadedFiles) {
        try {
          await uploadMutation.mutateAsync({
            projectId: projectId!,
            file,
            documentType: "GENERAL",
          });
        } catch {
          showToast("error", `Failed to upload ${file.name}`);
          return;
        }
      }
      showToast("success", "Files uploaded successfully");
      // Reset input
      e.target.value = "";
    } else {
      // Local storage path
      const newFiles = await Promise.all(
        uploadedFiles.map(
          (file) =>
            new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  id: crypto.randomUUID(),
                  projectId,
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  uploadedAt: new Date().toISOString(),
                  base64: reader.result,
                });
              };
              reader.readAsDataURL(file);
            })
        )
      );

      const updatedFiles = [...localFiles, ...newFiles];
      setLocalFiles(updatedFiles);

      if (staticProject) {
        const updatedProject = {
          ...staticProject,
          formData: {
            ...staticProject.formData,
            documents: updatedFiles.filter((f: any) => !f?.name?.endsWith(".txt")),
          },
          integrations: {
            ...staticProject.integrations,
            transcripts: {
              ...staticProject.integrations?.transcripts,
              data: updatedFiles.filter((f: any) => f?.name?.endsWith(".txt")),
            },
          },
        };
        localStorage.setItem(`project_${projectId}`, JSON.stringify(updatedProject));
      }
      showToast("success", "Files uploaded successfully");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await uploadFiles(Array.from(e.target.files ?? []));
    // Allow selecting the same file again after a completed upload.
    e.target.value = "";
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    await uploadFiles(Array.from(e.dataTransfer.files));
  };

  // ── Delete handler ────────────────────────────────────────────────────────

  const handleRestore = async (fileId: string) => {
    if (!isApiProject) return;

    try {
      await restoreMutation.mutateAsync({ documentId: fileId });
      showToast("success", "File restored");
    } catch (err: any) {
      showToast("error", err?.response?.data?.error?.message || "Failed to restore file");
    }
  };

  const handleDelete = async (fileId: string) => {
    if (isApiProject) {
      try {
        await deleteMutation.mutateAsync({ documentId: fileId });
        toast.success("File removed", {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () => {
              void handleRestore(fileId);
            },
          },
        });
      } catch {
        showToast("error", "Failed to delete file");
      }
    } else {
      const updatedFiles = localFiles.filter((f) => f.id !== fileId);
      setLocalFiles(updatedFiles);
      if (staticProject) {
        const updatedProject = {
          ...staticProject,
          formData: {
            ...staticProject.formData,
            documents: updatedFiles.filter((f: any) => !f?.name?.endsWith(".txt")),
          },
          integrations: {
            ...staticProject.integrations,
            transcripts: {
              ...staticProject.integrations?.transcripts,
              data: updatedFiles.filter((f: any) => f?.name?.endsWith(".txt")),
            },
          },
        };
        localStorage.setItem(`project_${projectId}`, JSON.stringify(updatedProject));
      }
      showToast("success", "File removed");
    }
  };

  // ── Normalise rows for the table ──────────────────────────────────────────
  // API docs and local files both expose: id, name, size, createdAt/uploadedAt

  const rows: Array<{
    id: string;
    name: string;
    size: number;
    date: string;
    base64?: string;
    isApi: boolean;
    doc?: ApiDocument;
    source: { label: string; className: string };
  }> = isApiProject
      ? getVisibleProjectDocuments(apiDocs ?? []).map((d) => ({
        id: d.id,
        name: d.originalName || d.name || "",
        size: d.byteSize || 0,
        date: d.uploadedAt || d.createdAt || "",
        isApi: true,
        doc: d,
        source: getDocumentSource(d),
      }))
      : localFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        date: f.uploadedAt,
        base64: f.base64,
        isApi: false,
        source: getDocumentSource(null),
      }));

  const isLoading = isApiProject && apiLoading;
  const isUploading = uploadMutation.isPending;
  const isElevatedDeleteRole = isSuperAdmin || isSystemAdmin || isSalesManager || isHeadOfDivision;
  const isAssignedEstimator = Boolean(
    isEstimator &&
    user &&
    project?.assignedEstimators?.some(
      (estimator) =>
        estimator.id === user.id ||
        estimator.email?.trim().toLowerCase() === user.email.trim().toLowerCase(),
    ),
  );

  const canDeleteDocument = () => {
    if (!isApiProject || isElevatedDeleteRole) return true;
    return isAssignedEstimator;
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between border-l-3 border-red-500 px-4">
        <div>
          <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
            Upload Project Documents
          </div>
        </div>
        {isApiProject && (
          <button
            type="button"
            onClick={handleSyncDropbox}
            disabled={syncDropboxMutation.isPending}
            className="text-xs bg-red-500 text-white px-3 py-2 rounded-md hover:bg-gray-800 transition font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {syncDropboxMutation.isPending ? (
              <Loader2 size={14} className="animate-spin text-white" />
            ) : (
              <RefreshCw size={14} className="text-white" />
            )}
            Sync Dropbox
          </button>
        )}
      </div>

      {/* Drop Zone */}
      <section className="bg-white rounded-lg border border-gray-200 p-4">
        <div
          onClick={handleBrowseClick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          className="
            border-2 border-dashed
            border-red-500
            rounded-lg
            flex flex-col
            items-center
            justify-center
            py-10 px-6
            text-center
            hover:border-red-700
            transition
            cursor-pointer
          "
        >
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            {isUploading
              ? <Loader2 size={22} className="text-red-500 animate-spin" />
              : <UploadCloud size={22} className="text-red-500" />
            }
          </div>
          <p className="text-sm font-medium text-red-500">
            {isUploading ? "Uploading…" : "Click to upload or drag and drop"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            PDF, DOCX, ZIP, TXT/VTT, MP3/WAV/M4A
          </p>
          <button
            type="button"
            disabled={isUploading}
            className="
              mt-4 px-4 py-2
              bg-red-500 text-white
              text-sm font-medium
              rounded-md
              hover:bg-gray-800
              transition
              disabled:opacity-50
            "
          >
            Browse Files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.doc,.zip,.txt,.vtt,.mp3,.wav,.m4a,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
          />
        </div>
      </section>

      {/* Files Table */}
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-md font-semibold text-red-500">Uploaded Files</h2>
          <span className="text-xs text-gray-400">
            {rows.length} total file{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {selectedDocIds.size > 0 && (
          <div className="flex items-center justify-between p-3.5 bg-red-50/60 border border-red-200 rounded-xl mb-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-2xs">
                {selectedDocIds.size}
              </span>
              <span className="text-xs font-bold text-gray-900">
                {selectedDocIds.size} document{selectedDocIds.size === 1 ? '' : 's'} selected for project transfer
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedDocIds(new Set())}
                className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg transition cursor-pointer shadow-2xs"
              >
                Clear Selection
              </button>
              <button
                type="button"
                onClick={() => {
                  const docs = rows
                    .filter((r) => selectedDocIds.has(r.id))
                    .map((r) => r.doc || ({
                      id: r.id,
                      originalName: r.name,
                      projectId: projectId || "",
                      documentType: "GENERAL",
                    } as ApiDocument));
                  setDocumentsToMove(docs);
                  setIsMoveModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition cursor-pointer"
              >
                <RefreshCw size={14} />
                Move to Project ({selectedDocIds.size})
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading documents…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="w-10 py-3 pl-2 text-center">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedDocIds.size === rows.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDocIds(new Set(rows.map((r) => r.id)));
                        } else {
                          setSelectedDocIds(new Set());
                        }
                      }}
                      className="h-4 w-4 rounded-sm border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-3 font-semibold">File Name</th>
                  <th className="text-left py-3 font-semibold">Timestamp</th>
                  <th className="text-left py-3 font-semibold">Size</th>
                  <th className="text-left py-3 font-semibold">Source</th>
                  <th className="text-left py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-gray-400 italic">
                      No project documents available.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const fileType = getFileType(row.name);
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-100 last:border-0 transition ${selectedDocIds.has(row.id) ? "bg-red-50/40 hover:bg-red-50/60 font-medium" : "hover:bg-gray-50/60"}`}
                    >
                      <td className="py-3 pl-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(row.id)}
                          onChange={(e) => {
                            const next = new Set(selectedDocIds);
                            if (e.target.checked) {
                              next.add(row.id);
                            } else {
                              next.delete(row.id);
                            }
                            setSelectedDocIds(next);
                          }}
                          className="h-4 w-4 rounded-sm border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <FileTypeIcon type={fileType} />
                          <span
                            className="text-gray-800 truncate max-w-[180px] sm:max-w-[300px] md:max-w-[450px] inline-block align-middle"
                            title={row.name}
                          >
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-gray-600">
                        {new Date(row.date).toLocaleString()}
                      </td>
                      <td className="py-3 text-gray-600">
                        {formatBytes(row.size)}
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ${row.source.className}`}
                        >
                          {row.source.label}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          {/* View */}
                          {row.isApi ? (
                            <ViewButton documentId={row.id} fileName={row.name} />
                          ) : (
                            <LocalViewButton dataUrl={row.base64!} fileName={row.name} />
                          )}

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id)}
                            disabled={deleteMutation.isPending || !canDeleteDocument()}
                            title={
                              canDeleteDocument()
                                ? "Delete file"
                                : "Only the assigned Estimator or an elevated role can delete files"
                            }
                            aria-label={
                              canDeleteDocument()
                                ? `Delete ${row.name}`
                                : `Delete unavailable for ${row.name}`
                            }
                            className="text-gray-500 hover:text-red-500 transition disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 size={18} />
                          </button>

                          {/* Move to another project */}
                          <button
                            type="button"
                            onClick={() => {
                              const docToMove = row.doc || ({
                                id: row.id,
                                originalName: row.name,
                                projectId: projectId || "",
                                documentType: "GENERAL",
                              } as ApiDocument);
                              setDocumentsToMove([docToMove]);
                              setIsMoveModalOpen(true);
                            }}
                            className="text-gray-500 hover:text-red-600 transition"
                            title="Move to Project"
                          >
                            <RefreshCw size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MoveDocumentModal
        isOpen={isMoveModalOpen}
        onClose={() => {
          setIsMoveModalOpen(false);
          setDocumentsToMove([]);
        }}
        documents={documentsToMove}
        currentProjectId={projectId}
        onMovedSuccess={() => {
          setSelectedDocIds(new Set());
          queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY(projectId ?? "") });
        }}
      />

      {/* Call Records Section */}
      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-md font-semibold text-red-500">Call Records</h2>
          <div className="flex items-center gap-3">
            {(uploadAudioMutation.isPending || createTextMutation.isPending) && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin text-red-500" />
                Transcribing...
              </div>
            )}
            {isApiProject && (
              <button
                type="button"
                onClick={() => callInputRef.current?.click()}
                disabled={uploadAudioMutation.isPending || createTextMutation.isPending}
                className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-md hover:bg-gray-800 transition font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus size={14} />
                Upload Recording
              </button>
            )}
          </div>
          <input
            ref={callInputRef}
            type="file"
            multiple
            accept=".txt,.mp3,.wav,.m4a"
            hidden
            onChange={handleCallUpload}
            disabled={uploadAudioMutation.isPending || createTextMutation.isPending}
          />
        </div>

        {callsLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading call records…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="text-left py-3 font-semibold">Caller</th>
                  <th className="text-left py-3 font-semibold">Transcript File</th>
                  <th className="text-left py-3 font-semibold">Call Date</th>
                  <th className="text-left py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-sm text-gray-400 italic">
                      No call records available.
                    </td>
                  </tr>
                )}
                {records.map((call) => {
                  const callerName = call.customerName || "Unknown Customer";
                  const fileName = call.transcriptFileName || "Recording.mp3";
                  const dateStr = call.date || (call.callDate ? new Date(call.callDate).toLocaleDateString() : "");

                  return (
                    <tr
                      key={call.id}
                      className="border-b border-gray-100 last:border-0"
                    >
                      <td className="py-3 font-medium text-gray-800">
                        <span className="truncate max-w-[120px] lg:max-w-none block" title={callerName}>
                          {callerName}
                        </span>
                      </td>
                      <td className="py-3 text-gray-600">
                        <div className="flex items-center gap-2">
                          <FileTypeIcon type={getFileType(fileName)} />
                          <span
                            className="truncate max-w-[150px] lg:max-w-none block"
                            title={fileName}
                          >
                            {fileName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-gray-600">
                        {dateStr}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          {/* View Transcript */}
                          <button
                            type="button"
                            onClick={() => setActiveCall(call)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                            title={`View transcript for ${callerName}`}
                            aria-label={`View transcript for ${callerName}`}
                          >
                            <Captions size={18} />
                          </button>

                          {/* Edit Details */}
                          <button
                            type="button"
                            onClick={() => setEditingCall(call)}
                            className="text-gray-500 hover:text-gray-800 transition disabled:opacity-40"
                            title="Edit details"
                          >
                            <Pencil size={16} />
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => handleDeleteCall(call.id)}
                            disabled={deleteCallMutation.isPending}
                            className="text-gray-500 hover:text-red-500 transition disabled:opacity-40"
                            title="Delete record"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activeCall && (
        <CallTranscriptModal
          call={activeCall}
          onClose={() => setActiveCall(null)}
        />
      )}

      {editingCall && (
        <EditCallDetailsModal
          call={editingCall}
          isSaving={updateCallMutation.isPending}
          onClose={() => setEditingCall(null)}
          onSave={handleSaveCallDetails}
        />
      )}

      <ConfirmDialog
        open={Boolean(callToDelete)}
        title="Delete call record?"
        message="This call record and its transcript will be removed from the project."
        confirmLabel="Delete record"
        isConfirming={deleteCallMutation.isPending}
        onCancel={() => setCallToDelete(null)}
        onConfirm={() => void confirmDeleteCall()}
      />
    </div>
  );
};

export default Documents;
