// pages/estimator/workspace/tabs/communications/Outlook.tsx

import { useState } from "react";
import { useParams } from "react-router-dom";
import { FileText, Image, Paperclip, Search, X, Loader2 } from "lucide-react";
import RowMenu from "@/features/estimator/workspace/pages/components/RowMenu";
import { emails as mockEmails, type EmailMessage } from "@/features/estimator/workspace/mockData";
import { useOutlookEmails } from "@/features/projects/query/outlookQuery";

const Outlook = () => {
  const { projectId } = useParams();
  const { data: liveEmails, isLoading } = useOutlookEmails(projectId);
  const [active, setActive] = useState<EmailMessage | null>(null);
  const [search, setSearch] = useState("");

  const emailList: EmailMessage[] =
    liveEmails && liveEmails.length > 0
      ? liveEmails.map((e) => ({
          id: e.id || e.messageId,
          from: e.fromName || "Unknown",
          fromEmail: e.fromAddress || "",
          to: e.toRecipients?.join(", ") || "",
          toEmail: e.toRecipients?.[0] || "",
          subject: e.subject || "(No subject)",
          preview: e.bodyText ? e.bodyText.slice(0, 160) : e.subject || "",
          body: e.bodyText || e.subject || "",
          timestamp: e.receivedDateTime
            ? new Date(e.receivedDateTime).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "",
          attachments: (e.attachments || []).map((a) => ({
            name: a.name,
            type: a.contentType?.startsWith("image") ? ("image" as const) : ("doc" as const),
          })),
        }))
      : mockEmails;

  const filtered = emailList.filter(
    (e: any) =>
      e.subject.toLowerCase().includes(search.toLowerCase()) ||
      e.from.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-gray-800">
          Communications Hub - Mails
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage your emails related of the project
        </p>
      </header>

      {/* Search */}
      <div className="relative max-w-3xl">
        <input
          value={search}
          onChange={(e: any) => setSearch(e.target.value)}
          placeholder="Search mails....."
          className="w-full bg-white border border-gray-200 rounded-md pl-3 pr-10 py-2 text-sm outline-none focus:border-red-500"
        />
        <Search
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>

      {/* List */}
      <ul className="space-y-3 max-w-3xl">
        {filtered.map((m: any) => (
          <li
            key={m.id}
            onClick={() => setActive(m as any)}
            className="bg-white border border-l-4 border-l-blue-300 border-gray-200 rounded-md p-4 cursor-pointer hover:shadow-sm transition relative"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{m.from}</p>
                <p className="text-sm text-gray-700 mt-0.5">
                  Sub: {m.subject}
                </p>
                <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">
                  {m.preview}
                </p>
                {m.attachments && m.attachments.length > 0 && (
                  <span className="mt-2 inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    <Paperclip size={10} />
                    {m.attachments.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div onClick={(e: any) => e.stopPropagation()}>
                  {/* RowMenu */}
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {m.timestamp}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Detail Modal */}
      {active && <EmailDetailModal email={active} onClose={() => setActive(null)} />}
    </div>
  );
};

const EmailDetailModal = ({
  email,
  onClose,
}: {
  email: EmailMessage;
  onClose: () => void;
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 relative max-h-[85vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          <X size={18} />
        </button>

        <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-3">
          {email.subject}
        </h3>

        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mt-4">
          <div className="col-span-2">
            <span className="font-medium text-gray-800">{email.from}</span>{" "}
            &lt;{email.fromEmail}&gt;
          </div>
          <div>
            To: <span className="font-medium text-gray-800">{email.to}</span> &lt;
            {email.toEmail}&gt;{email.cc && ` cc:${email.cc}`}
          </div>
          <div className="text-right">{email.timestamp}</div>
        </div>

        <div className="mt-4 text-sm text-gray-700 whitespace-pre-line leading-relaxed">
          {email.body}
        </div>

        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">Attachments</p>
            <div className="flex flex-wrap gap-2">
              {email.attachments.map((a: any) => (
                <span
                  key={a.name}
                  className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded text-xs text-gray-700"
                >
                  {a.type === "image" ? (
                    <Image size={12} className="text-emerald-500" />
                  ) : (
                    <FileText size={12} className="text-red-500" />
                  )}
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Outlook;
