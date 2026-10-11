// Shared types for the Teams → AI hand-off (outbound payload + inbound result +
// stored summaries). Used by the dispatch service, the result handler, the
// preview script, and their tests so the wire contract lives in one place.

export const TEAMS_AI_JOB_TYPE = 'TEAMS_PROPOSAL';
export const TEAMS_AI_CORRELATION_PREFIX = 'teamsAiJob';

// ---- Outbound (backend → AI) ----

export interface TeamsAiMessageEntry {
  messageId: string;
  from: string | null; // sender display name
  fromId: string | null;
  text: string; // plain text (may be '')
  html: string | null; // raw HTML when available
  createdAt: string; // ISO-8601
  replyToId: string | null; // = parentMessageId; null for a root message
  webUrl: string | null;
}

export interface TeamsAiDocumentEntry {
  documentId: string;
  originalName: string;
  documentType: string; // drawing|spec|transcript|quote|photo|other
  role: 'shared-file' | 'transcript';
  mimeType: string;
  byteSize: number;
  blobUrl: string; // read-only SAS URL, ~60 min TTL
  sharedBy: string | null; // uploader display name; null for a transcript
  sharedAt: string | null; // ISO-8601
}

export interface TeamsAiMeetingEntry {
  meetingId: string; // TeamsMeeting._id — the stable round-trip key echoed back
  onlineMeetingId: string | null; // Graph online-meeting id (context only, may be null)
  subject: string | null;
  startDateTime: string | null; // ISO-8601
  participants: string[];
  messages: TeamsAiMessageEntry[]; // in-meeting chat
  documents: TeamsAiDocumentEntry[]; // shared files + the transcript
}

export interface TeamsAiChatSection {
  delta: true; // incremental — only new messages; the AI accumulates per channel
  messages: TeamsAiMessageEntry[];
  documents: TeamsAiDocumentEntry[];
}

export interface TeamsAiPayloadBody {
  source: 'teams';
  projectId: string;
  sentAt: string; // ISO-8601
  team: { id: string; name: string };
  channel: { id: string; name: string };
  chat: TeamsAiChatSection;
  meetings: TeamsAiMeetingEntry[];
}

export interface TeamsAiPayload {
  jobType: typeof TEAMS_AI_JOB_TYPE;
  correlationId: string; // "teamsAiJob:<TeamsAiJob._id>"
  payload: TeamsAiPayloadBody;
}

// ---- Inbound (AI → backend) ----

export type TeamsAiResultTarget = 'chat' | 'meeting';

export interface TeamsAiResultItem {
  target: TeamsAiResultTarget;
  meetingId?: string | null; // required when target === 'meeting' (= TeamsMeeting._id)
  summary: string;
  keyPoints?: string[];
  requirements?: string[];
  confidence?: number | null;
}

export interface TeamsAiResultPayload {
  correlationId: string;
  projectId?: string;
  readinessState?: 'READY' | 'NEEDS_INFO' | string;
  results: TeamsAiResultItem[];
  timing?: unknown;
}

// ---- Stored summary (persisted on a meeting / monitored channel) ----

export interface TeamsAiSummary {
  summary: string;
  keyPoints: string[];
  requirements: string[];
  confidence: number | null;
  updatedAt: Date;
}
