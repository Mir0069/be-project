// features/zoho/query/zohoQuery.ts

import { useQuery } from "@tanstack/react-query";

import {
  fetchZohoLeads,
  fetchZohoLeadById,
  fetchZohoLeadNotes,
} from "@/services/zoho";

// List of Zoho leads
export const useZohoLeads = () =>
  useQuery({
    queryKey: ["zoho", "leads"],
    queryFn: fetchZohoLeads,
  });

// Single Zoho lead by id
export const useZohoLead = (
  id: string | undefined
) =>
  useQuery({
    queryKey: ["zoho", "lead", id],
    queryFn: () => fetchZohoLeadById(id!),
    enabled: !!id,
  });

// Notes for a Zoho lead (real data from the backend)
export const useZohoNotes = (
  zohoLeadId: string | undefined | null
) =>
  useQuery({
    queryKey: ["zoho", "notes", zohoLeadId],
    queryFn: () => fetchZohoLeadNotes(zohoLeadId!),
    enabled: !!zohoLeadId,
  });
