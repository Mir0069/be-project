
export type ProjectEmail = {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  preview: string;
  direction: "inbound" | "outbound";
};

export type TeamsThread = {
  id: string;
  title: string;
  lastMessage: string;
  lastMessageBy: string;
  lastMessageDate: string;
  participants: string[];
  messageCount: number;
};

export type CallRecord = {
  id: string;
  title: string;
  participants: string[];
  date: string;
  durationMinutes: number;
  hasTranscript: boolean;
  customerName?: string;
  summaryText?: string;
  transcriptFileUrl?: string;
  transcriptFileName?: string;
  callDate?: string;
};
