import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/shared/api/client";
import { PROJECT_WORKSPACE_KEY } from "@/features/projects/query/projectWorkspaceQuery";

export interface DraftProject {
  id: string;
  messageId: string;
  subject?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  receivedDateTime: string;
  address?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  proposed?: {
    projectName?: string | null;
    customerName?: string | null;
    summary?: string | null;
    reasoning?: string | null;
    companyName?: string | null;
    groupId?: string | null;
    isCompetitiveBid?: boolean;
    primaryBidderEmail?: string | null;
    allBidders?: Array<{
      email?: string | null;
      company?: string | null;
      isPrimary?: boolean;
    }> | null;
    allAddresses?: Array<{
      address: string;
      type: "INSTALLATION" | "BILLING" | "UNKNOWN";
    }> | null;
  } | null;
  attachments?: Array<{
    name?: string | null;
    originalName?: string | null;
    // Opaque key used to request the bytes back through the API. The Azure blob
    // URL is deliberately never sent to the browser.
    storageKey?: string | null;
  }>;
}

export interface MailFirstApprovalResult {
  zohoLeadId: string | null;
  projectId: string | null;
  alreadyProcessed: boolean;
  allProjectIds?: string[];
}

export interface LinkableProject {
  projectId: string;
  referenceNumber: string;
  projectName: string;
  customerName?: string | null;
  customerEmail?: string | null;
  jobAddress?: string | null;
  address?: string | Record<string, unknown> | null;
}

export const useDrafts = () =>
  useQuery<DraftProject[]>({
    queryKey: ["drafts"],
    queryFn: async () => {
      const res = await apiClient.get("/mail-first/drafts");
      return res.data.data as DraftProject[];
    },
  });

/** Fetches a draft attachment's bytes through the API.
 *  Going through the backend keeps the Azure storage URL out of the browser and
 *  avoids a direct cross-origin fetch of the blob, which the storage account
 *  blocks because it publishes no CORS rules. */
export const usePreviewDraftAttachment = () =>
  useMutation({
    mutationFn: async ({
      emailId,
      storageKey,
    }: {
      emailId: string;
      storageKey: string;
    }) => {
      const res = await apiClient.post<Blob>(
        `/mail-first/drafts/${emailId}/attachments/preview`,
        { storageKey },
        { responseType: "blob" },
      );
      return res.data;
    },
  });

export const useLinkableProjects = (enabled: boolean) =>
  useQuery<LinkableProject[]>({
    queryKey: ["project-workspace", "ai-context"],
    enabled,
    queryFn: async () => {
      const res = await apiClient.get("/project-workspace/ai-context");
      return (res.data.data ?? []) as LinkableProject[];
    },
  });

export const useApproveDraft = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (emailId: string) => {
      const res = await apiClient.post(`/mail-first/drafts/${emailId}/approve`);
      return res.data.data as MailFirstApprovalResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: PROJECT_WORKSPACE_KEY });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["outlook-emails"] });
    },
  });
};

export const useRejectDraft = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ emailId, reason }: { emailId: string; reason: "IRRELEVANT_SPAM" }) => {
      const res = await apiClient.post(`/mail-first/drafts/${emailId}/reject`, { reason });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

export const useLinkDraftToProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ emailId, projectId }: { emailId: string; projectId: string }) => {
      await apiClient.post(`/mail-first/drafts/${emailId}/link`, { projectId });
      return { emailId, projectId };
    },
    onSuccess: ({ projectId }) => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: PROJECT_WORKSPACE_KEY });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["outlook-emails", projectId] });
      qc.invalidateQueries({ queryKey: ["outlook-emails"] });
    },
  });
};

export const useUpdateDraftProjectName = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ emailId, projectName }: { emailId: string; projectName: string }) => {
      const res = await apiClient.patch(`/mail-first/drafts/${emailId}`, { projectName });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drafts"] });
    },
  });
};
