import { useState, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle, XCircle, FileText, Mail, MessageSquare, HardDrive, User, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import type { PendingApproval } from "@/services/proposals";
import {
  approvePendingChange,
  rejectPendingChange,
} from "@/services/proposals";
import ExpandableText from "@/components/ui/ExpandableText";
import { showToast } from "@/components/ui/toast";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { useDocuments } from "@/features/projects/query/documentsQuery";
import { useOutlookEmails } from "@/features/projects/query/outlookQuery";
import EmailBody from "@/features/sales-manager/projects/components/EmailBody";
import {
  findApprovalEmail,
  resolveApprovalDocuments,
} from "@/features/estimator/workspace/utils/approvalDisplay";
import { openDocumentPreview } from "@/shared/lib/filePreview";
import {
  synchronizeProjectWorkflow,
  usePendingApprovals,
} from "@/features/projects/query/proposalsQuery";
import { useZohoNotes } from "@/features/zoho/query/zohoQuery";
import { findApprovalNote, getZohoApprovalHeading } from "@/features/zoho/utils/approvalNote";
import { useQueryClient } from "@tanstack/react-query";

interface PendingApprovalsPanelProps {
  projectId: string;
}

const getSourceIcon = (source: string) => {
  switch (source) {
    case "EMAIL":
      return <Mail size={16} className="text-blue-500" />;
    case "TEAMS":
      return <MessageSquare size={16} className="text-purple-500" />;
    case "ZOHO":
      return <User size={16} className="text-green-500" />;
    case "DROPBOX":
      return <HardDrive size={16} className="text-indigo-500" />;
    case "MANUAL":
      return <User size={16} className="text-gray-500" />;
    default:
      return <FileText size={16} className="text-gray-500" />;
  }
};

const getSourceLabel = (source: string) => {
  switch (source) {
    case "EMAIL":
      return "Email";
    case "TEAMS":
      return "Teams";
    case "ZOHO":
      return "Zoho";
    case "DROPBOX":
      return "Dropbox";
    case "MANUAL":
      return "Manual";
    default:
      return source;
  }
};

// Sources whose approval is raised by change detection alone, with no AI
// judgement behind it. The backend still stores a default confidence for them,
// so showing it would put a number on a decision no model made.
const SOURCES_WITHOUT_AI = new Set(["ZOHO", "MANUAL"]);

// A Zoho approval shows the note or description exactly as Zoho sent it; no AI reasoned about it.
const getApprovalTextHeading = (approval: Pick<PendingApproval, "source" | "reasoning">) =>
  approval.source === "ZOHO" ? getZohoApprovalHeading(approval.reasoning) : "Reasoning";

const hasAiConfidence = (approval: { source: string; confidence?: number | null }) =>
  !SOURCES_WITHOUT_AI.has(approval.source) &&
  approval.confidence !== null &&
  approval.confidence !== undefined;

type ApprovalReasoningField = {
  label: string;
  value: string;
};

const APPROVAL_REASONING_LABELS = [
  "AI Analysis",
  "Customer Info",
  "Location",
  "Scope",
  "Request Summary",
  "Attachments",
  "Sender Name",
  "Sender Email",
  "Company Name",
  "Confidence",
];

const HIDDEN_APPROVAL_REASONING_LABELS = new Set(["ai analysis", "confidence"]);

// AI email reasoning is sometimes returned as one compact, labelled sentence.
// Keep the backend text intact, but split known labels for a more readable review.
const parseApprovalReasoning = (reasoning?: string | null) => {
  const source = reasoning?.replace(/\s+/g, " ").trim() ?? "";
  if (!source) return { fields: [] as ApprovalReasoningField[], residual: "" };

  const labelPattern = new RegExp(
    `(${APPROVAL_REASONING_LABELS.join("|")})\\s*:`,
    "gi",
  );
  const matches = Array.from(source.matchAll(labelPattern));
  if (matches.length === 0) {
    return { fields: [] as ApprovalReasoningField[], residual: source };
  }

  const fields = matches
    .map((match, index) => {
      const label = match[1] ?? "";
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? source.length;
      const value = source
        .slice(start, end)
        .replace(/^\s*[-|•]\s*/, "")
        .replace(/\s*[-|•]\s*$/, "")
        .trim();

      return {
        label: label.replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value,
      };
    })
    .filter(
      (field) =>
        field.value &&
        !HIDDEN_APPROVAL_REASONING_LABELS.has(field.label.toLowerCase()),
    );

  const prefix = source
    .slice(0, matches[0].index ?? 0)
    .replace(/^\s*[-|•]\s*/, "")
    .trim();

  // Keep unlabelled reasoning visible, but hide labelled fields that are not
  // part of the Pending Approvals summary. This removes legacy "AI Analysis:"
  // placeholders without changing the stored approval reasoning.
  return { fields, residual: matches.length > 0 ? prefix : source };
};

export const PendingApprovalsPanel = ({ projectId }: PendingApprovalsPanelProps) => {
  const { project } = useProjectRoute();
  const queryClient = useQueryClient();
  const wasAnalysisRunning = useRef(false);
  const projectApiId = project?.id ?? projectId;
  const { data: documents = [] } = useDocuments(projectApiId);
  const { data: emails = [] } = useOutlookEmails(projectApiId || undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const pendingApprovalsQuery = usePendingApprovals(projectId);
  const approvals: PendingApproval[] = pendingApprovalsQuery.data?.approvals ?? [];
  const pendingCount = pendingApprovalsQuery.data?.count ?? 0;
  const isLoading = pendingApprovalsQuery.isFetching;
  // Zoho approvals quote only the start of a note; the lead's notes give the full text.
  const hasZohoApproval = approvals.some((approval) => approval.source === "ZOHO");
  const { data: zohoNotes } = useZohoNotes(hasZohoApproval ? project?.zohoLeadId : null);

  const isAnalysisRunning = project?.analysisStatus === "PROCESSING";

  useEffect(() => {
    if (isAnalysisRunning) {
      wasAnalysisRunning.current = true;
      return;
    }

    if (!wasAnalysisRunning.current || !project) return;

    wasAnalysisRunning.current = false;
    queryClient.invalidateQueries({ queryKey: ["proposals", project.id] });
    queryClient.invalidateQueries({ queryKey: ["project-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    showToast("success", "Project analysis completed. Updated data is ready for review.");
  }, [isAnalysisRunning, project, queryClient]);

  useEffect(() => {
    if (pendingApprovalsQuery.isError) {
      console.error("Failed to fetch pending approvals:", pendingApprovalsQuery.error);
      showToast("error", "Failed to load pending approvals");
    }
  }, [pendingApprovalsQuery.error, pendingApprovalsQuery.isError]);

  const handleApprove = async (approvalId: string) => {
    setProcessingId(approvalId);
    try {
      await approvePendingChange(approvalId);
      showToast("success", "Change approved and re-processing triggered");
      await synchronizeProjectWorkflow(queryClient, projectApiId);
    } catch (error) {
      console.error("Failed to approve change:", error);
      showToast("error", "Failed to approve change");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    const reason = prompt("Please provide a reason for rejecting this change (optional):");
    setProcessingId(approvalId);
    try {
      await rejectPendingChange(approvalId, reason || undefined);
      showToast("success", "Change rejected");
      await synchronizeProjectWorkflow(queryClient, projectApiId);
    } catch (error) {
      console.error("Failed to reject change:", error);
      showToast("error", "Failed to reject change");
    } finally {
      setProcessingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Keep the approvals card out of the way while analysis is processing. It
  // becomes visible again when the project leaves PROCESSING so new approvals
  // can be reviewed after the run completes.
  if (isAnalysisRunning || approvals.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600">
            <AlertTriangle size={17} />
          </span>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">Pending Approvals</h3>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                {pendingCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void pendingApprovalsQuery.refetch()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : undefined} />
            {isLoading ? "Loading" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {approvals.map((approval) => {
          const approvalEmail =
            approval.source === "EMAIL" ? findApprovalEmail(approval, emails) : undefined;
          const approvalDocuments = resolveApprovalDocuments(approval, documents);

          return (
          <div
            key={approval._id}
            className="rounded-md border border-gray-200 bg-white"
          >
            <div className="flex items-start justify-between gap-3 p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-50">
                  {getSourceIcon(approval.source)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-gray-900">
                      {getSourceLabel(approval.source)}
                    </span>
                    <span className="truncate text-xs text-gray-500" title={approval.subject || undefined}>
                      {approval.subject && `| ${approval.subject}`}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {approval.sender && `From: ${approval.sender}`}
                    {approval.sender && approval.createdAt && " | "}
                    {new Date(approval.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <button
                onClick={() => toggleExpand(approval._id)}
                type="button"
                aria-label={expandedId === approval._id ? "Collapse approval details" : "Expand approval details"}
                className="shrink-0 rounded-md p-1 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
              >
                {expandedId === approval._id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {expandedId === approval._id && (
              <div className="border-t border-gray-100 px-3 pb-3">
                {/* AI/System Reasoning */}
                {(() => {
                  const parsedReasoning = parseApprovalReasoning(approval.reasoning);
                  const hasStructuredSummary = parsedReasoning.fields.length > 0;
                  const rawReasoning = parsedReasoning.residual;
                  const zohoNote = approval.source === "ZOHO" ? findApprovalNote(approval.reasoning, zohoNotes) : null;

                  return (
                    <div className="mb-4 space-y-4">
                      <div>
                        <div className="mb-2 text-sm font-semibold text-gray-800">
                          {getApprovalTextHeading(approval)}
                        </div>
                        {hasStructuredSummary && (
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Summary
                            </div>
                            <dl className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                              {parsedReasoning.fields.map((field) => (
                                <div
                                  key={field.label}
                                  className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
                                >
                                  <dt className="font-semibold text-gray-800">{field.label}</dt>
                                  <dd className="min-w-0 break-words leading-6 text-gray-600">
                                    {field.value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}
                        {rawReasoning && (
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-600">
                            <ExpandableText
                              text={rawReasoning}
                              fullText={zohoNote?.content ?? undefined}
                              title={zohoNote ? zohoNote.title || "Zoho note" : `${getSourceLabel(approval.source)} update`}
                              subtitle={zohoNote?.author ? `by ${zohoNote.author}` : approval.subject || undefined}
                            />
                          </div>
                        )}
                      </div>
                      {hasAiConfidence(approval) && (
                        <div>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Confidence
                          </div>
                          <div className="inline-flex items-center rounded-md border border-red-100 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700">
                            {Math.round(approval.confidence * 100)}/100
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Email body. A mail approval carries prose, not a field diff, so the
                    message itself is what the estimator reviews. */}
                {approval.source === "EMAIL" && approvalEmail && (
                  <div className="mb-3">
                    <div className="mb-2 text-sm font-medium text-gray-700">Message</div>
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                      <EmailBody html={approvalEmail.bodyHtml} text={approvalEmail.bodyText} />
                    </div>
                  </div>
                )}

                {/* Detected Changes */}
                {approval.source !== "EMAIL" && approval.detectedChanges && approval.detectedChanges.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-2 text-sm font-medium text-gray-700">
                      Detected Changes ({approval.detectedChanges.length}):
                    </div>
                    <div className="space-y-2">
                      {approval.detectedChanges.map((change, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-gray-200 p-2 text-xs"
                        >
                          <div className="mb-1 font-medium text-gray-900">
                            {change.fieldName}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-500">Previous:</span>
                              <span className="ml-1 text-gray-700">
                                {change.previousValue ?? "none"}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">New:</span>
                              <span className="ml-1 text-gray-700">
                                {change.newValue ?? "none"}
                              </span>
                            </div>
                          </div>
                          {change.aiReasoning && (
                            <div className="mt-1 text-xs text-purple-700 italic">
                              AI: {change.aiReasoning}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Documents */}
                {approvalDocuments.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 text-sm font-medium text-gray-700">
                      Documents ({approvalDocuments.length}):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {approvalDocuments.map((document, idx) =>
                        document.id ? (
                          <button
                            key={document.id}
                            type="button"
                            onClick={() => openDocumentPreview(document.id!, document.name)}
                            title={`Open ${document.name}`}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            <FileText size={12} className="shrink-0" />
                            <span className="truncate">{document.name}</span>
                          </button>
                        ) : (
                          <span
                            key={`${document.name}-${idx}`}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600"
                          >
                            <FileText size={12} className="shrink-0" />
                            <span className="truncate">{document.name}</span>
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 border-t border-gray-100 pt-3">
                  <button
                    onClick={() => handleApprove(approval._id)}
                    disabled={processingId === approval._id || isAnalysisRunning}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-green-600 px-3 py-2 text-sm text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingId === approval._id ? (
                      "Processing..."
                    ) : (
                      <>
                        <CheckCircle size={14} />
                        Approve
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleReject(approval._id)}
                    disabled={processingId === approval._id || isAnalysisRunning}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-2 text-sm text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingId === approval._id ? (
                      "Processing..."
                    ) : (
                      <>
                        <XCircle size={14} />
                        Reject
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
};
