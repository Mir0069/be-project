// services/outlook.ts
// Wraps the Outlook emails endpoint.
// The Vite proxy forwards /api/* -> ngrok backend with ngrok-skip-browser-warning header.

import { apiClient } from "@/shared/api/client";
import type {
  OutlookEmail,
  OutlookEmailsResponse,
  OutlookStatus,
} from "@/shared/types/email.types";

export const fetchOutlookEmailsByProject = async (
  projectId: string
): Promise<OutlookEmail[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: OutlookEmailsResponse }>(
    `/outlook/emails`,
    { params: { projectId } }
  );
  return data.data?.emails ?? [];
};

export const fetchAllOutlookEmails = async (params?: {
  page?: number;
  limit?: number;
  mailboxUserId?: string;
  conversationId?: string;
  projectId?: string;
}): Promise<OutlookEmailsResponse> => {
  const { data } = await apiClient.get<{ success: boolean; data: OutlookEmailsResponse }>(
    `/outlook/emails`,
    { params }
  );
  return data.data ?? { emails: [], total: 0 };
};

export const fetchOutlookStatus = async (): Promise<OutlookStatus> => {
  const { data } = await apiClient.get<{ success: boolean; data: OutlookStatus }>(
    `/outlook/status`
  );
  return data.data;
};

export const triggerOutlookSync = async (mailboxDbId?: string): Promise<any> => {
  const { data } = await apiClient.post<{ success: boolean; data: any }>(
    `/outlook/sync`,
    mailboxDbId ? { mailboxDbId } : {}
  );
  return data.data;
};

export const getOutlookAuthUrl = async (): Promise<string> => {
  const { data } = await apiClient.get<{ success: boolean; data: { url: string } }>(
    `/outlook/auth/login`,
    { params: { format: "json" } }
  );
  return data.data.url;
};

export const moveOutlookEmail = async (
  emailId: string,
  targetProjectId: string,
  runExtraction: boolean = true
): Promise<{ email: OutlookEmail; movedDocumentCount: number }> => {
  const { data } = await apiClient.post<{
    success: boolean;
    data: { email: OutlookEmail; movedDocumentCount: number };
  }>(`/outlook/emails/${emailId}/move`, { targetProjectId, runExtraction });
  return data.data;
};

