export interface MailFirstApprovalResult {
  zohoLeadId: string | null;
  projectId: string | null;
  alreadyProcessed: boolean;
  allProjectIds?: string[]; // For competitive bidding - all created project IDs
}

export interface ZohoInsertResponse {
  data?: Array<{
    code?: string;
    status?: string;
    message?: string;
    details?: { id?: string };
  }>;
}
