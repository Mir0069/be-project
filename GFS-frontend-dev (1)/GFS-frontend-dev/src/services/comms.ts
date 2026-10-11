

import { apiClient } from "@/shared/api/client";
import type {
  CallRecord,
  ProjectEmail,
  TeamsThread,
} from "@/shared/types/comms.types";



const DEFAULT_EMAILS: ProjectEmail[] = [
  {
    id: "em-d-1",
    subject: "Project kickoff — next steps",
    from: "sales@gfs.com",
    to: "client@example.com",
    date: "May 14, 2026 09:20 AM",
    preview:
      "Thanks for the call yesterday. Attaching the kickoff deck and the proposed timeline for review…",
    direction: "outbound",
  },
  {
    id: "em-d-2",
    subject: "Re: Site dimensions",
    from: "client@example.com",
    to: "sales@gfs.com",
    date: "May 12, 2026 03:48 PM",
    preview:
      "Confirmed dimensions are attached. Architect will be on-site Thursday if you want to walk through…",
    direction: "inbound",
  },
];

const MOCK_EMAILS: Record<string, ProjectEmail[]> = {
  "p-1": [
    {
      id: "em-1-1",
      subject: "[Apex] Bridge specs + load requirements",
      from: "mahil.doe@apexconstruction.com",
      to: "sales@gfs.com",
      date: "May 15, 2026 10:42 AM",
      preview:
        "Sending over the structural load requirements and the tower spacing measurements as discussed…",
      direction: "inbound",
    },
    {
      id: "em-1-2",
      subject: "Re: Laminated structural glass quote",
      from: "sales@gfs.com",
      to: "mahil.doe@apexconstruction.com",
      date: "May 14, 2026 02:15 PM",
      preview:
        "Quote attached for the 40m span using laminated structural glass with stainless-steel anchors…",
      direction: "outbound",
    },
    {
      id: "em-1-3",
      subject: "Site survey scheduling",
      from: "sales@gfs.com",
      to: "mahil.doe@apexconstruction.com",
      date: "May 11, 2026 11:00 AM",
      preview:
        "Proposing three windows for the on-site survey next week. Please confirm which works…",
      direction: "outbound",
    },
  ],
  "p-2": [
    {
      id: "em-2-1",
      subject: "Final acceptance — Downtown Frames",
      from: "sevil.doe@sciconstruction.com",
      to: "sales@gfs.com",
      date: "Apr 28, 2026 04:55 PM",
      preview:
        "Acceptance signed and attached. Great work from the install crew, thank you…",
      direction: "inbound",
    },
    {
      id: "em-2-2",
      subject: "Re: Punchlist items",
      from: "sales@gfs.com",
      to: "sevil.doe@sciconstruction.com",
      date: "Apr 24, 2026 10:30 AM",
      preview:
        "Two items left from the punchlist — both scheduled for end of week. Photo confirmation will follow…",
      direction: "outbound",
    },
  ],
};

const DEFAULT_TEAMS: TeamsThread[] = [
  {
    id: "tm-d-1",
    title: "Project kickoff channel",
    lastMessage: "Shared the kickoff deck — let me know if anything's missing.",
    lastMessageBy: "Sales Manager",
    lastMessageDate: "May 14, 2026 10:05 AM",
    participants: ["Sales Manager", "Client POC", "Estimator User"],
    messageCount: 18,
  },
  {
    id: "tm-d-2",
    title: "Design discussion",
    lastMessage: "Latest render is in the files tab — feedback welcome.",
    lastMessageBy: "Drafter",
    lastMessageDate: "May 12, 2026 04:21 PM",
    participants: ["Drafter", "Architect", "Sales Manager"],
    messageCount: 7,
  },
];

const MOCK_TEAMS: Record<string, TeamsThread[]> = {
  "p-1": [
    {
      id: "tm-1-1",
      title: "Miami Glass Bridge — Coordination",
      lastMessage:
        "Architect confirmed cable anchor specs. Pinging engineering for sign-off.",
      lastMessageBy: "Helene Park",
      lastMessageDate: "May 15, 2026 11:48 AM",
      participants: ["Sales Manager", "Helene Park", "Jamie Liu", "Mahil Doe"],
      messageCount: 42,
    },
    {
      id: "tm-1-2",
      title: "Site survey logistics",
      lastMessage: "Confirmed Wed 10am. I'll bring the laser measurement kit.",
      lastMessageBy: "Sales Manager",
      lastMessageDate: "May 13, 2026 02:30 PM",
      participants: ["Sales Manager", "Mahil Doe"],
      messageCount: 9,
    },
  ],
  "p-3": [
    {
      id: "tm-3-1",
      title: "Uptown Tech Hub — Discovery",
      lastMessage: "Sharing the preliminary structural compliance docs now.",
      lastMessageBy: "Sales Manager",
      lastMessageDate: "May 12, 2026 09:35 AM",
      participants: ["Sales Manager", "David Lee"],
      messageCount: 14,
    },
  ],
};

const DEFAULT_CALLS: CallRecord[] = [
  {
    id: "cr-d-1",
    title: "Kickoff call",
    participants: ["Sales Manager", "Client POC"],
    date: "May 13, 2026 02:00 PM",
    durationMinutes: 45,
    hasTranscript: true,
  },
  {
    id: "cr-d-2",
    title: "Quick check-in",
    participants: ["Sales Manager", "Client POC"],
    date: "May 09, 2026 11:00 AM",
    durationMinutes: 18,
    hasTranscript: false,
  },
];

const MOCK_CALLS: Record<string, CallRecord[]> = {
  "p-1": [
    {
      id: "cr-1-1",
      title: "Bridge design review with Apex + architect",
      participants: ["Sales Manager", "Mahil Doe", "Helene Park"],
      date: "May 14, 2026 03:30 PM",
      durationMinutes: 62,
      hasTranscript: true,
    },
    {
      id: "cr-1-2",
      title: "Initial scope call",
      participants: ["Sales Manager", "Mahil Doe"],
      date: "Apr 30, 2026 11:00 AM",
      durationMinutes: 38,
      hasTranscript: true,
    },
  ],
};

const simulate = <T>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), 200));
// --- END MOCK DATA ----------------------------------------------------------

export const fetchProjectEmails = async (
  projectId: string
): Promise<ProjectEmail[]> => {
  try {
    const { fetchOutlookEmailsByProject } = await import("@/services/outlook");
    const realEmails = await fetchOutlookEmailsByProject(projectId);
    if (realEmails && realEmails.length > 0) {
      return realEmails.map((e) => ({
        id: e.id || e.messageId,
        subject: e.subject || "(No subject)",
        from: `${e.fromName || "Unknown"} <${e.fromAddress || ""}>`,
        to: e.toRecipients?.join(", ") || "",
        date: e.receivedDateTime
          ? new Date(e.receivedDateTime).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "",
        preview: e.bodyText?.slice(0, 150) || e.subject || "",
        direction: e.fromAddress?.toLowerCase().includes("gfs.com") ? "outbound" : "inbound",
      }));
    }
  } catch (err) {
    console.warn("fetchOutlookEmailsByProject failed, using fallback:", err);
  }
  return simulate(MOCK_EMAILS[projectId] ?? DEFAULT_EMAILS);
};

export const fetchProjectTeams = async (
  projectId: string
): Promise<TeamsThread[]> => {
  // BACKEND:
  // const { data } = await apiClient.get<ApiResponse<TeamsThread[]>>(
  //   `/projects/${projectId}/teams`
  // );
  // return data.data ?? [];
  return simulate(MOCK_TEAMS[projectId] ?? DEFAULT_TEAMS);
};

export const fetchProjectCalls = async (
  projectId: string
): Promise<CallRecord[]> => {
  const { data } = await apiClient.get<{
    success: boolean;
    data: {
      callRecords: any[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };
  }>(`/projects/${projectId}/call-records`);

  const records = data.data.callRecords ?? [];
  return records.map((r: any) => ({
    ...r,
    id: r._id || r.id,
    title: `Call with ${r.customerName || "Customer"}`,
    participants: [r.customerName || "Customer"],
    date: r.callDate
      ? new Date(r.callDate).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    durationMinutes: 0,
    hasTranscript: !!r.summaryText || !!r.transcriptFileUrl,
  }));
};

export const deleteCallRecord = async (
  projectId: string,
  recordId: string
): Promise<void> => {
  await apiClient.delete(`/projects/${projectId}/call-records/${recordId}`);
};

export const uploadCallRecordAudio = async (
  projectId: string,
  file: File
): Promise<any> => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post(
    `/projects/${projectId}/call-records/upload-audio`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );
  return data.data;
};

export const createCallRecordText = async (
  projectId: string,
  customerName: string,
  summaryText: string,
  transcriptFileName?: string
): Promise<any> => {
  const { data } = await apiClient.post(
    `/projects/${projectId}/call-records`,
    {
      callDate: new Date().toISOString(),
      customerName,
      summaryText,
      transcriptFileName,
    }
  );
  return data.data;
};

export const updateCallRecord = async (
  projectId: string,
  recordId: string,
  fields: { transcriptFileName?: string; customerName?: string }
): Promise<any> => {
  const { data } = await apiClient.patch(
    `/projects/${projectId}/call-records/${recordId}`,
    fields
  );
  return data.data;
};
