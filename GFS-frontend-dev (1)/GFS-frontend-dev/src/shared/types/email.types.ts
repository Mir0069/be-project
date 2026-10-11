// shared/types/email.types.ts

export interface OutlookEmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  downloaded: boolean;
  storageKey?: string;
  blobUrl?: string;
  stageAttempts?: number;
}

export interface OutlookEmailProposed {
  isProject: boolean;
  customerName: string;
  projectName: string;
  projectType: string;
  summary: string;
  confidence: number;
  reasoning: string;
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
}

export interface OutlookEmail {
  id: string;
  messageId: string;
  internetMessageId?: string;
  mailboxUserId: string;
  conversationId?: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  toRecipients: string[];
  bodyText?: string;
  bodyHtml?: string;
  webLink?: string;
  receivedDateTime: string;
  attachments: OutlookEmailAttachment[];
  projectId: string;
  linkMethod: string | null;
  routedToPipeline: boolean;
  status: string;
  proposed: OutlookEmailProposed | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutlookEmailsResponse {
  emails: OutlookEmail[];
  total: number;
}

export interface OutlookStatus {
  configured: boolean;
  cachedTokenExpiresAt: string | null;
  monitoredMailboxCount: number;
  accountType: "delegated" | "app_only";
  hasRefreshToken: boolean;
}
