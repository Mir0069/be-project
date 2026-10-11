// pages/ProjectDashboard.tsx
// If :projectId is a 24-char hex Mongo ObjectId → fetch live email data.
// Otherwise → fall back to the static getProjectById() lookup.

import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Mail,
  PhoneCall,
  Info,
  Loader2,
  X,
  Copy,
  Check,
  Play,
  Users,
  Paperclip,
  RefreshCw,
} from "lucide-react";

import { useProject, useUpdateProjectEstimators } from "@/features/projects/query/projectsQuery";
import { useEstimators } from "@/features/sales-manager/create-project/query/show-estimator.query";

import { getProjectById } from "@/utils/project-storage";
import StatusBadge from "@/features/sales-manager/projects/components/StatusBadge";
import { useOutlookEmails } from "@/features/projects/query/outlookQuery";
import { useZohoNotes } from "@/features/zoho/query/zohoQuery";
import { useTeamsMessages, useTeamsMeetings } from "@/features/projects/query/teamsQuery";
import OverviewPanel from "@/features/projects/components/OverviewPanel";
import ZohoNotesTab from "@/features/projects/components/ZohoNotesTab";
import TeamsTab from "@/features/projects/components/TeamsTab";
import { useProjectCalls } from "@/features/comms/query/commsQuery";
import type { CallRecord } from "@/shared/types/comms.types";
import type { OutlookEmail } from "@/shared/types/email.types";
import type { ProjectStatus } from "@/shared/types/project.types";
import { getProjectIdentity } from "@/features/projects/utils/projectIdentity";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { PendingApprovalsPanel } from "@/features/estimator/workspace/pages/components/PendingApprovalsPanel";
import WorkspaceAnalysisStatus from "@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus";
import ProjectOverviewAnalysisAction from "@/features/projects/components/ProjectOverviewAnalysisAction";
import { MoveEmailModal } from "@/components/modals/MoveEmailModal";
import EmailBody from "@/features/sales-manager/projects/components/EmailBody";
import { openDocumentPreview } from "@/shared/lib/filePreview";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isMongoId = (id: string) => /^[a-f\d]{24}$/i.test(id);

const toProjectStatus = (apiStatus: string): ProjectStatus => {
  const map: Record<string, ProjectStatus> = {
    CONFIRMED: "In-progress",
    PENDING: "Pending",
    REJECTED: "Not started",
  };
  return map[apiStatus] ?? "Not started";
};

// ─── Tabs config ─────────────────────────────────────────────────────────────

// Exported so a test can assert the exact tab set without having to render this
// whole page and mock every hook it uses.
export const tabs = [
  { id: "Overview", label: "Overview", type: "icon", size: 16 },
  { id: "Zoho Notes", label: "Zoho Notes", type: "image", image: "/zoho.png", size: 18 },
  { id: "Mails", label: "Mails", type: "image", image: "/outlook.png", size: 20 },
  { id: "Teams", label: "Teams", type: "image", image: "/teams.png", size: 20 },
  { id: "Call Records", label: "Call Records", type: "image", image: "/call.png", size: 16 },
];

// ─── Shared layout pieces ────────────────────────────────────────────────────

const SectionCard = ({ title, icon, children }: any) => (
  <section className="bg-white rounded-lg border border-gray-200 p-5">
    <div className="flex items-center gap-2 mb-5">
      <div className="text-red-500">{icon}</div>
      <h2 className="text-lg font-semibold text-red-500">{title}</h2>
    </div>
    {children}
  </section>
);

const FieldGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-5 text-sm">{children}</div>
);

const Field = ({ label, value }: { label: string; value?: string | null }) =>
  value ? (
    <div>
      <p className="text-gray-500">{label}</p>
      <p className="font-medium text-gray-800">{value}</p>
    </div>
  ) : null;

const openMailAttachment = (attachment: OutlookEmail["attachments"][number]) => {
  const documentId = attachment.storageKey || attachment.id;
  if (!documentId) return;

  openDocumentPreview(documentId, attachment.name || "Document");
};

// ─── API-sourced Overview Tab ─────────────────────────────────────────────────

const ApiOverviewTab = ({ email }: { email: OutlookEmail }) => {
  const proposed = email.proposed;
  const status = toProjectStatus(email.status);

  const { data: project } = useProject(email.projectId);
  const { data: estimatorsData } = useEstimators();
  const updateEstimatorMutation = useUpdateProjectEstimators();

  const [selectedEstimatorId, setSelectedEstimatorId] = useState("");

  const estimators = estimatorsData || [];

  const assignedEstimators = project?.assignedEstimators || [];

  const handleAddEstimator = () => {
    if (!selectedEstimatorId) return;
    if (assignedEstimators.some((e: any) => e.id === selectedEstimatorId)) return;
    
    const newEstimatorIds = [
      ...assignedEstimators.map((e: any) => e.id),
      selectedEstimatorId
    ];

    updateEstimatorMutation.mutate({
      id: email.projectId,
      estimatorIds: newEstimatorIds,
    });
    setSelectedEstimatorId("");
  };

  const handleRemoveEstimator = (estimatorIdToRemove: string) => {
    const newEstimatorIds = assignedEstimators
      .map((e: any) => e.id)
      .filter((id: string) => id !== estimatorIdToRemove);

    updateEstimatorMutation.mutate({
      id: email.projectId,
      estimatorIds: newEstimatorIds,
    });
  };

  return (
    <div className="space-y-6">
     
      {/* Project Details */}
      <SectionCard title="Project Details" icon={<FileText size={16} />}>
        <FieldGrid>
          <Field label="Project Name" value={proposed?.projectName || email.subject} />
          <Field label="Project Type" value={proposed?.projectType} />
          <div>
            <p className="text-gray-500 text-sm">Status</p>
            <StatusBadge status={status} />
          </div>
          <Field label="Received" value={new Date(email.receivedDateTime).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} />
          <Field label="Email Subject" value={email.subject} />
        </FieldGrid>
      </SectionCard>

      {/* Client Details */}
      <SectionCard title="Client Details" icon={<FileText size={16} />}>
        <FieldGrid>
          <Field label="Customer Name" value={proposed?.customerName || email.fromName} />
          <Field label="From" value={email.fromAddress} />
          {/* <Field label="Mailbox" value={email.mailboxUserId} /> */}
          <Field label="Recipients" value={email.toRecipients?.join(", ")} />
        </FieldGrid>
      </SectionCard>
       {/* Assigned Estimators */}
      {project && (
        <SectionCard title="Assigned Estimators" icon={<Users size={16} />}>
          <div className="mb-4 flex gap-3">
            <select
              value={selectedEstimatorId}
              onChange={(e: any) => setSelectedEstimatorId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 flex-1 max-w-xs"
            >
              <option value="">Select Estimator</option>
              {estimators
                .filter((e: any) => !assignedEstimators.some((ae: any) => ae.id === e.id))
                .map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleAddEstimator}
              disabled={!selectedEstimatorId || updateEstimatorMutation.isPending}
              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateEstimatorMutation.isPending ? "Adding..." : "Add Estimator"}
            </button>
          </div>

          {assignedEstimators.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-gray-200">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-50 text-gray-800 border-b border-gray-200">
                  <tr>
                    <th className="py-3 px-4 font-medium">Name</th>
                    <th className="py-3 px-4 font-medium">Email</th>
                    <th className="py-3 px-4 font-medium w-24">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {assignedEstimators.map((estimator: any, idx: number) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 font-medium text-gray-800">
                        {estimator.name || `${estimator.firstName || ''} ${estimator.lastName || ''}`.trim()}
                      </td>
                      <td className="py-3 px-4">{estimator.email}</td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleRemoveEstimator(estimator.id)}
                          disabled={updateEstimatorMutation.isPending}
                          className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                          title="Remove Estimator"
                        >
                          <X size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">No estimators assigned yet.</p>
          )}
        </SectionCard>
      )}

    </div>
  );
};

// ─── Static project Overview Tab ─────────────────────────────────────────────

const OverviewTab = ({ project }: any) => {
  const details = project.formData.projectDetails;
  const client = project.formData.clientDetails;
  const contact = project.formData.clientContact;
  const assignments = project.formData.assignments;

  return (
    <div className="space-y-6">
      <SectionCard title="Project Details" icon={<FileText size={16} />}>
        <FieldGrid>
          <Field label="Project Name" value={details.projectName} />
          <Field label="Project ID" value={details.projectId} />
          <Field label="Budget" value={details.estimatedBudget} />
          <div>
            <p className="text-gray-500 text-sm">Status</p>
            <StatusBadge status={details.status} />
          </div>
          <Field label="Action" value={details.action} />
          <Field label="Bid Deadline" value={details.bidDeadline} />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Client Details" icon={<FileText size={16} />}>
        <FieldGrid>
          <Field label="Company" value={client.companyName} />
          <Field label="Website" value={client.website} />
          <Field label="Industry" value={client.industry} />
          <Field label="Revenue" value={client.annualRevenue} />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Client Contact" icon={<FileText size={16} />}>
        <FieldGrid>
          <Field label="Primary Contact" value={contact.primaryContact} />
          <Field label="Email" value={contact.email} />
          <Field label="Phone" value={contact.primary_phone} />
          <Field label="Site Address" value={contact.projectSiteAddress} />
        </FieldGrid>
      </SectionCard>

      <SectionCard title="Assignments" icon={<FileText size={16} />}>
        <div className="space-y-3">
          {assignments.map((person: any) => (
            <div key={person.id} className="border border-gray-200 rounded-md p-3">
              <p className="font-medium text-gray-800">{person.name}</p>
              <p className="text-sm text-gray-500">{person.email}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
};

// ─── Mails Tab ────────────────────────────────────────────────────────────────

const MailDetailModal = ({
  mail,
  onClose,
}: {
  mail: OutlookEmail;
  onClose: () => void;
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-email-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Full email</p>
            <h2 id="full-email-title" className="mt-1 truncate text-lg font-semibold text-gray-900">
              {mail.subject || "Untitled email"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close full email"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <div className="grid gap-2 border-b border-gray-100 pb-4 text-sm text-gray-600 sm:grid-cols-2">
            <div>
              <p className="font-medium text-gray-900">{mail.fromName}</p>
              <p>{mail.fromAddress}</p>
            </div>
            <div className="sm:text-right">
              <p>{mail.toRecipients?.length ? `To: ${mail.toRecipients.join(", ")}` : "No recipients listed"}</p>
              <p className="text-xs text-gray-400">
                {new Date(mail.receivedDateTime).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
          </div>

          <div className="py-5">
            <EmailBody html={mail.bodyHtml} text={mail.bodyText} />
          </div>

          {mail.attachments?.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Attachments</p>
              <div className="flex flex-wrap gap-2">
                {mail.attachments.map((attachment) => (
                  <button
                    type="button"
                    key={attachment.id}
                    onClick={() => openMailAttachment(attachment)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left text-xs text-gray-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                    aria-label={`Open ${attachment.name}`}
                    title={`Open ${attachment.name}`}
                  >
                    <Paperclip size={12} aria-hidden="true" />
                    {attachment.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Exported so a test can render the mail card on its own, without mocking every
// hook this page uses.
export const MailsTab = ({
  emails,
  isLoading,
  onMoveEmail,
}: {
  emails?: OutlookEmail[];
  isLoading?: boolean;
  onMoveEmail?: (mail: OutlookEmail) => void;
}) => {
  const [selectedMail, setSelectedMail] = useState<OutlookEmail | null>(null);

  return (
    <>
      <SectionCard title="Mails" icon={<Mail size={16} />}>
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading emails…
          </div>
        ) : !emails || emails.length === 0 ? (
          <p className="text-sm italic text-gray-400">No mails available.</p>
        ) : (
          <ul className="space-y-3">
            {emails.map((mail) => (
              <li
                key={mail.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-2xs transition hover:border-red-200"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-800">{mail.subject}</p>
                  <span className="shrink-0 text-xs text-gray-400">
                    {new Date(mail.receivedDateTime).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <p className="mb-2 text-xs text-gray-500">
                  From: <span className="text-gray-700">{mail.fromName}</span>{" "}
                  &lt;{mail.fromAddress}&gt;
                </p>
                {mail.bodyText ? (
                  <p className="line-clamp-3 text-sm leading-relaxed text-gray-600">
                    {mail.bodyText}
                  </p>
                ) : (
                  <p className="text-sm italic text-gray-400">Open the email to view its contents.</p>
                )}
                {mail.attachments?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mail.attachments.map((att) => (
                      <button
                        type="button"
                        key={att.id}
                        onClick={() => openMailAttachment(att)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-left text-xs text-gray-600 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                        aria-label={`Open ${att.name}`}
                        title={`Open ${att.name}`}
                      >
                        <Paperclip size={12} aria-hidden="true" />
                        {att.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedMail(mail)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                  >
                    <Mail size={13} />
                    View full email
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveEmail?.(mail)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <RefreshCw size={13} className="text-red-500" />
                    Move to Project
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {selectedMail && (
        <MailDetailModal mail={selectedMail} onClose={() => setSelectedMail(null)} />
      )}
    </>
  );
};

// ─── Calls tab (static fallback) ─────────────────────────────────────────────

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
          <div className="flex items-center gap-2">
            {/* {call.transcriptFileUrl && (
              <a
                href={call.transcriptFileUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-500 bg-gray-50 border border-gray-200 px-3 py-2 rounded-md font-medium transition"
              >
                <Download size={14} />
                Download Original Audio
              </a>
            )} */}
          </div>
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

const CallsTab = ({ data, isLoading }: { data?: CallRecord[]; isLoading?: boolean }) => {
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);

  return (
    <SectionCard title="Call Records" icon={<PhoneCall size={16} />}>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <Loader2 size={16} className="animate-spin" /> Loading call records…
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No call transcripts available.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {data.map((call) => {
              const displayName = call.customerName
                ? `Call with ${call.customerName}`
                : call.title || "Call Record";
              const hasSummary = !!call.summaryText;

              return (
                <li
                  key={call.id}
                  onClick={() => setActiveCall(call)}
                  className="border border-gray-200 rounded-md p-4 hover:border-red-200 cursor-pointer transition flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {displayName}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-gray-500">
                        {call.date || (call.callDate ? new Date(call.callDate).toLocaleDateString() : "")}
                      </span>
                      {hasSummary && (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">
                          Transcript ready
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label="Play"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition shrink-0"
                  >
                    <Play size={14} fill="currentColor" className="text-gray-600" />
                  </button>
                </li>
              );
            })}
          </ul>

          {activeCall && (
            <CallTranscriptModal
              call={activeCall}
              onClose={() => setActiveCall(null)}
            />
          )}
        </>
      )}
    </SectionCard>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const ProjectDashboard = () => {
  const { projectId, publicProjectKey, project: projectDetail } = useProjectRoute();
  const [activeTab, setActiveTab] = useState("Overview");

  // Detect whether this is an API project (Mongo ObjectId) or static
  const isApiProject = (!!projectId && isMongoId(projectId)) || !!projectDetail;
  const [emailToMove, setEmailToMove] = useState<OutlookEmail | null>(null);

  // Fetch live emails when it's an API project
  const { data: emails, isLoading: emailsLoading, refetch: refetchEmails } = useOutlookEmails(
    isApiProject ? projectId : undefined
  );

  // Notes from the linked Zoho lead (real data from the backend)
  const zohoLeadId = projectDetail?.zohoLeadId ?? null;
  const { data: zohoNotes, isLoading: notesLoading } = useZohoNotes(zohoLeadId);

  // Fetch live call records when it's an API project
  const { data: liveCalls, isLoading: callsLoading } = useProjectCalls(
    isApiProject ? projectId : undefined
  );

  // Teams channel conversation + meetings for an API project
  const { data: teamsMessages, isLoading: teamsMessagesLoading } = useTeamsMessages(
    isApiProject ? projectId : undefined
  );
  const { data: teamsMeetings, isLoading: teamsMeetingsLoading } = useTeamsMeetings(
    isApiProject ? projectId : undefined
  );

  // Fallback: static project lookup
  const staticProject = useMemo(
    () => (!isApiProject ? getProjectById(publicProjectKey || "") : null),
    [publicProjectKey, isApiProject]
  );

  const firstEmail = emails?.[0] ?? null;

  const projectIdentity = projectDetail
    ? getProjectIdentity(projectDetail)
    : firstEmail?.proposed?.projectName ||
      firstEmail?.subject ||
      staticProject?.formData?.projectDetails?.projectName ||
      "Project";

  // Not found state
  if (!isApiProject && !staticProject) {
    return (
      <div className="text-center py-20 text-red-500">Project not found.</div>
    );
  }

  // Loading state for API project
  if (isApiProject && emailsLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
        <span>Loading project…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="border-l-3 border-red-500 px-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-2xl font-medium text-red-500">Project Overview</div>
            <div className="text-md mt-2 truncate text-gray-500" title={projectIdentity}>{projectIdentity}</div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {activeTab === "Overview" && isApiProject && projectId && (
              <ProjectOverviewAnalysisAction projectId={projectId} />
            )}
            <WorkspaceAnalysisStatus />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="relative flex items-center gap-12 border-b border-gray-300">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 py-3 text-sm transition-colors duration-300 hover:cursor-pointer"
            >
              {tab.type === "icon" ? (
                <Info
                  size={tab.size}
                  className={`transition-colors duration-300 ${isActive ? "text-red-500" : "text-gray-300"}`}
                />
              ) : (
                <img
                  src={tab.image}
                  alt={tab.label}
                  style={{ width: `${tab.size}px`, height: `${tab.size}px` }}
                  className={`object-contain transition-all duration-300 ${!isActive ? "opacity-60" : "opacity-100"}`}
                />
              )}
              <span
                className={`transition-colors duration-300 text-md ${isActive ? "text-red-500" : "text-gray-700"}`}
              >
                {tab.label}
              </span>

              {/* Underline */}
              <div
                className={`
                  absolute
                  bottom-0
                  left-[-6px]
                  right-[-6px]
                  h-[2px]
                  bg-red-500
                  transition-all
                  duration-300
                  ${isActive
                    ? "opacity-100 scale-x-100"
                    : "opacity-0 scale-x-0"
                  }
                `}
              />
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === "Overview" && (
        <>
          {projectId && <PendingApprovalsPanel projectId={projectId} />}
          {isApiProject && projectDetail
            ? <OverviewPanel project={projectDetail} />
            : isApiProject && firstEmail
            ? <ApiOverviewTab email={firstEmail} />
            : staticProject
              ? <OverviewTab project={staticProject} />
              : <p className="text-sm text-gray-400 italic">No project data available.</p>}
        </>
      )}

      {activeTab === "Mails" && (
        isApiProject
          ? <MailsTab emails={emails} isLoading={emailsLoading} onMoveEmail={(mail) => setEmailToMove(mail)} />
          : <MailsTab
            emails={undefined}
            isLoading={false}
          />
      )}

      {activeTab === "Teams" && (
        <TeamsTab
          projectId={isApiProject ? projectId : undefined}
          messages={teamsMessages}
          messagesLoading={teamsMessagesLoading}
          meetings={teamsMeetings}
          meetingsLoading={teamsMeetingsLoading}
        />
      )}

      {activeTab === "Call Records" && (
        isApiProject
          ? <CallsTab data={liveCalls} isLoading={callsLoading} />
          : <CallsTab data={staticProject?.integrations?.transcripts?.data} />
      )}

      <MoveEmailModal
        isOpen={!!emailToMove}
        onClose={() => setEmailToMove(null)}
        email={emailToMove}
        currentProjectId={projectId}
        onMovedSuccess={() => {
          if (refetchEmails) refetchEmails();
        }}
      />

      {activeTab === "Zoho Notes" && (
        <ZohoNotesTab notes={zohoNotes} isLoading={notesLoading} />
      )}

    </div>
  );
};

export default ProjectDashboard;
