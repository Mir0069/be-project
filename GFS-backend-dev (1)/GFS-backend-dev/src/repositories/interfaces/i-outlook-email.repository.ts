import type {
  OutlookLinkMethod,
  OutlookEmailStatus,
  IAIProposedProject,
} from '@db/models/outlook-email.model';

export interface IDomainOutlookEmailAttachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline: boolean;
  isReference: boolean;
  sourceUrl?: string | null;
  downloaded: boolean;
  storageKey?: string | null;
  blobUrl?: string | null;
  stageAttempts?: number;
}

export interface IDomainOutlookEmail {
  id: string;
  messageId: string;
  internetMessageId?: string | null;
  mailboxUserId: string;
  conversationId?: string | null;
  subject?: string | null;
  fromName?: string | null;
  fromAddress?: string | null;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  bodyText: string;
  bodyHtml?: string | null;
  webLink?: string | null;
  receivedDateTime: Date;
  attachments: IDomainOutlookEmailAttachment[];
  projectId?: string | null;
  linkMethod?: OutlookLinkMethod | null;
  routedToPipeline: boolean;
  status: OutlookEmailStatus;
  proposed?: IAIProposedProject | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUpsertOutlookEmailFields {
  messageId: string;
  internetMessageId?: string | null;
  mailboxUserId: string;
  conversationId?: string | null;
  subject?: string | null;
  fromName?: string | null;
  fromAddress?: string | null;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  bodyText: string;
  bodyHtml?: string | null;
  webLink?: string | null;
  receivedDateTime: Date;
  attachments: IDomainOutlookEmailAttachment[];
  projectId?: string | null;
  linkMethod?: OutlookLinkMethod | null;
  routedToPipeline?: boolean;
  status?: OutlookEmailStatus;
  proposed?: IAIProposedProject | null;
}

export interface IListOutlookEmailsFilter {
  projectId?: string;
  mailboxUserId?: string;
  conversationId?: string;
  page?: number;
  limit?: number;
}

export interface IOutlookEmailPage {
  emails: IDomainOutlookEmail[];
  total: number;
}

export interface IOutlookEmailParticipants {
  fromName?: string | null;
  fromAddress?: string | null;
  toRecipients: string[];
  ccRecipients: string[];
  receivedDateTime: Date;
}

export interface IOutlookEmailRepository {
  upsertByMessageId(fields: IUpsertOutlookEmailFields): Promise<IDomainOutlookEmail>;
  findByMessageId(messageId: string): Promise<IDomainOutlookEmail | null>;
  list(filter: IListOutlookEmailsFilter): Promise<IOutlookEmailPage>;
  listParticipantsByProjectId(projectId: string): Promise<IOutlookEmailParticipants[]>;
  setProject(
    messageId: string,
    projectId: string,
    linkMethod: OutlookLinkMethod,
  ): Promise<IDomainOutlookEmail | null>;
  markAttachmentsDownloaded(messageId: string, attachmentIds: string[]): Promise<void>;
  markRoutedToPipeline(messageId: string): Promise<void>;
  // Emails (for a mailbox) that still have a non-inline attachment which failed
  // to stage and hasn't exhausted its retry budget — for the backfill pass.
  findWithUnstagedAttachments(
    mailboxUserId: string,
    maxAttempts: number,
    limit: number,
  ): Promise<IDomainOutlookEmail[]>;
  // Record a successful (re)stage of one attachment.
  setAttachmentStaged(
    messageId: string,
    attachmentId: string,
    storageKey: string,
    blobUrl: string,
  ): Promise<void>;
  // Record a failed stage of one attachment (increments stageAttempts, or sets to specific count).
  recordAttachmentStageFailure(messageId: string, attachmentId: string, attempts?: number): Promise<void>;
}
