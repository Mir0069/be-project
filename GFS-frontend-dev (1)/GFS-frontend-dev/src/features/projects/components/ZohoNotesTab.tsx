import { Loader2, StickyNote } from "lucide-react";

import ExpandableText from "@/components/ui/ExpandableText";
import type { ZohoNote } from "@/shared/types/zoho.types";

import { SectionCard } from "./SectionCard";

const formatDateTime = (value?: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export const ZohoNotesTab = ({
  notes,
  isLoading,
}: {
  notes?: ZohoNote[];
  isLoading?: boolean;
}) => (
  <SectionCard title="Zoho Notes" icon={<StickyNote size={16} />}>
    {isLoading ? (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <Loader2 size={16} className="animate-spin" /> Loading notes…
      </div>
    ) : !notes || notes.length === 0 ? (
      <p className="text-sm text-gray-400 italic">No notes on this lead.</p>
    ) : (
      <ul className="space-y-3">
        {notes.map((note, index) => (
          <li key={note.id ?? index} className="border border-gray-200 rounded-md p-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-sm font-semibold text-gray-800">{note.title || "Untitled note"}</p>
              <span className="text-xs text-gray-400 shrink-0">{formatDateTime(note.createdTime)}</span>
            </div>
            {note.content && (
              <ExpandableText
                text={note.content}
                title={note.title || "Untitled note"}
                subtitle={[formatDateTime(note.createdTime), note.author && `by ${note.author}`].filter(Boolean).join(" · ")}
                className="text-sm text-gray-600 leading-relaxed"
              />
            )}
            {note.author && <p className="text-xs text-gray-400 mt-2">by {note.author}</p>}
          </li>
        ))}
      </ul>
    )}
  </SectionCard>
);

export default ZohoNotesTab;
