import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Users, FileText, ClipboardList } from "lucide-react";

import type { TeamsMessage, TeamsMeetingSummary } from "@/shared/types/teams.types";
import { SectionCard } from "@/features/projects/components/SectionCard";
import { useMonitoredChannels, useProjectAiSummary } from "@/features/projects/query/teamsQuery";

import { ConversationList } from "./ConversationList";
import { MeetingsList } from "./MeetingsList";
import { ChannelConnection } from "./ChannelConnection";
import { AiSummary } from "./AiSummary";

export const TeamsTab = ({
  projectId,
  messages,
  messagesLoading,
  meetings,
  meetingsLoading,
}: {
  projectId?: string;
  messages?: TeamsMessage[];
  messagesLoading?: boolean;
  meetings?: TeamsMeetingSummary[];
  meetingsLoading?: boolean;
}) => {
  // Shares the monitored-channels query with ChannelConnection, which pulls it
  // forward the moment the workspace is linked, so the sections below unlock
  // without a reload.
  const { data: monitored } = useMonitoredChannels(!!projectId);
  const connected =
    !!projectId && (monitored ?? []).some((c) => c.isActive && c.projectIds.includes(projectId));

  const { data: aiSummary } = useProjectAiSummary(connected ? projectId : undefined);

  // Every meeting that has a non-empty AI summary, surfaced together in one
  // "Meeting Summaries" section (mirrors the single Chat Summary section).
  const meetingSummaries = (aiSummary?.meetings ?? []).filter(
    (m) =>
      m.aiSummary &&
      (Boolean(m.aiSummary.summary) ||
        m.aiSummary.keyPoints.length > 0 ||
        m.aiSummary.requirements.length > 0),
  );

  // The Chat/Meeting summary cards are shown ONLY once the AI has actually
  // produced content — no empty "no summary yet" placeholders.
  const chat = aiSummary?.chat;
  const hasChatSummary =
    !!chat &&
    (Boolean(chat.summary) ||
      (chat.keyPoints?.length ?? 0) > 0 ||
      (chat.requirements?.length ?? 0) > 0);

  // After a fresh connect the backend imports the channel in the background, so
  // the conversation fills in over the next several seconds. Show an importing
  // indicator for that window, started only by an actual connect.
  const [importing, setImporting] = useState(false);
  const importTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleConnected = useCallback(() => {
    setImporting(true);
    if (importTimerRef.current) clearTimeout(importTimerRef.current);
    importTimerRef.current = setTimeout(() => setImporting(false), 20_000);
  }, []);
  useEffect(
    () => () => {
      if (importTimerRef.current) clearTimeout(importTimerRef.current);
    },
    [],
  );

  return (
    <div className="space-y-6">
      {/* Workspace status: connected banner, discovery/creation notice, or the decision card. */}
      {projectId && <ChannelConnection projectId={projectId} onConnected={handleConnected} />}

      {connected && (
        <>
          {hasChatSummary && (
            <SectionCard title="Chat Summary" icon={<FileText size={16} />} collapsible>
              <AiSummary summary={chat!} label="Chat Summary" />
            </SectionCard>
          )}
          {meetingSummaries.length > 0 && (
            <SectionCard title="Meeting Summaries" icon={<ClipboardList size={16} />} collapsible>
              <div className="space-y-3">
                {meetingSummaries.map((m) => (
                  <AiSummary
                    key={m.meetingId}
                    summary={m.aiSummary!}
                    label={m.subject || "Untitled meeting"}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          <SectionCard title="Conversation" icon={<MessageSquare size={16} />} collapsible>
            <ConversationList
              messages={messages}
              isLoading={messagesLoading}
              importing={importing}
              projectId={projectId}
              hasMeetings={(meetings?.length ?? 0) > 0}
            />
          </SectionCard>
          <SectionCard title="Meetings" icon={<Users size={16} />} collapsible>
            <MeetingsList meetings={meetings} isLoading={meetingsLoading} />
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default TeamsTab;
