// ----- Microsoft Graph wire DTOs (subset of fields we use) -----

export interface GraphTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
}

export interface GraphList<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface GraphMailUser {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

export interface GraphMailFolder {
  id: string;
  displayName?: string | null;
  parentFolderId?: string | null;
  totalItemCount?: number;
  unreadItemCount?: number;
}

export interface GraphEmailAddress {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

export interface GraphMailBody {
  contentType?: string;
  content?: string;
}

export interface GraphMailMessage {
  id: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  from?: GraphEmailAddress | null;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  bccRecipients?: GraphEmailAddress[];
  body?: GraphMailBody;
  bodyPreview?: string | null;
  webLink?: string | null;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  // Present on delta entries for deleted messages — such entries carry only
  // the id and must be skipped during ingestion.
  '@removed'?: { reason?: string };
}

// Entry of /users/{id}/messages/{id}/attachments. Only fileAttachment items
// carry downloadable content; itemAttachment/referenceAttachment are skipped.
export interface GraphMailAttachment {
  id: string;
  '@odata.type'?: string;
  name?: string | null;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
  sourceUrl?: string | null;
}

export const FILE_ATTACHMENT_ODATA_TYPE = '#microsoft.graph.fileAttachment';
export const REFERENCE_ATTACHMENT_ODATA_TYPE = '#microsoft.graph.referenceAttachment';

// ----- internal helper shapes -----

export interface DeltaResult<T> {
  items: T[];
  deltaLink: string | null;
}

export interface SyncMailboxResult {
  mailboxUserId: string;
  displayName: string;
  ingested: number;
  attachmentsStaged?: number;
}

export interface OutlookSyncSummary {
  mailboxes: SyncMailboxResult[];
  errors: Array<{ mailboxUserId: string; message: string }>;
}

export interface OutlookStatus {
  configured: boolean;
  cachedTokenExpiresAt: Date | null;
  monitoredMailboxCount: number;
  accountType?: 'delegated' | 'app_only';
  hasRefreshToken?: boolean;
}
