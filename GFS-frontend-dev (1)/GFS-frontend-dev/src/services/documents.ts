// services/documents.ts
// Wraps the verified document API endpoints.
// The Vite proxy forwards /api/* -> backend.

import { apiClient } from "@/shared/api/client";

export interface ApiDocumentMetadata {
  source?: string;
  emailId?: string;
  messageId?: string;
  dropboxPath?: string;
  syncedToDropbox?: boolean;
  [key: string]: unknown;
}

export interface ApiDocument {
  id: string;
  _id?: string;
  projectId: string;
  name?: string;
  originalName: string;
  documentType: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  blobUrl?: string;
  version: number;
  previousVersionId?: string | null;
  isFinalInput: boolean;
  isDeleted: boolean;
  uploadedBy: string;
  uploadedAt: string;
  createdAt?: string;
  updatedAt: string;
  metadata?: ApiDocumentMetadata;
}

/** GET /projects/:projectId/documents */
export const listDocuments = async (
  projectId: string
): Promise<ApiDocument[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: { documents: ApiDocument[] } }>(
    `/projects/${projectId}/documents`
  );
  return data.data?.documents ?? [];
};

/** POST /projects/:projectId/documents (multipart) */
export const uploadDocument = async ({
  projectId,
  file,
  documentType,
  replaceDocumentId,
}: {
  projectId: string;
  file: File;
  documentType: string;
  replaceDocumentId?: string;
}): Promise<ApiDocument> => {
  const form = new FormData();
  form.append("file", file);
  form.append("documentType", documentType);
  if (replaceDocumentId) form.append("replaceDocumentId", replaceDocumentId);

  const { data } = await apiClient.post<{ success: boolean; data: { document: ApiDocument } }>(
    `/projects/${projectId}/documents`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data.data.document;
};

/** PATCH /documents/:documentId/final-input */
export const markFinalInput = async ({
  documentId,
  isFinalInput,
}: {
  documentId: string;
  isFinalInput: boolean;
}): Promise<void> => {
  await apiClient.patch(`/documents/${documentId}/final-input`, { isFinalInput });
};

/** GET /documents/:documentId/download-url */
export const getDownloadUrl = async (
  documentId: string,
  inline = false
): Promise<string> => {
  const { data } = await apiClient.get<{ success: boolean; data: { downloadUrl: string } }>(
    `/documents/${documentId}/download-url`,
    { params: inline ? { inline: 1 } : undefined }
  );
  return data.data.downloadUrl;
};

/** POST /documents/preview -> authenticated document bytes. */
export const previewDocument = async (documentId: string): Promise<Blob> => {
  const { data } = await apiClient.post<Blob>(
    "/documents/preview",
    { documentId },
    { responseType: "blob" },
  );
  return data;
};

/** DELETE /documents/:documentId (recoverable soft-delete) */
export const deleteDocument = async (documentId: string): Promise<ApiDocument> => {
  const { data } = await apiClient.delete<{ success: boolean; data: { document: ApiDocument } }>(
    `/documents/${documentId}`
  );
  return data.data.document;
};

/** POST /documents/:documentId/restore */
export const restoreDocument = async (documentId: string): Promise<ApiDocument> => {
  const { data } = await apiClient.post<{ success: boolean; data: { document: ApiDocument } }>(
    `/documents/${documentId}/restore`
  );
  return data.data.document;
};

/** POST /projects/:projectId/documents/move (bulk move) */
export const moveDocuments = async (
  projectId: string,
  documentIds: string[],
  targetProjectId: string,
  runExtraction: boolean = true
): Promise<{ movedCount: number; documentIds: string[] }> => {
  const { data } = await apiClient.post<{ success: boolean; data: { movedCount: number; documentIds: string[] } }>(
    `/projects/${projectId}/documents/move`,
    { documentIds, targetProjectId, runExtraction }
  );
  return data.data;
};

/** POST /documents/:documentId/move (single move) */
export const moveSingleDocument = async (
  documentId: string,
  targetProjectId: string,
  runExtraction: boolean = true
): Promise<{ movedCount: number; documentIds: string[] }> => {
  const { data } = await apiClient.post<{ success: boolean; data: { movedCount: number; documentIds: string[] } }>(
    `/documents/${documentId}/move`,
    { targetProjectId, runExtraction }
  );
  return data.data;
};
