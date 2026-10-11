// features/projects/query/documentsQuery.ts

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listDocuments,
  uploadDocument,
  markFinalInput,
  getDownloadUrl,
  previewDocument,
  deleteDocument,
  restoreDocument,
} from "@/services/documents";
import {
  PROJECT_ANALYSIS_POLL_INTERVAL_MS,
  useProjectDetail,
} from "./projectWorkspaceQuery";

export const DOCUMENTS_KEY = (projectId: string) =>
  ["documents", projectId] as const;

/** List all documents for a project. */
export const useDocuments = (projectId: string | undefined) => {
  const { data: project } = useProjectDetail(projectId);

  return useQuery({
    queryKey: DOCUMENTS_KEY(projectId ?? ""),
    queryFn: () => listDocuments(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: project?.analysisStatus === "PROCESSING"
      ? PROJECT_ANALYSIS_POLL_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
};

/** Upload a new document (or replace an existing version). */
export const useUploadDocument = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOCUMENTS_KEY(projectId) });
    },
  });
};

/** Soft-delete a document. */
export const useDeleteDocument = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId }: { documentId: string }) =>
      deleteDocument(documentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOCUMENTS_KEY(projectId) });
    },
  });
};

/** Restore a recently deleted document while it is still in the recovery window. */
export const useRestoreDocument = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId }: { documentId: string }) =>
      restoreDocument(documentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOCUMENTS_KEY(projectId) });
    },
  });
};

/** Toggle the isFinalInput flag. */
export const useMarkFinalInput = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markFinalInput,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOCUMENTS_KEY(projectId) });
    },
  });
};

/** Lazily fetch a signed URL for a document. `inline` yields a preview URL
 *  (renders in-browser) instead of a download URL. */
export const useDownloadUrl = (documentId: string | undefined, inline = false) =>
  useQuery({
    queryKey: ["document-download-url", documentId, inline],
    queryFn: () => getDownloadUrl(documentId!, inline),
    enabled: false, // only called on demand via refetch()
    staleTime: 14 * 60 * 1000, // SAS URLs are valid for 15 min
  });

export const usePreviewDocument = () =>
  useMutation({
    mutationFn: ({ documentId }: { documentId: string }) => previewDocument(documentId),
  });
