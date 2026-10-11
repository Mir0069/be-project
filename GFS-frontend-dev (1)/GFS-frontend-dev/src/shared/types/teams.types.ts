// shared/types/teams.types.ts
// Mirrors the backend /teams contract (messages + meetings).

export interface TeamsAttachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  contentUrl?: string | null;
  downloaded: boolean;
}

export interface TeamsMessage {
  id: string;
  messageId: string;
  teamId: string;
  channelId: string;
  parentMessageId: string | null;
  fromName?: string | null;
  fromId?: string | null;
  contentText: string;
  contentHtml?: string | null;
  webUrl?: string | null;
  createdDateTime: string;
  attachments: TeamsAttachment[];
  projectId: string | null;
  linkMethod: string | null;
  routedToPipeline: boolean;
}

export interface TeamsMessagesResponse {
  messages: TeamsMessage[];
  total: number;
}

// An AI-generated summary (chat or meeting). Written back by the AI callback.
export interface TeamsAiSummary {
  summary: string;
  keyPoints: string[];
  requirements: string[];
  confidence: number | null;
  updatedAt: string;
}

// A meeting occurrence (list item). Heavy detail (conversation, docs,
// transcript) is fetched separately via getTeamsMeeting.
export interface TeamsMeetingSummary {
  id: string;
  channelEventMessageId: string;
  callId: string | null;
  meetingId: string | null;
  subject: string | null;
  startDateTime: string | null;
  teamId: string | null;
  channelId: string | null;
  projectId: string | null;
  transcriptId: string | null;
  participantNames: string[];
  participantCount: number;
  messageCount: number;
  documentCount: number;
  hasTranscript: boolean;
  aiSummary?: TeamsAiSummary | null;
}

// GET /teams/projects/:projectId/ai-summary
export interface TeamsProjectAiSummaryMeeting {
  meetingId: string;
  subject: string | null;
  startDateTime: string | null;
  hasTranscript: boolean;
  aiSummary: TeamsAiSummary | null;
}

export interface TeamsProjectAiSummary {
  chat: TeamsAiSummary | null;
  meetings: TeamsProjectAiSummaryMeeting[];
}

export interface TeamsMeetingsResponse {
  meetings: TeamsMeetingSummary[];
  total: number;
}

export interface TeamsMeetingConversationItem {
  messageId: string;
  parentMessageId: string | null;
  fromName: string | null;
  fromId: string | null;
  contentText: string;
  createdDateTime: string;
  webUrl: string | null;
}

// A meeting's shared document is a real ingested pipeline record (documentId +
// blobUrl), or a not-yet-ingested attachment fallback (documentId null).
export interface TeamsMeetingDocument {
  documentId: string | null;
  originalName: string;
  documentType: string | null;
  status: string | null;
  blobUrl: string | null;
  byteSize: number | null;
  source: string;
  sharedByName: string | null;
  sharedAt: string | null;
  contentUrl: string | null;
}

export interface TeamsMeetingTranscript {
  transcriptId: string;
  createdDateTime: string | null;
  text: string;
  vtt: string;
  byteSize: number;
  routedToPipeline: boolean;
}

export interface TeamsMeetingDetail {
  meeting: TeamsMeetingSummary;
  conversation: TeamsMeetingConversationItem[];
  documents: TeamsMeetingDocument[];
  transcript: TeamsMeetingTranscript | null;
}
