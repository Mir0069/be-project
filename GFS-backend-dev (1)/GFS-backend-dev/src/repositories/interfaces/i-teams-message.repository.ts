import type { TeamsLinkMethod } from '@db/models/teams-message.model';

export interface IDomainTeamsMessageAttachment {
  id: string;
  name?: string | null;
  contentType?: string | null;
  contentUrl?: string | null;
  downloaded: boolean;
}

export interface IDomainTeamsMessage {
  id: string;
  messageId: string;
  teamId: string;
  channelId: string;
  parentMessageId?: string | null;
  fromName?: string | null;
  fromId?: string | null;
  contentText: string;
  contentHtml?: string | null;
  webUrl?: string | null;
  createdDateTime: Date;
  attachments: IDomainTeamsMessageAttachment[];
  projectId?: string | null;
  linkMethod?: TeamsLinkMethod | null;
  routedToPipeline: boolean;
  sentToAI: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUpsertTeamsMessageFields {
  messageId: string;
  teamId: string;
  channelId: string;
  parentMessageId?: string | null;
  fromName?: string | null;
  fromId?: string | null;
  contentText: string;
  contentHtml?: string | null;
  webUrl?: string | null;
  createdDateTime: Date;
  attachments: IDomainTeamsMessageAttachment[];
  projectId?: string | null;
  linkMethod?: TeamsLinkMethod | null;
  routedToPipeline?: boolean;
}

export interface IListTeamsMessagesFilter {
  projectId?: string;
  channelId?: string;
  // Match messages from any of these channels (used to show a shared channel's
  // conversation to every project it's linked to).
  channelIds?: string[];
  page?: number;
  limit?: number;
}

export interface ITeamsMessagePage {
  messages: IDomainTeamsMessage[];
  total: number;
}

export interface ITeamsMessageRepository {
  upsertByMessageId(fields: IUpsertTeamsMessageFields): Promise<IDomainTeamsMessage>;
  findByMessageId(messageId: string): Promise<IDomainTeamsMessage | null>;
  listByParentMessageId(parentMessageId: string): Promise<IDomainTeamsMessage[]>;
  // Messages on a channel not yet dispatched to the AI queue (oldest first).
  listUnsentByChannelId(channelId: string): Promise<IDomainTeamsMessage[]>;
  markSentToAI(messageIds: string[]): Promise<void>;
  list(filter: IListTeamsMessagesFilter): Promise<ITeamsMessagePage>;
  setProject(
    messageId: string,
    projectId: string,
    linkMethod: TeamsLinkMethod,
  ): Promise<IDomainTeamsMessage | null>;
  markAttachmentsDownloaded(messageId: string, attachmentIds: string[]): Promise<void>;
  markRoutedToPipeline(messageId: string): Promise<void>;
}
