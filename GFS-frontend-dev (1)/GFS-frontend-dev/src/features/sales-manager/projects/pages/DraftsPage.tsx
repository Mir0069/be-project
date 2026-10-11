import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Eye, FileText, Folder, Handshake, Link2, Loader2, Mail, MapPin, Maximize2, Pencil, Users } from "lucide-react";
import {
  useApproveDraft,
  useDrafts,
  useLinkDraftToProject,
  usePreviewDraftAttachment,
  useRejectDraft,
  useUpdateDraftProjectName,
  type DraftProject,
} from "../../query/draftsQuery";
import { showToast } from "@/components/ui/toast";
import RejectDraftModal from "../components/RejectDraftModal";
import AssignEstimatorModal from "../components/AssignEstimatorModal";
import MultiVendorModal from "../components/MultiVendorModal";
import EmailBody from "../components/EmailBody";
import FullEmailModal from "../components/FullEmailModal";
import PartnerAssignmentModal from "@/features/partners/components/PartnerAssignmentModal";
import {
  getPartnerForDraft,
  promoteDemoPartnerAssignment,
  usePartnerDemoStore,
} from "@/features/partners/partnerDemoStore";
import { openStagedBlobInWindow } from "@/shared/lib/filePreview";
import {
  useMarkAllDraftAlertsRead,
  useUnreadDraftAlertCount,
} from "@/features/notifications/query/notificationsQuery";

const DraftsPage = () => {
  const { data: drafts, isLoading } = useDrafts();
  const approveMutation = useApproveDraft();
  const rejectMutation = useRejectDraft();
  const linkMutation = useLinkDraftToProject();
  const updateNameMutation = useUpdateDraftProjectName();
  const previewAttachmentMutation = usePreviewDraftAttachment();
  const { mutate: markDraftAlertsRead } = useMarkAllDraftAlertsRead();
  const { data: unreadDraftAlertCount = 0 } = useUnreadDraftAlertCount();
  const partnerState = usePartnerDemoStore();

  // The badge announces newly arrived drafts. Opening the Drafts workspace is
  // the acknowledgement, so clear only those alert notifications—not the
  // draft records themselves.
  useEffect(() => {
    if (unreadDraftAlertCount > 0) markDraftAlertsRead();
  }, [markDraftAlertsRead, unreadDraftAlertCount]);

  // Track which row is expanded
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  
  // Modal state
  const [fullEmailDraft, setFullEmailDraft] = useState<DraftProject | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [draftToReject, setDraftToReject] = useState<string | null>(null);
  const [draftToLink, setDraftToLink] = useState<DraftProject | null>(null);
  const [draftToPartner, setDraftToPartner] = useState<DraftProject | null>(null);
  const [assignmentProject, setAssignmentProject] = useState<{
    id: string;
    ids: string[];
    name: string;
  } | null>(null);

  // Inline edit state for project name
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const handleApprove = (emailId: string, projectName: string) => {
    // Note: We will add the custom "signal" payload to this backend call later as discussed!
    approveMutation.mutate(emailId, {
      onSuccess: (result) => {
        setExpandedRow(null);
        if (result.projectId) {
          // The approval API returns the created project ID, so assignment can
          // continue without displaying or asking the user for an internal ID.
          // The modal owns the success message to avoid stacked toast cards.
          // Preserve the locally demonstrated partner relationship when the
          // draft becomes a real backend project.
          promoteDemoPartnerAssignment(emailId, result.projectId);
          setAssignmentProject({
            id: result.projectId,
            ids: result.allProjectIds?.length ? result.allProjectIds : [result.projectId],
            name: projectName,
          });
        } else {
          showToast(
            "success",
            "Project created, but estimator assignment is not ready yet. Assign it later from the Project List.",
          );
        }
      },
      onError: (err: any) => showToast("error", err?.message || "Failed to approve project"),
    });
  };

  const handleOpenReject = (emailId: string) => {
    setDraftToReject(emailId);
    setRejectModalOpen(true);
  };

  const handleOpenMultiVendor = (draft: DraftProject) => {
    setDraftToLink(draft);
  };

  const handleStartEditName = (e: React.MouseEvent, draftId: string, currentName: string) => {
    e.stopPropagation();
    setEditingDraftId(draftId);
    setEditedName(currentName);
  };

  const handleSaveName = (emailId: string) => {
    const trimmed = editedName.trim();
    if (!trimmed) {
      showToast("error", "Project name cannot be empty");
      setEditingDraftId(null);
      return;
    }
    updateNameMutation.mutate(
      { emailId, projectName: trimmed },
      {
        onSuccess: () => {
          showToast("success", "Project name updated");
          setEditingDraftId(null);
        },
        onError: (err: any) => {
          showToast("error", err?.message || "Failed to update project name");
          setEditingDraftId(null);
        },
      }
    );
  };

  const handleCancelEditName = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingDraftId(null);
    setEditedName("");
  };

  const handleConfirmReject = (reason: string, projectId?: string) => {
    if (!draftToReject) return;

    if (reason === "existing" && projectId) {
      linkMutation.mutate({ emailId: draftToReject, projectId }, {
        onSuccess: () => {
          showToast("success", "Email linked to the selected project.");
          setRejectModalOpen(false);
          setDraftToReject(null);
          setExpandedRow(null);
        },
        onError: (err: any) => showToast("error", err?.message || "Failed to link email to project"),
      });
      return;
    }

    rejectMutation.mutate({ emailId: draftToReject, reason: "IRRELEVANT_SPAM" }, {
      onSuccess: () => {
        showToast("success", "Draft rejected as irrelevant or spam.");
        setRejectModalOpen(false);
        setDraftToReject(null);
        setExpandedRow(null);
      },
      onError: (err: any) => showToast("error", err?.message || "Failed to reject draft"),
    });
  };

  const handleConfirmMultiVendor = (projectId: string, projectName: string) => {
    if (!draftToLink || !projectId) return;

    linkMutation.mutate(
      { emailId: draftToLink.id, projectId },
      {
        onSuccess: () => {
          showToast("success", `Vendor email linked to ${projectName}.`);
          setDraftToLink(null);
          setExpandedRow(null);
        },
        onError: (err: any) => {
          showToast("error", err?.message || "Failed to link vendor email to project.");
        },
      },
    );
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    });
  };

  return (
    <div className="space-y-6">
      {/* Header matching your theme */}
      <div className="border-l-3 border-red-500 px-4">
        <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">Draft Projects</div>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 px-5 py-2 mt-8">
        {isLoading ? (
          <div className="py-14 text-center text-gray-500 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin text-red-500" /> Loading drafts...
          </div>
        ) : !drafts || drafts.length === 0 ? (
          <div className="py-14 text-center text-red-500 font-semibold">
            No Drafts Available
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-red-500 border-b border-gray-200">
                  <th className="text-left py-3 font-semibold w-[25%] px-2">Project Name</th>
                  <th className="text-left py-3 font-semibold w-[20%]">From</th>
                  <th className="text-left py-3 font-semibold w-[35%]">Email Subject</th>
                  <th className="text-left py-3 font-semibold w-[15%]">Received</th>
                  <th className="text-center py-3 font-semibold w-[5%]"></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const isExpanded = expandedRow === draft.id;
                  const projectName = draft.proposed?.projectName || "Unnamed Project";
                  const isEditing = editingDraftId === draft.id;
                  const assignedPartner = getPartnerForDraft(partnerState, draft.id);

                  return (
                    <React.Fragment key={draft.id}>
                      {/* Main Condensed Row */}
                      <tr 
                        onClick={() => toggleRow(draft.id)}
                        className={`border-b border-gray-100 transition cursor-pointer hover:bg-gray-50 ${isExpanded ? "bg-gray-50 border-b-0" : ""}`}
                      >
                        <td className="py-4 px-2">
                          <div className="flex items-center gap-2">
                            <Folder size={16} className="text-gray-400 shrink-0" />
                            <div className="flex flex-col min-w-0">
                              {isEditing ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleSaveName(draft.id);
                                      if (e.key === "Escape") handleCancelEditName(e as any);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    autoFocus
                                    className="flex-1 min-w-0 border border-gray-300 rounded-md px-2 py-0.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleSaveName(draft.id); }}
                                    disabled={updateNameMutation.isPending}
                                    className="text-xs px-1.5 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 shrink-0"
                                  >
                                    {updateNameMutation.isPending ? "..." : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelEditName}
                                    className="text-xs px-1.5 py-0.5 border border-gray-300 rounded text-gray-600 hover:border-red-500 hover:text-red-500 shrink-0"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 group">
                                  <span className="font-medium text-gray-800 truncate">{projectName}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleStartEditName(e, draft.id, projectName)}
                                    className="flex items-center gap-1 text-xs px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:border-red-500 hover:text-red-500 transition shrink-0"
                                    title="Edit project name"
                                  >
                                    <Pencil size={12} /> Edit
                                  </button>
                                </div>
                              )}
                              {draft.address && (
                                <span className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                                  <MapPin size={12} className="shrink-0" />
                                  {draft.address}
                                </span>
                              )}
                              {assignedPartner ? (
                                <span className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
                                  <Handshake size={12} className="shrink-0" /> Partner: {assignedPartner.name}
                                </span>
                              ) : null}
                              {draft.proposed?.isCompetitiveBid && (draft.proposed.allBidders?.length ?? 0) > 1 ? (
                                <span className="mt-1 flex items-center gap-1 text-xs font-medium text-blue-700">
                                  <Users size={12} className="shrink-0" /> {draft.proposed.allBidders!.length} bidders detected
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 text-gray-700 truncate max-w-[150px]" title={draft.fromAddress}>
                          {draft.fromName || draft.fromAddress}
                        </td>
                        <td className="py-4 text-gray-700 truncate max-w-[250px]" title={draft.subject}>
                          {draft.subject}
                        </td>
                        <td className="py-4 text-gray-600">
                          {formatDate(draft.receivedDateTime)}
                        </td>
                        <td className="py-4 text-center text-gray-400">
                          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </td>
                      </tr>

                      {/* Expanded Section */}
                      {isExpanded && (
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <td colSpan={5} className="p-0">
                            <div className="px-8 pb-6 pt-2 animate-in slide-in-from-top-2 duration-200">
                              
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Email Content */}
                                <div className="bg-white border border-gray-200 rounded-md p-4 shadow-sm">
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                      <Mail size={14} /> Email Content
                                    </h4>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setFullEmailDraft(draft);
                                      }}
                                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:border-red-300 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                                      title="Open the complete email"
                                    >
                                      <Maximize2 size={13} aria-hidden="true" />
                                      Open full email
                                    </button>
                                  </div>
                                  <div className="max-h-[260px] overflow-y-auto pr-2">
                                    <EmailBody
                                      html={draft.bodyHtml}
                                      text={draft.bodyText || draft.proposed?.summary}
                                    />
                                  </div>
                                </div>

                                {/* Attachments */}
                                <div className="bg-white border border-gray-200 rounded-md p-4 shadow-sm">
                                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <FileText size={14} /> Attachments
                                  </h4>
                                  {(!draft.attachments || draft.attachments.length === 0) ? (
                                    <p className="text-sm text-gray-400 italic">No attachments found.</p>
                                  ) : (
                                    <ul className="space-y-2">
                                      {draft.attachments.map((att: any, idx: number) => (
                                        <li key={idx} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-md border border-gray-100">
                                          <div className="flex items-center gap-2 truncate">
                                            <FileText size={16} className="text-red-500 shrink-0" />
                                            <span className="text-sm text-gray-700 truncate">{att.name || att.originalName}</span>
                                          </div>
                                          <button
                                            type="button"
                                            className="text-gray-400 hover:text-red-500 transition px-2"
                                            title="Preview document"
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              if (!att.storageKey) {
                                                showToast("error", "This attachment has no stored file");
                                                return;
                                              }
                                              const fileName = att.name || att.originalName || "Attachment";
                                              // Open the tab synchronously inside the click, otherwise the
                                              // browser treats it as a pop-up and blocks it.
                                              const previewWindow = window.open("", "_blank");
                                              if (!previewWindow) {
                                                showToast("error", "Please allow pop-ups to preview this file");
                                                return;
                                              }
                                              try {
                                                const blob = await previewAttachmentMutation.mutateAsync({
                                                  emailId: draft.id,
                                                  storageKey: att.storageKey,
                                                });
                                                await openStagedBlobInWindow(blob, previewWindow, fileName);
                                              } catch {
                                                previewWindow.close();
                                                showToast("error", "Failed to open file");
                                              }
                                            }}
                                          >
                                            <Eye size={16} />
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>

                              {/* AI Reasoning */}
                              <div className="bg-white border border-gray-200 rounded-md p-4 shadow-sm mt-4">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                  <Eye size={14} /> Classifier Reasoning
                                </h4>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                  {draft.proposed?.reasoning || "No classifier reasoning available."}
                                </p>
                              </div>

                              {draft.proposed?.isCompetitiveBid && (draft.proposed.allBidders?.length ?? 0) > 1 ? (
                                <div className="mt-4 rounded-md border border-blue-200 bg-blue-50/60 p-4">
                                  <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-800">
                                    <Users size={14} /> Competitive bid group
                                  </h4>
                                  <p className="mt-2 text-sm text-gray-700">
                                    Approval creates one linked project for each bidder. Documents and AI processing remain on the primary bid.
                                  </p>
                                  <ul className="mt-3 divide-y divide-blue-100 rounded-md border border-blue-100 bg-white">
                                    {draft.proposed.allBidders!.map((bidder, index) => (
                                      <li key={`${bidder.email ?? "bidder"}-${index}`} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                                        <span className="min-w-0 truncate text-gray-800">
                                          {bidder.company || "Unnamed bidder"}
                                          {bidder.email ? <span className="ml-2 text-gray-500">{bidder.email}</span> : null}
                                        </span>
                                        {bidder.isPrimary || bidder.email === draft.proposed?.primaryBidderEmail ? (
                                          <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Primary</span>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {/* Action Buttons */}
                              <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-4">
                                <button
                                  type="button"
                                  onClick={() => handleOpenReject(draft.id)}
                                  className="px-5 py-2 text-sm border border-gray-300 bg-white rounded-md text-gray-700 hover:border-red-500 hover:text-red-500 transition font-medium"
                                >
                                  Reject Draft
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenMultiVendor(draft)}
                                  className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition hover:border-red-500 hover:text-red-500"
                                >
                                  <Link2 size={14} /> Multi-Vendor Project
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDraftToPartner(draft)}
                                  className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition hover:border-red-500 hover:text-red-500"
                                >
                                  <Handshake size={14} /> {assignedPartner ? "Change Partner" : "Partner Project"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleApprove(draft.id, projectName)}
                                  disabled={approveMutation.isPending}
                                  className="px-6 py-2 bg-red-500 text-white text-sm font-medium rounded-md hover:bg-red-600 transition flex items-center gap-2 disabled:opacity-50"
                                >
                                  {approveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                                  Approve & Create Project
                                </button>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Mount Modal */}
      {fullEmailDraft && (
        <FullEmailModal
          draft={fullEmailDraft}
          onClose={() => setFullEmailDraft(null)}
        />
      )}
      <RejectDraftModal 
        open={rejectModalOpen} 
        onClose={() => {
          setRejectModalOpen(false);
          setDraftToReject(null);
        }}
        onConfirm={handleConfirmReject}
        isSubmitting={rejectMutation.isPending || linkMutation.isPending}
      />
      <MultiVendorModal
        open={Boolean(draftToLink)}
        draft={draftToLink}
        isLinking={linkMutation.isPending}
        onClose={() => setDraftToLink(null)}
        onConfirm={handleConfirmMultiVendor}
      />
      <PartnerAssignmentModal
        key={draftToPartner?.id ?? "closed-partner-assignment"}
        open={Boolean(draftToPartner)}
        draftId={draftToPartner?.id ?? null}
        projectName={draftToPartner?.proposed?.projectName || "this project"}
        onClose={() => setDraftToPartner(null)}
        onAssigned={(partnerName) => {
          showToast("success", `${partnerName} assigned to this draft.`);
          setDraftToPartner(null);
        }}
      />
      {assignmentProject ? (
        <AssignEstimatorModal
          open
          projectId={assignmentProject.id}
          projectIds={assignmentProject.ids}
          projectName={assignmentProject.name}
          onClose={() => setAssignmentProject(null)}
        />
      ) : null}
    </div>
  );
};

export default DraftsPage;
