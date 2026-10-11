// features/comms/query/commsQuery.ts

import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/providers/QueryProvider";

import {
  fetchProjectEmails,
  fetchProjectTeams,
  fetchProjectCalls,
  deleteCallRecord,
  uploadCallRecordAudio,
  createCallRecordText,
  updateCallRecord,
} from "@/services/comms";

export const useProjectEmails = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["comms", "emails", projectId],
    queryFn: () => fetchProjectEmails(projectId!),
    enabled: !!projectId,
    refetchOnMount: "always",
  });

export const useProjectTeams = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["comms", "teams", projectId],
    queryFn: () => fetchProjectTeams(projectId!),
    enabled: !!projectId,
    refetchOnMount: "always",
  });

export const useProjectCalls = (projectId: string | undefined) =>
  useQuery({
    queryKey: ["comms", "calls", projectId],
    queryFn: () => fetchProjectCalls(projectId!),
    enabled: !!projectId,
    refetchOnMount: "always",
  });

export const useDeleteCallRecord = (projectId: string | undefined) =>
  useMutation({
    mutationFn: (recordId: string) => deleteCallRecord(projectId!, recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comms", "calls", projectId] });
    },
  });

export const useUploadCallRecordAudio = (projectId: string | undefined) =>
  useMutation({
    mutationFn: (file: File) => uploadCallRecordAudio(projectId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comms", "calls", projectId] });
    },
  });

export const useCreateCallRecordText = (projectId: string | undefined) =>
  useMutation({
    mutationFn: ({ customerName, summaryText, transcriptFileName }: { customerName: string; summaryText: string; transcriptFileName?: string }) =>
      createCallRecordText(projectId!, customerName, summaryText, transcriptFileName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comms", "calls", projectId] });
    },
  });

export const useUpdateCallRecord = (projectId: string | undefined) =>
  useMutation({
    mutationFn: ({ recordId, fields }: { recordId: string; fields: { transcriptFileName?: string; customerName?: string } }) =>
      updateCallRecord(projectId!, recordId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comms", "calls", projectId] });
    },
  });
