// MailFilterModal.tsx

import { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Loader2,
  Mail,
} from "lucide-react";

import Outlook_logo from "/outlook.png";

import { PROJECT_MAILS } from "../../../data/mail";
import { useCreateProject } from "../../context/CreateProjectContext";
import { showToast } from "@/components/ui/toast";
import {
  fetchOutlookStatus,
  triggerOutlookSync,
  fetchAllOutlookEmails,
} from "@/services/outlook";
import type { OutlookStatus } from "@/shared/types/email.types";

const commonInputClass = `
w-full
rounded-md
border-2
border-gray-200
bg-gray-50
px-3
py-2
text-sm
text-gray-700
outline-none
focus:border-red-500
mt-1
`;

type Props = {
  open: boolean;
  onClose: () => void;
};

const MailFilterModal = ({ open, onClose }: Props) => {
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<OutlookStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncedEmailCount, setSyncedEmailCount] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const { setProjectData } = useCreateProject();

  const loadStatusAndStats = async () => {
    setIsLoadingStatus(true);
    try {
      const st = await fetchOutlookStatus();
      setStatus(st);
      const emailRes = await fetchAllOutlookEmails({ limit: 100 });
      setSyncedEmailCount(emailRes.total ?? emailRes.emails?.length ?? 0);
    } catch (err) {
      console.warn("[MailFilterModal] Failed to fetch Outlook status:", err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadStatusAndStats();
    }
  }, [open]);

  const handleConnectOAuth = () => {
    // Open OAuth login endpoint which redirects to Microsoft OAuth consent screen
    const authUrl = "/api/v1/outlook/auth/login";
    window.open(authUrl, "_blank", "width=600,height=750");
    showToast(
      "info",
      "Sign in with your Microsoft account in the opened window, then click 'Refresh Status'."
    );
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const res = await triggerOutlookSync();
      const mailboxes = res?.mailboxes ?? [];
      const fetchedCount = mailboxes.reduce(
        (acc: number, m: any) => acc + (m.fetchedCount ?? 0),
        0
      );
      showToast(
        "success",
        `Synced mailbox! Fetched ${fetchedCount} email(s) from Microsoft Outlook.`
      );
      await loadStatusAndStats();
    } catch (err: any) {
      console.error("[MailFilterModal] Sync failed:", err);
      showToast("error", err?.message || "Failed to sync Outlook emails.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      // 1. Try to fetch live emails from backend
      const liveRes = await fetchAllOutlookEmails({ limit: 100 }).catch(() => null);
      const liveEmails = liveRes?.emails ?? [];

      let importedMails: any[] = [];

      if (liveEmails.length > 0) {
        // Filter live emails
        const matches = liveEmails.filter((email) => {
          if (!domain.trim()) return true;
          const search = domain.toLowerCase().trim();
          const senderMatch =
            (email.fromAddress || "").toLowerCase().includes(search) ||
            (email.fromName || "").toLowerCase().includes(search);
          const receiverMatch = (email.toRecipients || []).some((r) =>
            r.toLowerCase().includes(search)
          );
          return senderMatch || receiverMatch;
        });

        if (matches.length > 0) {
          importedMails = matches.map((m) => ({
            id: m.id || m.messageId,
            projectId: m.projectId || "",
            subject: m.subject || "(No subject)",
            sender: m.fromAddress || m.fromName || "Unknown",
            receivers: m.toRecipients || [],
            date: m.receivedDateTime
              ? m.receivedDateTime.split("T")[0]
              : new Date().toISOString().split("T")[0],
            attachments: (m.attachments || []).map((a) => a.name),
            preview: m.bodyText ? m.bodyText.slice(0, 150) : m.subject || "",
          }));
        }
      }

      // 2. If no live emails matched, fall back to PROJECT_MAILS
      if (importedMails.length === 0) {
        const filteredMock = domain.trim()
          ? PROJECT_MAILS.filter((mail) => {
              const search = domain.toLowerCase().trim();
              const senderMatch = mail.sender.toLowerCase().includes(search);
              const receiverMatch = mail.receivers.some((r) =>
                r.toLowerCase().includes(search)
              );
              return senderMatch || receiverMatch;
            })
          : PROJECT_MAILS;

        if (filteredMock.length > 0) {
          importedMails = filteredMock;
        }
      }

      if (importedMails.length === 0) {
        showToast(
          "error",
          domain.trim()
            ? `No emails found for domain "${domain}". Try syncing Outlook or leave domain blank to import all.`
            : "No emails found in Outlook."
        );
        return;
      }

      // Update project data with imported emails
      setProjectData((prev) => ({
        ...prev,
        integrations: {
          ...prev.integrations,
          mails: {
            integrated: true,
            data: importedMails,
          },
        },
      }));

      showToast(
        "success",
        `Successfully imported ${importedMails.length} email(s) into project!`
      );
      setDomain("");
      onClose();
    } catch (err: any) {
      console.error("[MailFilterModal] Import error:", err);
      showToast("error", err?.message || "Failed to import emails.");
    } finally {
      setIsImporting(false);
    }
  };

  if (!open) return null;

  const isConnected =
    status?.configured &&
    (status.hasRefreshToken || status.accountType === "delegated");

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl w-full max-w-[540px] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 relative border-b border-gray-100">
          <div className="flex items-center gap-3">
            <img src={Outlook_logo} alt="Outlook" className="h-9 w-9 object-contain" />
            <div>
              <h2 className="font-semibold text-lg text-gray-900">
                Import Mails From Outlook
              </h2>
              <p className="text-sm text-gray-500">
                Connect Microsoft Outlook and ingest conversations
              </p>
            </div>
            <button
              onClick={onClose}
              className="absolute top-5 right-5 p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* OAuth Status Card */}
          <div
            className={`p-4 rounded-xl border text-sm transition-all ${
              isConnected
                ? "bg-emerald-50/60 border-emerald-200 text-emerald-900"
                : "bg-amber-50/70 border-amber-200 text-amber-900"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {isConnected ? (
                  <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-medium text-sm">
                    {isConnected
                      ? "Microsoft Outlook Connected (OAuth Delegated)"
                      : "Microsoft OAuth Login Required"}
                  </p>
                  <p className="text-xs mt-1 text-gray-600 leading-relaxed">
                    {isConnected
                      ? "Personal mailbox authenticated. Synced emails and attachments can be read via Microsoft Graph."
                      : "Sign in with your Microsoft personal account to grant read permissions for your inbox."}
                  </p>
                  {typeof syncedEmailCount === "number" && isConnected && (
                    <p className="text-xs mt-1.5 font-medium text-emerald-700 flex items-center gap-1.5">
                      <Mail size={13} /> {syncedEmailCount} email(s) currently stored
                    </p>
                  )}
                </div>
              </div>

              {/* Refresh Status button */}
              <button
                type="button"
                onClick={loadStatusAndStats}
                disabled={isLoadingStatus}
                title="Refresh Status"
                className="p-1.5 rounded-md hover:bg-black/5 text-gray-500 hover:text-gray-800 transition"
              >
                <RefreshCw
                  size={14}
                  className={isLoadingStatus ? "animate-spin text-blue-600" : ""}
                />
              </button>
            </div>

            {/* Action Buttons for OAuth */}
            <div className="mt-3.5 pt-3 border-t border-black/5 flex items-center gap-2">
              {!isConnected ? (
                <button
                  type="button"
                  onClick={handleConnectOAuth}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#0078d4] hover:bg-[#0060aa] text-white text-xs font-medium rounded-lg shadow-sm transition"
                >
                  <ExternalLink size={13} />
                  Sign in with Microsoft
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleSyncNow}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  {isSyncing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  {isSyncing ? "Syncing Inbox..." : "Sync Mailbox Now"}
                </button>
              )}
            </div>
          </div>

          {/* Domain Filter */}
          <div>
            <p className="text-sm text-gray-700 font-medium">
              Filter by Client Domain (Optional)
            </p>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">
              Enter client domain (e.g. <code>abcconstruction.com</code>) or leave blank to import all recent emails.
            </p>

            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. abcconstruction.com or leave empty"
              className={commonInputClass}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isImporting}
            onClick={handleImport}
            className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : null}
            {isImporting ? "Importing..." : "Confirm Import"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MailFilterModal;