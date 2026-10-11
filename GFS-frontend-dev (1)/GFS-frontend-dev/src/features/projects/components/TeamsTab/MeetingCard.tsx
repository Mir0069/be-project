import { useState } from "react";
import { ChevronRight, ChevronDown, Users, Loader2, FileText, Eye } from "lucide-react";

import type {
  TeamsMeetingSummary,
  TeamsMeetingConversationItem,
  TeamsMeetingDocument,
} from "@/shared/types/teams.types";
import { useTeamsMeeting } from "@/features/projects/query/teamsQuery";
import { usePreviewDocument } from "@/features/projects/query/documentsQuery";

import { TranscriptViewer } from "./TranscriptViewer";
import { ChatBubble } from "./ChatBubble";
import { openDocumentPreview } from "@/shared/lib/filePreview";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

const formatDate = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

// In-meeting chat is a flat, chronological thread — rendered with the SAME
// chat-bubble style as the channel Conversation (consecutive same-sender group).
const MeetingConversation = ({ items }: { items: TeamsMeetingConversationItem[] }) => {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 italic">No conversation captured.</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const prev = items[i - 1];
        const grouped =
          !!prev &&
          prev.fromId === item.fromId &&
          new Date(item.createdDateTime).getTime() - new Date(prev.createdDateTime).getTime() <
            GROUP_WINDOW_MS;
        return (
          <ChatBubble
            key={item.messageId}
            fromName={item.fromName}
            fromId={item.fromId}
            contentText={item.contentText}
            createdDateTime={item.createdDateTime}
            grouped={grouped}
          />
        );
      })}
    </div>
  );
};

// Shared doc row with the same eye-icon inline preview as the Documents tab.
const MeetingDocRow = ({ doc }: { doc: TeamsMeetingDocument }) => {
  const previewMutation = usePreviewDocument();

  const view = () => {
    if (doc.documentId) {
      openDocumentPreview(doc.documentId, doc.name || doc.originalName || "document");
    } else if (doc.contentUrl) {
      window.open(doc.contentUrl, "_blank", "noreferrer");
    }
  };

  const canView = Boolean(doc.documentId || doc.contentUrl);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <FileText size={14} className="shrink-0 text-gray-400" />
        <span className="truncate text-sm text-gray-700">{doc.originalName}</span>
        {doc.sharedByName && (
          <span className="shrink-0 text-xs text-gray-400">· {doc.sharedByName}</span>
        )}
      </div>
      {canView && (
        <button
          type="button"
          onClick={view}
          disabled={previewMutation.isPending}
          title="View file"
          className="shrink-0 text-gray-500 transition hover:text-gray-800 disabled:opacity-40"
        >
          {previewMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
        </button>
      )}
    </div>
  );
};

export const MeetingCard = ({ meeting }: { meeting: TeamsMeetingSummary }) => {
  const [open, setOpen] = useState(false);
  const { data: detail, isLoading } = useTeamsMeeting(open ? meeting.id : undefined);

  return (
    <li className="border border-gray-200 rounded-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">
            {meeting.subject || "Untitled meeting"}
          </p>
          <p className="text-xs text-gray-500 mt-1">{formatDate(meeting.startDateTime)}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Users size={12} /> {meeting.participantCount}
          </span>
          {meeting.hasTranscript && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600">
              transcript
            </span>
          )}
          {meeting.aiSummary && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600">
              summary
            </span>
          )}
          {open ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronRight size={16} className="text-gray-400" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Loading meeting…
            </div>
          ) : (
            <>
              {meeting.participantNames.length > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="font-semibold">Participants:</span>{" "}
                  {meeting.participantNames.join(", ")}
                </p>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Conversation</p>
                <MeetingConversation items={detail?.conversation ?? []} />
              </div>

              {(detail?.documents?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                    Shared documents
                  </p>
                  <div className="space-y-2">
                    {detail!.documents.map((doc, index) => (
                      <MeetingDocRow key={doc.documentId ?? index} doc={doc} />
                    ))}
                  </div>
                </div>
              )}

              <TranscriptViewer
                transcript={detail?.transcript ?? null}
                subject={meeting.subject}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
};

export default MeetingCard;
