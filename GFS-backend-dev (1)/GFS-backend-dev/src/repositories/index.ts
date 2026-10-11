import { MongooseUserRepository } from './mongoose/user.repository';
import { MongooseZohoTokenRepository } from './mongoose/zoho-token.repository';
import { MongooseProjectRepository } from './mongoose/project.repository';
import { MongooseCallRecordRepository } from './mongoose/call-record.repository';
import { MongooseTeamsTokenRepository } from './mongoose/teams-token.repository';
import { MongooseTeamsMonitoredChannelRepository } from './mongoose/teams-monitored-channel.repository';
import { MongooseTeamsProvisionOutboxRepository } from './mongoose/teams-provision-outbox.repository';
import { MongooseTeamsProjectMemberRepository } from './mongoose/teams-project-member.repository';
import { MongooseTeamsMessageRepository } from './mongoose/teams-message.repository';
import { MongooseTeamsTranscriptRepository } from './mongoose/teams-transcript.repository';
import { MongooseTeamsMeetingRepository } from './mongoose/teams-meeting.repository';
import { MongooseTeamsAiJobRepository } from './mongoose/teams-ai-job.repository';
import { MongooseTeamsSubscriptionRepository } from './mongoose/teams-subscription.repository';
import { MongoosePasswordResetTokenRepository } from './mongoose/password-reset-token.repository';
import { MongooseSequenceRepository } from './mongoose/sequence.repository';
import { MongooseOutlookTokenRepository } from './mongoose/outlook-token.repository';
import { MongooseOutlookMonitoredMailboxRepository } from './mongoose/outlook-monitored-mailbox.repository';
import { MongooseOutlookEmailRepository } from './mongoose/outlook-email.repository';
import { MongooseProposalRepository } from './mongoose/proposal.repository';
import { MongooseExcelTemplateRepository } from './mongoose/excel-template.repository';
import { MongooseNotificationRepository } from './mongoose/notification.repository';
import { MongooseCloudLinkAssetRepository } from './mongoose/cloud-link-asset.repository';
import { MongooseDocumentRepository } from './mongoose/document.repository';
import { DocumentIngestionPipeline } from '../features/document-ingestion/document-ingestion.service';
import { AzureContentAddressedBlobStorage } from '../features/document-ingestion/document-ingestion.service';
import { persistentAuditLogger } from '@features/audit-logs/audit-logs.logger';
import { RoleBasedPermissionService } from '@features/document-ingestion/permission.service';
import { env } from '@config/index';

export const documentRepository = new MongooseDocumentRepository();
const blobStorage = new AzureContentAddressedBlobStorage({
  connectionString: env.azure.storageConnectionString,
  containerName: env.azure.storageContainerName || 'documents'
});

const permissionService = new RoleBasedPermissionService();
const auditLogger = persistentAuditLogger;

export const documentIngestion = new DocumentIngestionPipeline({
  repository: documentRepository,
  storage: blobStorage,
  permissions: permissionService,
  audit: auditLogger
});

export const userRepository = new MongooseUserRepository();
export const zohoTokenRepository = new MongooseZohoTokenRepository();
export const projectRepository = new MongooseProjectRepository();
export const callRecordRepository = new MongooseCallRecordRepository();
export const teamsTokenRepository = new MongooseTeamsTokenRepository();
export const teamsMonitoredChannelRepository = new MongooseTeamsMonitoredChannelRepository();
export const teamsProvisionOutboxRepository = new MongooseTeamsProvisionOutboxRepository();
export const teamsProjectMemberRepository = new MongooseTeamsProjectMemberRepository();
export const teamsMessageRepository = new MongooseTeamsMessageRepository();
export const teamsTranscriptRepository = new MongooseTeamsTranscriptRepository();
export const teamsMeetingRepository = new MongooseTeamsMeetingRepository();
export const teamsAiJobRepository = new MongooseTeamsAiJobRepository();
export const teamsSubscriptionRepository = new MongooseTeamsSubscriptionRepository();
export const passwordResetTokenRepository = new MongoosePasswordResetTokenRepository();
export const sequenceRepository = new MongooseSequenceRepository();
export const outlookTokenRepository = new MongooseOutlookTokenRepository();
export const outlookMonitoredMailboxRepository = new MongooseOutlookMonitoredMailboxRepository();
export const outlookEmailRepository = new MongooseOutlookEmailRepository();
export const proposalRepository = new MongooseProposalRepository();
export const excelTemplateRepository = new MongooseExcelTemplateRepository();

export const notificationRepository = new MongooseNotificationRepository();
export const cloudLinkAssetRepository = new MongooseCloudLinkAssetRepository();
