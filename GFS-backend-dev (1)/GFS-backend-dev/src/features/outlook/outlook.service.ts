import crypto from 'crypto';
import path from 'path';
import mongoose from 'mongoose';
import { ProjectType } from '@db/models/project.model';
import { DocumentModel } from '@db/models/document.model';
import { env } from '@config/index';
import unzipper from 'unzipper';
import type { CloudLinkService } from '@services/cloud-link.service';
import { OUTLOOK_SYSTEM_USER_ID, OUTLOOK_SYSTEM_USER_ROLES } from './pipeline-document-ingestion.adapter';
import { dropboxSyncService } from '@features/projects/dropbox-sync.service';
import { proposalService } from '@features/proposal/proposal.router'; // NEW: needed to trigger Stage 0 extraction
import { PendingApprovalService } from '@features/proposal/pending-approval.service';
import { ChangeSource, PendingChangeApprovalModel, ApprovalStatus } from '@db/models/pending-change-approval.model';

import { StatusCodes } from 'http-status-codes';

import type { BlobStorage } from '@features/document-ingestion/document-ingestion.types';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import { encodeShareUrl, fetchGraphShareItem, getGraphShareFileStream } from '@shared/utils/graph';
import type {
  IOutlookMonitoredMailboxRepository,
  IDomainMonitoredMailbox,
} from '@repositories/interfaces/i-outlook-monitored-mailbox.repository';
import type { IOutlookStoredToken } from '@repositories/interfaces/i-outlook-token.repository';
import type {
  IOutlookEmailRepository,
  IDomainOutlookEmail,
  IDomainOutlookEmailAttachment,
  IOutlookEmailPage,
  IListOutlookEmailsFilter,
} from '@repositories/interfaces/i-outlook-email.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';
import { refreshExternalContactsForProject } from '@features/project-workspace/external-contacts';

import type { IOutlookGraphClient } from './outlook.graph-client';
import type { OutlookTokenService } from './outlook-token.service';
import type { OutlookAssociationService } from './outlook-association.service';
import type { IDocumentIngestionPort, EmailPackageAttachment } from './document-ingestion.port';
import { describeError } from './outlook.errors';
import {
  FILE_ATTACHMENT_ODATA_TYPE,
  REFERENCE_ATTACHMENT_ODATA_TYPE,
  type GraphList,
  type GraphMailAttachment,
  type GraphMailFolder,
  type GraphMailMessage,
  type GraphMailUser,
  type OutlookStatus,
  type OutlookSyncSummary,
  type SyncMailboxResult,
} from './outlook.types';

// Lifetime of the SAS URLs handed to the AI worker in the email package.
const EMAIL_PACKAGE_SAS_TTL_MIN = 60;

// Attachment staging retry/backfill tuning.
const MAX_STAGE_ATTEMPTS = 5; // give up (and stop re-trying) after this many fails
const BACKFILL_BATCH = 50; // emails re-checked per mailbox sync

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The AI worker may emit projectType in loose forms ("NEW ESTIMATE", "new-estimate").
// Coerce to the schema enum so persisting the draft — and later approving it,
// which runs full-document validation — never fails on a stray value.
const normalizeProjectType = (value: unknown): ProjectType => {
  const key = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (Object.values(ProjectType) as string[]).includes(key)
    ? (key as ProjectType)
    : ProjectType.NEW_ESTIMATE;
};

// Retry only transient failures (rate limit, 5xx, network blips), with
// exponential backoff. Fatal errors (401/403/404) fail fast.
const isTransientError = (err: unknown): boolean => {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number }; code?: string };
  const status = e.statusCode ?? e.status ?? e.response?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500 && status <= 599)) return true;
  return e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED';
};

export const isDeltaTokenExpired = (err: unknown): boolean => {
  if (err instanceof AppError) {
    if (err.statusCode === StatusCodes.GONE) return true;
    const details = typeof err.details === 'string' ? err.details : JSON.stringify(err.details ?? '');
    if (/SyncStateNotFound|resyncRequired/i.test(details) || /SyncStateNotFound|resyncRequired/i.test(err.message)) {
      return true;
    }
  }
  const e = err as { statusCode?: number; status?: number; response?: { status?: number; data?: any }; message?: string };
  const status = e.statusCode ?? e.status ?? e.response?.status;
  if (status === StatusCodes.GONE || status === 410) return true;
  const msg = `${e.message ?? ''} ${JSON.stringify(e.response?.data ?? '')}`;
  return /SyncStateNotFound|resyncRequired/i.test(msg);
};

const withRetry = async <T>(
  op: () => Promise<T>,
  label: string,
  maxRetries = 3,
  baseDelayMs = 500,
): Promise<T> => {
  let attempt = 1;
  for (;;) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= maxRetries || !isTransientError(err)) throw err;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[OutlookService] transient error in ${label} (attempt ${attempt}/${maxRetries}); retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
      attempt += 1;
    }
  }
};

// Fields requested from the Graph mail delta endpoint. Body is included so a
// single delta round-trip yields everything needed for ingestion.
const DELTA_SELECT_FIELDS = [
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'bccRecipients',
  'body',
  'bodyPreview',
  'receivedDateTime',
  'webLink',
  'hasAttachments',
  'isDraft',
  'conversationId',
  'internetMessageId',
].join(',');

export interface AddMonitoredMailboxInput {
  userId: string;
  displayName: string;
  folderId?: string;
  projectId?: string;
}

const htmlToText = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

export class OutlookService {
  private readonly graphClient: IOutlookGraphClient;
  private readonly tokenService: OutlookTokenService;
  private readonly monitoredMailboxRepository: IOutlookMonitoredMailboxRepository;
  private readonly emailRepository: IOutlookEmailRepository;
  private readonly associationService: OutlookAssociationService;
  private readonly projectRepository: IProjectRepository;
  // Hands each email to the document-ingestion side as one package (ingestEmailPackage).
  private readonly documentPort: IDocumentIngestionPort;
  // Optional blob storage used to stage attachment bytes (streamed) at ingestion
  // time, before any project exists. When absent, staging is skipped.
  private readonly blobStorage?: BlobStorage;
  // Delete the message from the mailbox after a fully-successful ingest. Requires
  // the app to hold Mail.ReadWrite.
  private readonly deleteAfterIngest: boolean;
  private readonly cloudLinkService?: CloudLinkService;
  private readonly notificationService?: any;
  private readonly pendingApprovalService?: PendingApprovalService;

  public constructor(
    graphClient: IOutlookGraphClient,
    tokenService: OutlookTokenService,
    monitoredMailboxRepository: IOutlookMonitoredMailboxRepository,
    emailRepository: IOutlookEmailRepository,
    associationService: OutlookAssociationService,
    projectRepository: IProjectRepository,
    documentPort: IDocumentIngestionPort,
    blobStorage?: BlobStorage,
    deleteAfterIngest = false,
    cloudLinkService?: CloudLinkService,
    notificationService?: any,
    pendingApprovalService?: PendingApprovalService
  ) {
    this.graphClient = graphClient;
    this.tokenService = tokenService;
    this.monitoredMailboxRepository = monitoredMailboxRepository;
    this.emailRepository = emailRepository;
    this.associationService = associationService;
    this.projectRepository = projectRepository;
    this.documentPort = documentPort;
    this.blobStorage = blobStorage;
    this.deleteAfterIngest = deleteAfterIngest;
    this.cloudLinkService = cloudLinkService;
    this.notificationService = notificationService;
    this.pendingApprovalService = pendingApprovalService;
  }

 
  public async processAiResult(payload: any): Promise<void> {
    console.log(`[Webhook] Received AI Result for correlationId: ${payload.correlationId}`);
    const correlationIdStr = String(payload.correlationId || '');
    const parts = correlationIdStr.split(':');
    const actualEmailId = (parts.length > 1 && parts[1]) ? parts[1].trim() : correlationIdStr;

    if (!actualEmailId) {
      console.error('[OutlookService] processAiResult called without valid emailId in correlationId:', payload.correlationId);
      return;
    }

    const updatedEmail = await mongoose.model('OutlookEmail').findById(actualEmailId).catch(() => null);

    // Determine target project ID from payload or existing email record
    const targetProjectIdRaw = payload.projectId || payload.proposed?.projectId || payload.project_id || updatedEmail?.projectId;
    const targetProjectId = (targetProjectIdRaw && mongoose.Types.ObjectId.isValid(String(targetProjectIdRaw)))
      ? new mongoose.Types.ObjectId(String(targetProjectIdRaw))
      : targetProjectIdRaw;

    // --- 1. SPAM / NOT PROJECT HANDLING ---
    if (payload.proposed?.isProject === false || payload.action === 'DISCARD') {
      if (updatedEmail) {
        await mongoose.model('OutlookEmail').findByIdAndUpdate(actualEmailId, {
          status: 'DISCARDED',
          proposed: {
            isProject: false,
            customerName: payload.proposed?.customerName,
            projectName: payload.proposed?.projectName,
            summary: payload.proposed?.summary,
            confidence: payload.proposed?.confidence,
            reasoning: payload.proposed?.reasoning
          }
        }).catch(e => console.log('Discard update skipped:', e.message));

        // Permanently purge spam email from mailbox
        if (this.deleteAfterIngest && updatedEmail.mailboxUserId && updatedEmail.messageId) {
          try {
            await this.graphClient.permanentDelete(updatedEmail.mailboxUserId, updatedEmail.messageId);
            console.log(`[OutlookService] Permanently purged spam email ${updatedEmail.messageId} from mailbox ${updatedEmail.mailboxUserId}`);
          } catch (err) {
            const errStr = describeError(err);
            if (!/ErrorItemNotFound|HTTP 404/i.test(errStr)) {
              console.warn(`[OutlookService] Failed to purge spam email from mailbox: ${errStr}`);
            }
          }
        }
      }
      return;
    }

    // --- 2. EXISTING PROJECT / PENDING APPROVAL FLOW ---
    const isExistingProject = Boolean(targetProjectId) || payload.action === 'LINK' || payload.action === 'UPDATE';

    if (isExistingProject && targetProjectId) {
      const projIdStr = String(targetProjectId);
      const matchedDocumentIds: string[] = [];

      if (updatedEmail) {
        await mongoose.model('OutlookEmail').findByIdAndUpdate(actualEmailId, {
          status: 'CONFIRMED',
          linkMethod: 'AUTO',
          projectId: targetProjectId,
          proposed: {
            isProject: true,
            summary: payload.proposed?.summary || payload.summary,
            reasoning: payload.proposed?.reasoning || payload.reasoning,
            confidence: payload.proposed?.confidence || payload.confidence
          }
        }, { new: true }).catch(e => console.error('Failed to update email status to CONFIRMED:', e));
      }

      // Link attachment documents
      if (updatedEmail && updatedEmail.attachments && updatedEmail.attachments.length > 0) {
        const storageKeys = updatedEmail.attachments.map((att: any) => att.storageKey).filter(Boolean);
        if (storageKeys.length > 0) {
          const matched = await mongoose.model('Document')
            .find({ storageKey: { $in: storageKeys } }, { _id: 1 })
            .lean()
            .catch(() => []);
          matchedDocumentIds.push(...matched.map((d: any) => String(d._id)));

          await mongoose.model('Document').updateMany(
            { storageKey: { $in: storageKeys } },
            { $set: { projectId: targetProjectId, status: 'PROCESSED', isActive: true } }
          ).catch(err => console.error('Failed to link attachments to project:', err));
        }
      }

      // Link cloud-resolved documents
      const matchedCloud = await DocumentModel.find({ 'metadata.emailId': actualEmailId }, { _id: 1 })
        .lean()
        .catch(() => []);
      matchedDocumentIds.push(...matchedCloud.map((d: any) => String(d._id)));

      await DocumentModel.updateMany(
        { 'metadata.emailId': actualEmailId },
        { $set: { projectId: targetProjectId, status: 'PROCESSED', isActive: true } }
      ).catch(err => console.error('Failed to link cloud documents to project:', err));

      // Link email body text document (email-{messageId}.txt)
      if (updatedEmail) {
        const messageIds = [updatedEmail.messageId, updatedEmail.internetMessageId].filter(Boolean);
        const matchedBodyDocs = await DocumentModel.find({
          $or: [
            { 'metadata.emailId': actualEmailId },
            { 'metadata.messageId': { $in: messageIds } },
            { originalName: { $regex: new RegExp(`email-${actualEmailId}|email-${updatedEmail.messageId}`, 'i') } }
          ]
        }, { _id: 1 }).lean().catch(() => []);

        const bodyDocIds = matchedBodyDocs.map((d: any) => String(d._id));
        matchedDocumentIds.push(...bodyDocIds);

        await DocumentModel.updateMany(
          { _id: { $in: matchedBodyDocs.map((d: any) => d._id) } },
          { $set: { projectId: targetProjectId, status: 'PROCESSED', isActive: true } }
        ).catch(err => console.error('Failed to link body text doc to project:', err));
      }

      const uniqueDocumentIds = [...new Set(matchedDocumentIds)];

      // Keep the project contact snapshot current after automatic email linking.
      // Contact persistence must not block the core email-linking workflow.
      void refreshExternalContactsForProject(
        projIdStr,
        this.projectRepository,
        this.emailRepository,
      ).catch((err) => console.error(`[OutlookService] external contact refresh failed for ${projIdStr}:`, err));

      // Trigger outward Dropbox sync
      this.projectRepository.findById(projIdStr).then((project) => {
        if (project) {
          dropboxSyncService.outwardSync(project).catch((err) =>
            console.error(`[OutlookService] outwardSync failed for project ${projIdStr}:`, err)
          );
        }
      }).catch(() => {});

      if (this.notificationService && updatedEmail) {
        const project = await this.projectRepository.findById(projIdStr);
        if (project) {
          await this.notificationService.notifyMailLinked({
            projectId: project.id,
            referenceNumber: project.referenceNumber,
            projectName: project.projectName ?? null,
            mailSubject: updatedEmail?.subject ?? null,
            fromName: updatedEmail?.fromName ?? updatedEmail?.fromAddress ?? null,
            estimatorIds: (project.assignedEstimators ?? []).map((estimator) => estimator.id),
          });
        }
      }

      // --- HUMAN-IN-THE-LOOP APPROVAL FLOW ---
      try {
        const pendingCorrelationId = `outlookEmail:${actualEmailId}`;

        // Check if already processed
        if (this.pendingApprovalService) {
          const alreadyProcessed = await this.pendingApprovalService.isSourceProcessed(
            actualEmailId,
            ChangeSource.EMAIL
          );

          if (alreadyProcessed) {
            console.log(`[OutlookService] Email ${actualEmailId} already processed, skipping duplicate approval creation`);
            return;
          }
        }

        // Fetch document names for display
        let documentNames: string[] = [];
        if (uniqueDocumentIds.length > 0) {
          documentNames = await DocumentModel.find({
            _id: { $in: uniqueDocumentIds.map(id => new mongoose.Types.ObjectId(id)) }
          }).select('originalName').lean().then(docs => docs.map(d => d.originalName));
        }
        if (documentNames.length === 0) {
          documentNames = ['Email Body Text'];
        }

        const extractedData = payload.extractedData || payload.proposed?.extractedData || payload.fields_to_show || payload.proposed || {};
        const aiReasoning = payload.proposed?.summary || payload.proposed?.reasoning || payload.reasoning || payload.summary || `Email received: "${updatedEmail?.subject || 'Email Update'}"`;
        const aiConfidence = payload.proposed?.confidence ?? payload.confidence ?? 0.85;

        if (this.pendingApprovalService) {
          await this.pendingApprovalService.createPendingApproval({
            projectId: projIdStr,
            source: ChangeSource.EMAIL,
            sourceId: actualEmailId,
            correlationId: pendingCorrelationId,
            documentIds: uniqueDocumentIds,
            documentNames,
            newExtractedData: extractedData,
            aiReasoning,
            aiConfidence,
            subject: updatedEmail?.subject || 'Email Update',
            sender: updatedEmail?.fromAddress || 'unknown',
            messageId: updatedEmail?.internetMessageId,
          });

          console.log(`[OutlookService] Successfully created pending approval for email ${actualEmailId} on project ${projIdStr}`);
        } else {
          console.warn(`[OutlookService] Pending approval service not available, triggering automatic extraction`);
          try {
            await proposalService.triggerStage0Extraction(projIdStr, uniqueDocumentIds, {
              subject: updatedEmail?.subject,
              fromAddress: updatedEmail?.fromAddress,
              correlationId: pendingCorrelationId,
            });
          } catch (err) {
            // The email and its documents are already linked at this point.
            // A transient queue failure must not turn a successful link into
            // a failed webhook; the next retry/retrigger can start extraction.
            console.error(`[OutlookService] automatic extraction trigger failed for ${actualEmailId}:`, err);
          }
        }
      } catch (err: any) {
        if (err?.message?.includes('already exists') || err?.statusCode === 409) {
          console.log(`[OutlookService] Pending approval already exists for email ${actualEmailId}, skipping.`);
        } else {
          console.error(`[OutlookService] Error creating pending approval for project ${projIdStr}:`, err);
          throw err;
        }
      }

      return;
    }

    // AI suggestion (DRAFT) awaits a human decision; on approval the mail-first flow
    // creates a Zoho lead and the project is created off the Zoho webhook (zoho-first).
    // Outlook never creates a project directly.
    // valid draft handling
    if (payload.action === 'CREATE' || payload.proposed?.isProject === true) {
      await mongoose.model('OutlookEmail').findByIdAndUpdate(actualEmailId, {
        status: 'DRAFT',
        proposed: {
          isProject: payload.proposed?.isProject ?? true,
          customerName: payload.proposed?.customerName,
          projectName: payload.proposed?.projectName,
          projectType: normalizeProjectType(payload.proposed?.projectType),
          summary: payload.proposed?.summary,
          confidence: payload.proposed?.confidence,
          reasoning: payload.proposed?.reasoning,
          address: payload.proposed?.address ?? null,
          jobAddress: payload.proposed?.jobAddress ?? payload.proposed?.address ?? null,
          groupId: payload.proposed?.groupId ?? null,
          isCompetitiveBid: payload.proposed?.isCompetitiveBid ?? false,
          allBidders: payload.proposed?.allBidders ?? null,
          primaryBidderEmail: payload.proposed?.primaryBidderEmail ?? null,
          companyName: payload.proposed?.companyName ?? payload.proposed?.company ?? null,
          allAddresses: payload.proposed?.allAddresses ?? null,
        }
      }).catch(e => console.log('Draft update skipped:', e.message));
      if (this.notificationService) {
        const pName = payload.proposed?.projectName || 'Unknown Project';
        const cName = payload.proposed?.customerName || 'Unknown Customer';
        await this.notificationService.notifyDraftReady(actualEmailId, pName, cName);
      }
    }
  }

  // ----- Discovery (mailbox/folder pickers for the admin UI) -----
   
  public async listMailUsers(search?: string): Promise<GraphMailUser[]> {
    const params: Record<string, string | undefined> = {
      $select: 'id,displayName,mail,userPrincipalName',
      $top: '100',
    };
    if (search) {
      params['$filter'] = `startswith(mail,'${search.replace(/'/g, "''")}')`;
    }
    return this.graphClient.getAllPages<GraphMailUser>('/users', params);
  }

  private async getMailboxBasePath(userId: string): Promise<string> {
    const isDelegated =
      typeof this.tokenService?.isDelegated === 'function'
        ? await this.tokenService.isDelegated()
        : false;
    if (isDelegated || userId.toLowerCase() === 'me') {
      return '/me';
    }
    return `/users/${encodeURIComponent(userId)}`;
  }

  public async listMailFolders(userId: string): Promise<GraphMailFolder[]> {
    const basePath = await this.getMailboxBasePath(userId);
    return this.graphClient.getAllPages<GraphMailFolder>(
      `${basePath}/mailFolders`,
      { $top: '100' },
    );
  }

  // ----- Monitored mailboxes -----

  public async addMonitoredMailbox(
    input: AddMonitoredMailboxInput,
  ): Promise<IDomainMonitoredMailbox> {
    if (input.projectId) {
      const project = await this.projectRepository.findById(input.projectId);
      if (!project) {
        throw new AppError('Project not found', StatusCodes.NOT_FOUND, true, {
          code: ErrorCode.NOT_FOUND,
        });
      }
    }

    const folderId = input.folderId ?? 'inbox';
    const existing = await this.monitoredMailboxRepository.findByMailbox(input.userId, folderId);
    if (existing?.isActive) {
      throw new AppError('Mailbox is already being monitored', StatusCodes.CONFLICT, true, {
        code: ErrorCode.CONFLICT,
      });
    }

    return this.monitoredMailboxRepository.upsert({
      userId: input.userId,
      displayName: input.displayName,
      folderId,
      projectId: input.projectId ?? null,
    });
  }

  public async listMonitoredMailboxes(): Promise<IDomainMonitoredMailbox[]> {
    return this.monitoredMailboxRepository.listActive();
  }

  /**
   * Idempotently registers/reactivates the configured central mailbox so it is
   * monitored without a manual API call. Safe to call on every startup — upsert
   * keys on (userId, folderId).
   */
  public async ensureCentralizedMailbox(
    userId: string,
    displayName?: string,
  ): Promise<IDomainMonitoredMailbox> {
    return this.monitoredMailboxRepository.upsert({
      userId,
      displayName: displayName ?? userId,
      folderId: 'inbox',
    });
  }

  public async removeMonitoredMailbox(id: string): Promise<void> {
    const removed = await this.monitoredMailboxRepository.deactivate(id);
    if (!removed) {
      throw new AppError('Monitored mailbox not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }
  }

  // ----- Ingestion -----

  public async syncMailbox(mailbox: IDomainMonitoredMailbox): Promise<SyncMailboxResult> {
    // Re-attempt any attachments that failed to stage on an earlier sync, so a
    // transient failure isn't a permanent miss even though the delta advanced.
    try {
      await this.backfillUnstaged(mailbox.userId);
    } catch (err) {
      console.error(`[OutlookService] backfill failed for ${mailbox.userId}: ${describeError(err)}`);
    }

    // Stored deltaLinks are absolute URLs (e.g. https://graph.microsoft.com/v1.0/...).
    // Strip the origin so Axios routes them through the configured graphBaseUrl (beta),
    // otherwise an absolute URL bypasses baseURL entirely and hits v1.0 instead of beta.
    const GRAPH_ORIGIN_RE = /^https:\/\/graph\.microsoft\.com\/[^/]+/;
    const rawLink = mailbox.deltaLink ?? null;
    const basePath = await this.getMailboxBasePath(mailbox.userId);
    const initialUrl = `${basePath}/mailFolders/${mailbox.folderId}/messages/delta?$select=${DELTA_SELECT_FIELDS}`;
    const startUrl = rawLink
      ? rawLink.replace(GRAPH_ORIGIN_RE, '')
      : initialUrl;

    let items: GraphMailMessage[] = [];
    let deltaLink: string | null = null;

    try {
      ({ items, deltaLink } = await this.graphClient.getDelta<GraphMailMessage>(startUrl));
    } catch (err) {
      if (rawLink && isDeltaTokenExpired(err)) {
        console.warn(
          `[OutlookService] Delta token expired or sync state reset for mailbox ${mailbox.userId} (${describeError(err)}). Resetting delta cursor and restarting full sync.`,
        );
        await this.monitoredMailboxRepository.updateDeltaLink(mailbox.id, null);
        ({ items, deltaLink } = await this.graphClient.getDelta<GraphMailMessage>(initialUrl));
      } else {
        throw err;
      }
    }

    let ingested = 0;
    let attachmentsStaged = 0;
    for (const message of items) {
      // Delta entries for deleted messages carry only an id — skip them.
      if (message['@removed']) continue;
      if (message.isDraft) continue;

      try {
        const stagedCount = await this.ingestEmail(mailbox, message);
        ingested += 1;
        attachmentsStaged += stagedCount;
      } catch (err) {
        if (isTransientError(err)) {
          throw err;
        }
        console.error(
          `[OutlookService] Skipping message ${message.id} due to fatal ingestion failure: ${describeError(err)}`,
        );
      }
    }

    if (deltaLink) {
      await this.monitoredMailboxRepository.updateDeltaLink(mailbox.id, deltaLink);
    }

    return { mailboxUserId: mailbox.userId, displayName: mailbox.displayName, ingested, attachmentsStaged };
  }

  private async ingestEmail(
    mailbox: IDomainMonitoredMailbox,
    message: GraphMailMessage,
  ): Promise<number> {
    const isHtml = message.body?.contentType === 'html';
    const rawContent = message.body?.content ?? '';
    const bodyHtml = isHtml ? rawContent : null;
    const bodyText = isHtml ? htmlToText(rawContent) : rawContent;
    const subject = message.subject ?? '';

    // Preserve a manual project link across re-ingestion of the same email.
    const existing = await this.emailRepository.findByMessageId(message.id);
    let projectId: string | null;
    let linkMethod: IDomainOutlookEmail['linkMethod'];

    if (existing && existing.linkMethod === 'MANUAL') {
      projectId = existing.projectId ?? null;
      linkMethod = 'MANUAL';
    } else {
      const resolved = await this.associationService.resolveProject({
        subject,
        bodyText,
        mailboxProjectId: mailbox.projectId ?? null,
      });
      projectId = resolved.projectId;
      linkMethod = resolved.linkMethod;
    }

    // Preserve which attachments were already downloaded so re-sync never
    // re-downloads the same file.
    const alreadyDownloaded = new Set(
        (existing?.attachments ?? []).filter((a) => a.downloaded).map((a) => a.id),
    );

    const attachments = message.hasAttachments
      ? await this.fetchAttachmentMetadata(mailbox.userId, message.id, alreadyDownloaded)
      : [];

    // Stage attachment bytes to blob now (project-less), recording storageKey on
    // each attachment. Reuses already-staged blobs from a prior sync.
    const existingById = new Map(
        (existing?.attachments ?? []).map((a) => [a.id, a] as const),
    );
    const referenceWarnings: Array<{ url: string; failedFiles?: string[] }> = [];
    await this.stageAttachments(mailbox.userId, message.id, attachments, existingById, referenceWarnings);

    const stored = await this.emailRepository.upsertByMessageId({
      messageId: message.id,
      internetMessageId: message.internetMessageId ?? null,
      mailboxUserId: mailbox.userId,
      conversationId: message.conversationId ?? null,
      subject: message.subject ?? null,
      fromName: message.from?.emailAddress?.name ?? null,
      fromAddress: message.from?.emailAddress?.address ?? null,
      toRecipients: (message.toRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? '')
        .filter(Boolean),
      ccRecipients: (message.ccRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? '')
        .filter(Boolean),
      bccRecipients: (message.bccRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? '')
        .filter(Boolean),
      bodyText,
      bodyHtml,
      webLink: message.webLink ?? null,
      receivedDateTime: message.receivedDateTime
        ? new Date(message.receivedDateTime)
        : new Date(),
      attachments,
      projectId,
      linkMethod,
    });

    // Step 2: Extract, Resolve Cloud Links, and Dispatch
    // Only run the full resolve+dispatch flow on first ingestion to prevent
    // re-appending warnings and re-resolving on re-sync.
    let dispatched = false;
    let augmentedBodyText = bodyText;

    if (!stored.routedToPipeline) {
      // 2a. Extract and save cloud links from the email body
      let savedAssets: { id: string; status: string; originalUrl: string; provider: string; errorMessage?: string | null }[] = [];
      try {
        if (this.cloudLinkService) {
          savedAssets = await this.cloudLinkService.extractAndSaveLinks({
            emailId: stored.id,
            projectId: stored.projectId,
            bodyHtml,
            bodyText,
            sender: stored.fromAddress || 'unknown',
            subject: stored.subject || 'No Subject',
            receivedAt: stored.receivedDateTime,
          });
        }
      } catch (err) {
        console.error(
          `[OutlookService] failed to extract and save cloud links for email ${stored.id}: ${describeError(err)}`,
        );
      }

      // 2b. Resolve each newly detected cloud link synchronously
      const systemAuthCtx = { userId: OUTLOOK_SYSTEM_USER_ID, roles: OUTLOOK_SYSTEM_USER_ROLES };
      const failedLinks: { url: string; reason: string }[] = [];
      const detectedAssets = savedAssets.filter((a) => a.status === 'DETECTED');

      if (this.cloudLinkService && detectedAssets.length > 0) {
        for (const asset of detectedAssets) {
          try {
            await this.cloudLinkService.resolveLink(asset.id, this.graphClient, systemAuthCtx);
          } catch (err: any) {
            failedLinks.push({
              url: asset.originalUrl,
              reason: err.message || 'Unknown error',
            });
          }
        }

        // 2c. Also check for assets that were marked MANUAL_UPLOAD_REQUIRED or
        // ACCESS_REQUIRED without throwing (e.g. unsupported providers like Google Drive)
        try {
          const refreshedAssets = await Promise.all(
            detectedAssets.map((a) => this.cloudLinkService!.getAssetById(a.id))
          );
          for (const refreshed of refreshedAssets) {
            if (!refreshed) continue;
            if (
              refreshed.status === 'MANUAL_UPLOAD_REQUIRED' ||
              refreshed.status === 'ACCESS_REQUIRED'
            ) {
              // Only add if not already in failedLinks (from a thrown error)
              if (!failedLinks.some((f) => f.url === refreshed.originalUrl)) {
                failedLinks.push({
                  url: refreshed.originalUrl,
                  reason: refreshed.errorMessage || `Provider ${refreshed.provider} resolution is not supported in this version`,
                });
              }
            }
          }
        } catch (err) {
          console.error(
            `[OutlookService] failed to refresh cloud link statuses for email ${stored.id}: ${describeError(err)}`,
          );
        }
      }

      // 2c-ii. Merge reference attachment staging failures (Gap 1)
      const failedRefAttachments = attachments.filter(a => a.isReference && !a.downloaded && a.sourceUrl);
      for (const ref of failedRefAttachments) {
        failedLinks.push({
          url: ref.sourceUrl!,
          reason: 'Reference attachment failed to download from cloud provider',
        });
      }

      // 2c-iii. Merge partial folder extraction failures (Gap 2)
      for (const warning of referenceWarnings) {
        if (warning.failedFiles && warning.failedFiles.length > 0) {
          failedLinks.push({
            url: warning.url,
            reason: `Folder partially extracted — ${warning.failedFiles.length} file(s) could not be staged: ${warning.failedFiles.join(', ')}`,
          });
        }
      }

      // 2d. Build warning block and notify on failures
      if (failedLinks.length > 0) {
        const warningLines = ['', '--- CLOUD LINK INGESTION WARNINGS ---'];
        for (const failed of failedLinks) {
          warningLines.push(`[WARNING] Failed to automatically download: ${failed.url}`);
          warningLines.push(`Reason: ${failed.reason}`);
          warningLines.push('');
        }
        warningLines.push('Please upload these documents manually to the project.');
        warningLines.push('------------------------------------');
        augmentedBodyText = bodyText + warningLines.join('\n');

        // Emit in-app notification
        if (this.notificationService) {
          try {
            await this.notificationService.notifyCloudLinkFailed({
              emailId: stored.id,
              mailSubject: stored.subject || 'No Subject',
              sender: stored.fromAddress || 'unknown',
              failedUrls: failedLinks.map((f) => f.url),
            });
          } catch (err) {
            console.error(
              `[OutlookService] failed to emit cloud link failure notification for email ${stored.id}: ${describeError(err)}`,
            );
          }
        }
      }

      // 2e. Dispatch the unified email package (with all resolved docs + warning block)
      try {
        await this.dispatchEmailPackage(stored, augmentedBodyText);
        dispatched = true;
        // Persist the flag so the next poll tick won't re-dispatch.
        await this.emailRepository.markRoutedToPipeline(stored.messageId);
      } catch (err) {
        console.error(
          `[OutlookService] ingestEmailPackage failed for email ${message.id}: ${describeError(err)}`,
        );
      }
    }

    // Delete the message from the mailbox only after a fully-successful ingest:
    // dispatched to the pipeline AND every non-inline attachment staged. If any
    // attachment failed to stage, keep the message so the backfill can retry it.
    const allStaged = stored.attachments.every((a) => a.isInline || a.downloaded);
    if (this.deleteAfterIngest && dispatched && allStaged) {
      try {
        await this.graphClient.permanentDelete(mailbox.userId, message.id);
      } catch (err) {
        console.error(
          `[OutlookService] failed to permanently delete message ${message.id} after ingest: ${describeError(err)}`,
        );
      }
    }

    return attachments.filter((a) => !a.isInline && a.downloaded).length;
  }

  /**
   * Builds the unified email package (body + attachments as SAS URLs, no raw
   * bytes) and hands it to the document-ingestion side. SAS URLs are minted on
   * demand from each staged attachment's storageKey.
   */
  private async dispatchEmailPackage(
    email: IDomainOutlookEmail,
    bodyText: string,
  ): Promise<void> {
    const attachments: EmailPackageAttachment[] = [];
    for (const a of email.attachments) {
      if (a.isInline || !a.storageKey || a.storageKey === 'FOLDER_STAGED') continue;
      const downloadUrl = this.blobStorage
        ? await this.blobStorage.createSignedDownloadUrl(a.storageKey, EMAIL_PACKAGE_SAS_TTL_MIN)
        : (a.blobUrl ?? '');
      attachments.push({
        originalName: a.name ?? 'attachment',
        mimeType: a.contentType ?? 'application/octet-stream',
        size: a.size ?? 0,
        storageKey: a.storageKey,
        downloadUrl,
      });
    }

    try {
      const resolvedDocs = await DocumentModel.find({
        'metadata.emailId': email.id.toString(),
        status: 'STAGING'
      });
      for (const doc of resolvedDocs) {
        const downloadUrl = this.blobStorage
          ? await this.blobStorage.createSignedDownloadUrl(doc.storageKey, EMAIL_PACKAGE_SAS_TTL_MIN)
          : (doc.blobUrl ?? '');
        attachments.push({
          originalName: doc.originalName,
          mimeType: doc.mimeType,
          size: doc.byteSize,
          storageKey: doc.storageKey,
          downloadUrl,
        });
      }
    } catch (err) {
      console.error(`[OutlookService] Failed to query resolved cloud documents for email ${email.id}:`, err);
    }

    await this.documentPort.ingestEmailPackage({
      correlationId: `outlookEmail:${email.id}`,
      messageId: email.messageId,
      conversationId: email.conversationId ?? null,
      sender: email.fromAddress ?? '',
      to: email.toRecipients ?? [],
      subject: email.subject ?? '',
      bodyText,
      receivedDateTime: email.receivedDateTime.toISOString(),
      attachments,
    });
  }

  private async fetchAttachmentMetadata(
    mailboxUserId: string,
    messageId: string,
    alreadyDownloaded: Set<string>,
  ): Promise<IDomainOutlookEmailAttachment[]> {
    const isBeta = env.outlook.graphBaseUrl.includes('/beta');
    const params = isBeta
      ? undefined
      : { $select: 'id,name,contentType,size,isInline' };

    const basePath = await this.getMailboxBasePath(mailboxUserId);
    const response = await this.graphClient.get<GraphList<GraphMailAttachment>>(
      `${basePath}/messages/${messageId}/attachments`,
      params,
    );
    return (response.value ?? [])
      .filter(
        (a) =>
          !a['@odata.type'] ||
          a['@odata.type'] === FILE_ATTACHMENT_ODATA_TYPE ||
          a['@odata.type'] === REFERENCE_ATTACHMENT_ODATA_TYPE,
      )
      .map((a) => {
        const isReference = a['@odata.type'] === REFERENCE_ATTACHMENT_ODATA_TYPE;
        return {
          id: a.id,
          name: a.name ?? null,
          contentType: a.contentType ?? null,
          size: a.size ?? null,
          isInline: a.isInline ?? false,
          isReference,
          sourceUrl: isReference ? (a.sourceUrl ?? null) : null,
          downloaded: alreadyDownloaded.has(a.id),
        };
      });
  }

  // Deterministic, content-independent blob key for a staged attachment, so a
  // streaming upload doesn't need to hash the whole file first, and a re-stage
  // (backfill) lands on the same key (idempotent).
  private stagingKey(messageId: string, attachmentId: string, name?: string | null): string {
    const h = crypto.createHash('sha256').update(`${messageId}:${attachmentId}`).digest('hex');
    const ext = name && name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    return `documents/staging/${h.slice(0, 2)}/${h}${ext}`;
  }

  // Streams one attachment Graph → blob (constant memory), with transient retry.
  private async stageOne(
    mailboxUserId: string,
    messageId: string,
    att: { id: string; name?: string | null; contentType?: string | null },
  ): Promise<{ storageKey: string; blobUrl: string }> {
    const storageKey = this.stagingKey(messageId, att.id, att.name);
    const mimeType = att.contentType ?? 'application/octet-stream';
    return withRetry(async () => {
      // Fresh stream per attempt (a consumed/aborted stream can't be replayed).
      const basePath = await this.getMailboxBasePath(mailboxUserId);
      const stream = await this.graphClient.getStream(
        `${basePath}/messages/${messageId}/attachments/${att.id}/$value`,
      );
      const result = await this.blobStorage!.putStream({ storageKey, mimeType, stream });
      return { storageKey: result.storageKey, blobUrl: result.blobUrl };
    }, `stage ${att.id}`);
  }

  /**
   * Recovers and streams an attachment directly from Microsoft Graph on demand
   * when blob storage is unreachable or blob is missing.
   */
  public async recoverDocumentStream(
    messageId: string,
    originalName?: string,
    storageKey?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number } | null> {
    try {
      const email = await this.emailRepository.findByMessageId(messageId);
      if (!email || !email.attachments || email.attachments.length === 0) return null;

      const att = email.attachments.find((a) => {
        if (storageKey && a.storageKey === storageKey) return true;
        if (originalName && a.name && (a.name === originalName || a.name.toLowerCase() === originalName.toLowerCase())) return true;
        return false;
      });

      if (!att || !att.id) return null;

      const mailboxUserId = email.mailboxUserId || email.fromAddress || (env.outlook as any).centralizedMailbox;
      if (!mailboxUserId) return null;

      const basePath = await this.getMailboxBasePath(mailboxUserId);
      const stream = await this.graphClient.getStream(
        `${basePath}/messages/${messageId}/attachments/${att.id}/$value`,
      );

      // Asynchronously re-stage to blob storage in the background so future requests are instant
      if (this.blobStorage && att.storageKey) {
        const mimeType = att.contentType || 'application/pdf';
        const { PassThrough } = await import('stream');
        const pt1 = new PassThrough();
        const pt2 = new PassThrough();
        (stream as any).pipe(pt1);
        (stream as any).pipe(pt2);

        this.blobStorage.putStream({
          storageKey: att.storageKey,
          mimeType,
          stream: pt2,
        }).catch((err) => {
          console.warn('[OutlookService] Background re-stage failed:', err);
        });

        return {
          stream: pt1,
          contentType: mimeType,
          contentLength: att.size || undefined,
        };
      }

      return {
        stream,
        contentType: att.contentType || 'application/pdf',
        contentLength: att.size || undefined,
      };
    } catch (err) {
      console.error('[OutlookService] recoverDocumentStream error:', err);
      return null;
    }
  }

  // Streams one reference attachment Graph → blob (constant memory), with transient retry.
  private async stageOneReference(
    messageId: string,
    att: { id: string; name?: string | null; contentType?: string | null; sourceUrl: string },
  ): Promise<{ storageKey: string; blobUrl: string; failedFiles?: string[] }> {
    const shareId = encodeShareUrl(att.sourceUrl);
    
    // 1. Check if folder
    const item = await fetchGraphShareItem(this.graphClient, shareId);
    const isFolder = !!item.folder;

    if (!isFolder) {
      const storageKey = this.stagingKey(messageId, att.id, att.name);
      const mimeType = att.contentType ?? 'application/octet-stream';
      return withRetry(async () => {
        const stream = await this.graphClient.getStream(`/shares/${shareId}/driveItem/content`);
        const result = await this.blobStorage!.putStream({ storageKey, mimeType, stream });
        return { storageKey: result.storageKey, blobUrl: result.blobUrl };
      }, `stage reference file ${att.id}`);
    }

    // Reference attachment is a folder!
    return withRetry(async () => {
      const email = await this.emailRepository.findByMessageId(messageId);
      const projectId = email?.projectId ? new mongoose.Types.ObjectId(email.projectId) : null;
      const uploadedBy = email?.fromAddress || 'outlook-reference-folder';
      const emailId = email?.id?.toString() || '';

      const fileStream = await getGraphShareFileStream(this.graphClient, shareId);
      const zipParser = fileStream.pipe(unzipper.Parse({ forceStream: true }));
      let processedCount = 0;
      const failedFiles: string[] = [];

      const extractEntry = async (entry: any) => {
        const fileName = path.basename(entry.path);
        if (entry.type === 'Directory') {
          entry.autodrain();
          return;
        }

        // Handle recursive zip extraction for nested zip folders!
        if (fileName.toLowerCase().endsWith('.zip')) {
          try {
            const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
            for await (const nestedEntry of nestedParser) {
              await extractEntry(nestedEntry);
            }
          } catch (err: any) {
            console.error(`[OutlookService] Failed to extract nested zip ${fileName}:`, err);
          }
          return;
        }

        // Validate file extension
        const ext = path.extname(fileName).toLowerCase();
        if (!env.cloudLinks.supportedExtensions.includes(ext)) {
          entry.autodrain();
          return;
        }

        try {
          const childStorageKey = this.stagingKey(messageId, `${att.id}-${fileName}`, fileName);
          const putResult = await this.blobStorage!.putStream({
            storageKey: childStorageKey,
            mimeType: 'application/octet-stream',
            stream: entry,
          });

          const docId = new mongoose.Types.ObjectId().toString();
          const ext = path.extname(fileName).toLowerCase();
          const sha256 = crypto.createHash('sha256').update(putResult.storageKey).digest('hex');

          await DocumentModel.create({
            _id: docId,
            rootDocumentId: docId,
            version: 1,
            isLatest: true,
            isActive: true,
            isFinalInput: false,
            projectId,
            originalName: fileName,
            mimeType: 'application/octet-stream',
            extension: ext,
            storageKey: putResult.storageKey,
            blobUrl: putResult.blobUrl,
            sha256,
            byteSize: putResult.byteSize,
            status: 'STAGING',
            uploadedBy,
            documentType: 'other',
            metadata: {
              source: 'outlook-reference-folder',
              emailId,
              originalUrl: att.sourceUrl,
            },
          });
          processedCount++;
        } catch (err) {
          entry.autodrain();
          failedFiles.push(fileName);
          console.error(`[OutlookService] Failed to stage reference folder file ${fileName}:`, err);
        }
      };

      for await (const entry of zipParser) {
        await extractEntry(entry);
      }

      console.log(`[OutlookService] Successfully extracted ${processedCount} files from reference folder ${att.name || att.id}`);
      if (failedFiles.length > 0) {
        console.warn(`[OutlookService] ${failedFiles.length} file(s) failed to extract from reference folder ${att.name || att.id}: ${failedFiles.join(', ')}`);
      }
      return { storageKey: 'FOLDER_STAGED', blobUrl: '', failedFiles: failedFiles.length > 0 ? failedFiles : undefined };
    }, `stage reference folder ${att.id}`);
  }

  /**
   * Stages each (non-inline) attachment to blob via streaming, recording
   * storageKey/blobUrl on the attachment. Already-staged attachments (from a
   * prior sync) are reused. A failed attachment is left unstaged with an
   * incremented stageAttempts so the backfill pass can retry it. No-op without
   * blob storage.
   */
  private async stageAttachments(
    mailboxUserId: string,
    messageId: string,
    attachments: IDomainOutlookEmailAttachment[],
    existingById: Map<string, IDomainOutlookEmailAttachment>,
    referenceWarnings?: Array<{ url: string; failedFiles?: string[] }>,
  ): Promise<void> {
    if (!this.blobStorage) return;

    for (const att of attachments) {
      if (att.isInline) continue;

      const prior = existingById.get(att.id);
      if (prior?.downloaded && prior.storageKey) {
        att.storageKey = prior.storageKey;
        att.blobUrl = prior.blobUrl ?? null;
        att.downloaded = true;
        att.stageAttempts = prior.stageAttempts ?? 0;
        att.isReference = prior.isReference ?? false;
        att.sourceUrl = prior.sourceUrl ?? null;
        continue;
      }

      // Check if attachment was already staged into MongoDB/Blob storage (e.g. by a concurrent or prior pass)
      const storageKey = this.stagingKey(messageId, att.id, att.name);
      try {
        const existingDoc = await DocumentModel.findOne({ storageKey }).select('storageKey blobUrl').lean();
        if (existingDoc?.storageKey) {
          att.storageKey = existingDoc.storageKey;
          att.blobUrl = existingDoc.blobUrl ?? null;
          att.downloaded = true;
          att.stageAttempts = 0;
          continue;
        }
      } catch {}

      try {
        let result: { storageKey: string; blobUrl: string; failedFiles?: string[] };
        if (att.isReference) {
          if (!att.sourceUrl) {
            console.warn(
              `[OutlookService] Skipping staging for reference attachment ${att.id} in message ${messageId} because sourceUrl is missing (requires Graph beta endpoint)`
            );
            continue;
          }
          result = await this.stageOneReference(messageId, {
            id: att.id,
            name: att.name,
            contentType: att.contentType,
            sourceUrl: att.sourceUrl,
          });
        } else {
          result = await this.stageOne(mailboxUserId, messageId, att);
        }
        att.storageKey = result.storageKey;
        att.blobUrl = result.blobUrl;
        att.downloaded = true;
        if (result.failedFiles && referenceWarnings && att.sourceUrl) {
          referenceWarnings.push({ url: att.sourceUrl, failedFiles: result.failedFiles });
        }
      } catch (err: any) {
        att.downloaded = false;
        const isNotFound = err?.statusCode === StatusCodes.NOT_FOUND ||
          /ErrorItemNotFound|NotFound|404/i.test(err?.message || '') ||
          /ErrorItemNotFound/i.test(JSON.stringify(err?.details || ''));

        att.stageAttempts = isNotFound ? MAX_STAGE_ATTEMPTS : (prior?.stageAttempts ?? 0) + 1;
        console.error(
          `[OutlookService] failed to stage attachment ${att.id} of ${messageId}: ${describeError(err)}`,
        );
      }
    }
  }

  /**
   * Re-attempts attachments that failed to stage on an earlier sync (and haven't
   * exhausted their retry budget), so the advancing delta cursor never causes a
   * permanent miss. Runs at the start of each mailbox sync.
   */
  private async backfillUnstaged(mailboxUserId: string): Promise<void> {
    if (!this.blobStorage) return;

    const pending = await this.emailRepository.findWithUnstagedAttachments(
      mailboxUserId,
      MAX_STAGE_ATTEMPTS,
      BACKFILL_BATCH,
    );

    for (const email of pending) {
      for (const att of email.attachments) {
        if (att.isInline || att.downloaded) continue;
        if ((att.stageAttempts ?? 0) >= MAX_STAGE_ATTEMPTS) continue;

        // Check if attachment was already staged into MongoDB/Blob storage
        const storageKey = this.stagingKey(email.messageId, att.id, att.name);
        try {
          const existingDoc = await DocumentModel.findOne({ storageKey }).select('storageKey blobUrl').lean();
          if (existingDoc?.storageKey) {
            att.storageKey = existingDoc.storageKey;
            att.blobUrl = existingDoc.blobUrl ?? null;
            att.downloaded = true;
            await this.emailRepository.setAttachmentStaged(email.messageId, att.id, existingDoc.storageKey, existingDoc.blobUrl || '');
            continue;
          }
        } catch {}

        try {
          let result: { storageKey: string; blobUrl: string };
          if (att.isReference) {
            if (!att.sourceUrl) {
              console.warn(
                `[OutlookService] Backfill: Skipping reference attachment ${att.id} in message ${email.messageId} because sourceUrl is missing`
              );
              continue;
            }
            result = await this.stageOneReference(email.messageId, {
              id: att.id,
              name: att.name,
              contentType: att.contentType,
              sourceUrl: att.sourceUrl,
            });
          } else {
            result = await this.stageOne(email.mailboxUserId, email.messageId, att);
          }
          await this.emailRepository.setAttachmentStaged(email.messageId, att.id, result.storageKey, result.blobUrl);
        } catch (err: any) {
          const isNotFound = err?.statusCode === StatusCodes.NOT_FOUND ||
            /ErrorItemNotFound|NotFound|404/i.test(err?.message || '') ||
            /ErrorItemNotFound/i.test(JSON.stringify(err?.details || ''));

          if (isNotFound) {
            await this.emailRepository.recordAttachmentStageFailure(email.messageId, att.id, MAX_STAGE_ATTEMPTS);
          } else {
            await this.emailRepository.recordAttachmentStageFailure(email.messageId, att.id);
          }
          console.error(
            `[OutlookService] backfill stage failed for ${att.id} of ${email.messageId}: ${describeError(err)}`,
          );
        }
      }
    }
  }

  public async sync(mailboxDbId?: string): Promise<OutlookSyncSummary> {
    if (mailboxDbId) {
      const mailbox = await this.monitoredMailboxRepository.findById(mailboxDbId);
      if (!mailbox || !mailbox.isActive) {
        throw new AppError('Monitored mailbox not found', StatusCodes.NOT_FOUND, true, {
          code: ErrorCode.NOT_FOUND,
        });
      }
      const result = await this.syncMailbox(mailbox);
      return { mailboxes: [result], errors: [] };
    }
    return this.syncAll();
  }

  public async syncAll(): Promise<OutlookSyncSummary> {
    let mailboxes = await this.monitoredMailboxRepository.listActive();
    // Force the server to only poll its explicitly assigned mailbox from .env
    // This prevents the Live server and Local server from stealing each other's emails
    const targetMailbox = process.env['OUTLOOK_CENTRALIZED_MAILBOX'];
    if (targetMailbox) {
      mailboxes = mailboxes.filter(m => m.userId === targetMailbox);
    }
    const summary: OutlookSyncSummary = { mailboxes: [], errors: [] };

    for (const mailbox of mailboxes) {
      try {
        summary.mailboxes.push(await this.syncMailbox(mailbox));
      } catch (err) {
        // Isolate failures so one bad mailbox doesn't abort the whole run.
        summary.errors.push({
          mailboxUserId: mailbox.userId,
          message: describeError(err),
        });
      }
    }

    return summary;
  }

  // ----- Emails -----

  public async listEmails(filter: IListOutlookEmailsFilter): Promise<IOutlookEmailPage> {
    const result = await this.emailRepository.list(filter);

    // Loop through retrieved emails to query and append staged cloud documents
    for (const email of result.emails) {
      try {
        const cloudDocs = await DocumentModel.find({
          'metadata.emailId': email.id,
          status: 'STAGING'
        });

        for (const doc of cloudDocs) {
          const downloadUrl = this.blobStorage
            ? await this.blobStorage.createSignedDownloadUrl(doc.storageKey, EMAIL_PACKAGE_SAS_TTL_MIN)
            : (doc.blobUrl ?? '');

          // Check if already exists in attachments to prevent duplicates
          const exists = email.attachments.some((att) => att.storageKey === doc.storageKey);
          if (!exists) {
            email.attachments.push({
              id: doc.id,
              name: doc.originalName,
              contentType: doc.mimeType,
              size: doc.byteSize,
              isInline: false,
              isReference: true,
              sourceUrl: doc.metadata instanceof Map ? (doc.metadata.get('originalUrl') ?? null) : ((doc.metadata as any)?.originalUrl ?? null),
              downloaded: true,
              storageKey: doc.storageKey,
              blobUrl: downloadUrl,
              stageAttempts: 0,
            });
          }
        }
      } catch (err) {
        console.error(`[OutlookService] Failed to fetch staged cloud documents for draft review of email ${email.id}:`, err);
      }
    }

    return result;
  }

  public async linkEmail(messageId: string, projectId: string): Promise<IDomainOutlookEmail> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    const updated = await this.emailRepository.setProject(messageId, projectId, 'MANUAL');
    if (!updated) {
      throw new AppError('Email not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    // Link native attachments
    const targetProjectId = mongoose.Types.ObjectId.isValid(projectId)
      ? new mongoose.Types.ObjectId(projectId)
      : projectId as any;

    if (updated.attachments && updated.attachments.length > 0) {
      const storageKeys = updated.attachments.map((att: any) => att.storageKey).filter(Boolean);
      if (storageKeys.length > 0) {
        await DocumentModel.updateMany(
          { storageKey: { $in: storageKeys } },
          { $set: {
              projectId: targetProjectId,
              status: 'PROCESSED',
              isActive: true
            }
          }
        ).catch(err => console.error('Failed to link native documents to project during manual link', err));
      }
    }

    // Link cloud-resolved documents
    await DocumentModel.updateMany(
      { 'metadata.emailId': updated.id },
      { $set: {
          projectId: targetProjectId,
          status: 'PROCESSED',
          isActive: true
        }
      }
    ).catch(err => console.error('Failed to link cloud-resolved documents to project during manual link', err));

    // Collect linked document IDs
    const linkedDocIds: string[] = [];
    const documentNames: string[] = [];

    if (updated.attachments && updated.attachments.length > 0) {
      const storageKeys = updated.attachments.map((att: any) => att.storageKey).filter(Boolean);
      if (storageKeys.length > 0) {
        const nativeDocs = await DocumentModel.find(
          { storageKey: { $in: storageKeys } },
          { _id: 1, originalName: 1 }
        ).lean().catch(() => []);
        linkedDocIds.push(...nativeDocs.map((d: any) => String(d._id)));
        documentNames.push(...nativeDocs.map((d: any) => d.originalName).filter(Boolean));
      }
    }

    const cloudDocs = await DocumentModel.find(
      { 'metadata.emailId': updated.id },
      { _id: 1, originalName: 1 }
    ).lean().catch(() => []);
    linkedDocIds.push(...cloudDocs.map((d: any) => String(d._id)));
    documentNames.push(...cloudDocs.map((d: any) => d.originalName).filter(Boolean));

    const uniqueDocIds = [...new Set(linkedDocIds)];

    // Create pending approval for manually linked email with attachments
    if (uniqueDocIds.length > 0 && this.pendingApprovalService) {
      try {
        const correlationId = `outlookEmail:${updated.id}`;
        const alreadyProcessed = await this.pendingApprovalService.isSourceProcessed(
          updated.id,
          ChangeSource.EMAIL
        );

        if (!alreadyProcessed) {
          await this.pendingApprovalService.createPendingApproval({
            projectId,
            source: ChangeSource.EMAIL,
            sourceId: updated.id,
            correlationId,
            documentIds: uniqueDocIds,
            documentNames: documentNames.length > 0 ? documentNames : ['Email attachment'],
            newExtractedData: {},
            subject: updated.subject || 'Manually linked email',
            sender: updated.fromAddress || 'unknown',
            messageId: updated.messageId,
          });

          console.log(`[OutlookService] Created pending approval for manually linked email ${updated.id} on project ${projectId}`);
        }
      } catch (err: any) {
        if (!err?.message?.includes('already exists') && err?.statusCode !== 409) {
          console.error(`[OutlookService] Failed to create pending approval during manual link for email ${updated.id}:`, err);
        }
      }
    }

    // Trigger immediate outward Dropbox sync for newly linked email attachments
    this.projectRepository.findById(projectId).then((proj) => {
      if (proj) {
        dropboxSyncService.outwardSync(proj).catch((err) =>
          console.error(`[OutlookService] outwardSync failed for project ${projectId}:`, err)
        );
      }
    }).catch(() => {});

    // Keep the same project-level contact snapshot current for manual links.
    void refreshExternalContactsForProject(
      projectId,
      this.projectRepository,
      this.emailRepository,
    ).catch((err) => console.error(`[OutlookService] external contact refresh failed for ${projectId}:`, err));

    return updated;
  }

  /**
   * Moves an email and all of its connected assets (native attachments, cloud-resolved documents,
   * email body document, physical Dropbox files, pending approvals, and external contacts)
   * from its current project to a new target project.
   */
  public async moveEmail(
    emailIdOrMessageId: string,
    targetProjectId: string,
    options?: { runExtraction?: boolean }
  ): Promise<{
    email: IDomainOutlookEmail;
    movedDocumentCount: number;
    movedDocumentIds: string[];
  }> {
    // 1. Verify target project exists
    const targetProject = await this.projectRepository.findById(targetProjectId);
    if (!targetProject) {
      throw new AppError('Target project not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    // 2. Fetch email by messageId or DB _id
    let email: IDomainOutlookEmail | null = await this.emailRepository.findByMessageId(emailIdOrMessageId);
    if (!email && mongoose.Types.ObjectId.isValid(emailIdOrMessageId)) {
      const emailDoc = await mongoose.model('OutlookEmail').findById(emailIdOrMessageId);
      if (emailDoc) {
        email = await this.emailRepository.findByMessageId(emailDoc.messageId);
      }
    }
    if (!email) {
      throw new AppError('Email not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }

    const sourceProjectId = email.projectId ? String(email.projectId) : null;
    if (sourceProjectId === targetProjectId) {
      throw new AppError('Email is already linked to this project', StatusCodes.BAD_REQUEST, true, {
        code: ErrorCode.VALIDATION_ERROR,
      });
    }

    const sourceProject = sourceProjectId ? await this.projectRepository.findById(sourceProjectId) : null;
    const targetProjectObjId = new mongoose.Types.ObjectId(targetProjectId);

    // 3. Collect all related documents:
    // a. Native attachments
    // b. Cloud link documents
    // c. Email body document (email-*.txt)
    const storageKeys = (email.attachments || []).map((att: any) => att.storageKey).filter(Boolean);
    const messageIds = [email.messageId, email.internetMessageId].filter(Boolean) as string[];

    const docQuery: any = {
      $or: [
        ...(storageKeys.length > 0 ? [{ storageKey: { $in: storageKeys } }] : []),
        { 'metadata.emailId': email.id },
        { 'metadata.messageId': { $in: messageIds } },
        { originalName: { $regex: new RegExp(`email-${email.id}|email-${email.messageId}`, 'i') } },
      ],
    };

    const connectedDocs = await DocumentModel.find(docQuery);
    const movedDocumentIds = connectedDocs.map((d: any) => String(d._id));

    // 4. Update documents in MongoDB
    if (connectedDocs.length > 0) {
      await DocumentModel.updateMany(
        { _id: { $in: connectedDocs.map((d: any) => d._id) } },
        { $set: { projectId: targetProjectObjId, status: 'PROCESSED', isActive: true } }
      );
    }

    // 5. Update Email record
    const updatedEmail = await this.emailRepository.setProject(email.messageId, targetProjectId, 'MANUAL');
    if (!updatedEmail) {
      throw new AppError('Failed to update email project association', StatusCodes.INTERNAL_SERVER_ERROR, true, {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    // 6. Move physical files in Dropbox
    if (connectedDocs.length > 0) {
      dropboxSyncService.moveDocumentsInDropbox(connectedDocs, sourceProject, targetProject).catch((err: any) =>
        console.error(`[OutlookService] Failed to move documents in Dropbox from project ${sourceProjectId} to ${targetProjectId}:`, err)
      );
    }

    // 7. Handle Pending Approval (Unchecked / Default) vs Direct Auto-Approve (Checked)
    const shouldDirectAutoApprove = options?.runExtraction === true;

    if (shouldDirectAutoApprove) {
      // Direct Auto-Approve Mode: Trigger Stage 0 extraction directly into proposal
      if (movedDocumentIds.length > 0) {
        try {
          await proposalService.triggerStage0Extraction(targetProjectId, movedDocumentIds, {
            subject: email.subject || undefined,
            fromAddress: email.fromAddress || undefined,
            correlationId: `outlookEmail:${email.id}`,
          });
          console.log(`[OutlookService] Triggered Stage 0 extraction directly on target project ${targetProjectId} for moved email ${email.id}`);
        } catch (err: any) {
          console.error(`[OutlookService] Failed to trigger Stage 0 extraction on target project ${targetProjectId}:`, err);
        }
      }
    } else {
      // Pending Approval Mode (Unchecked / Default): Place in Pending Approvals for human review on target project
      try {
        if (this.pendingApprovalService) {
          const existingApproval = await PendingChangeApprovalModel.findOne({
            source: ChangeSource.EMAIL,
            sourceId: email.id,
          });

          if (existingApproval) {
            existingApproval.projectId = targetProjectObjId as any;
            existingApproval.status = ApprovalStatus.PENDING;
            await existingApproval.save();
            console.log(`[OutlookService] Updated existing pending approval to target project ${targetProjectId} for email ${email.id}`);
          } else {
            const documentNames = connectedDocs.map((d: any) => d.originalName).filter(Boolean);
            await this.pendingApprovalService.createPendingApproval({
              projectId: targetProjectId,
              source: ChangeSource.EMAIL,
              sourceId: email.id,
              correlationId: `outlookEmail:${email.id}`,
              documentIds: movedDocumentIds,
              documentNames: documentNames.length > 0 ? documentNames : ['Email Body Text'],
              newExtractedData: (email.proposed as any)?.extractedData || (email.proposed as any)?.fields_to_show || email.proposed || {},
              aiReasoning: email.proposed?.summary || email.proposed?.reasoning || `Moved email: "${email.subject || 'Email Update'}"`,
              aiConfidence: email.proposed?.confidence ?? 0.85,
              subject: email.subject || 'Email Update',
              sender: email.fromAddress || 'unknown',
              messageId: email.internetMessageId ?? undefined,
            });
            console.log(`[OutlookService] Created new pending approval on target project ${targetProjectId} for moved email ${email.id}`);
          }
        }
      } catch (err: any) {
        console.error(`[OutlookService] Failed to manage pending approval for moved email ${email.id}:`, err);
      }
    }

    // 9. Recompute External Contacts for both source and target projects
    if (sourceProjectId) {
      refreshExternalContactsForProject(sourceProjectId, this.projectRepository, this.emailRepository).catch((err: any) =>
        console.error(`[OutlookService] External contacts refresh failed for source project ${sourceProjectId}:`, err)
      );
    }
    refreshExternalContactsForProject(targetProjectId, this.projectRepository, this.emailRepository).catch((err: any) =>
      console.error(`[OutlookService] External contacts refresh failed for target project ${targetProjectId}:`, err)
    );

    // 10. Notify estimators on target project
    if (this.notificationService) {
      const estimatorIds = (targetProject.assignedEstimators ?? []).map((e: any) => e.id || e._id || e).filter(Boolean);
      this.notificationService.notifyMailLinked({
        projectId: targetProject.id,
        referenceNumber: targetProject.referenceNumber,
        projectName: targetProject.projectName ?? null,
        mailSubject: updatedEmail.subject ?? null,
        fromName: updatedEmail.fromName ?? updatedEmail.fromAddress ?? null,
        estimatorIds,
      }).catch((err: any) => console.error(`[OutlookService] Notification failed for target project ${targetProjectId}:`, err));
    }

    return {
      email: updatedEmail,
      movedDocumentCount: connectedDocs.length,
      movedDocumentIds,
    };
  }

  public async resolvePendingCloudLinks(ctx: { userId: string; roles: string[] }): Promise<void> {
    if (this.cloudLinkService) {
      await this.cloudLinkService.resolvePendingAssets(ctx, this.graphClient);
    }
  }

  // ----- Delegated OAuth2 Authentication -----

  public getAuthUrl(redirectUri?: string): string {
    return this.tokenService.getAuthUrl(redirectUri);
  }

  public async handleAuthCallback(
    code: string,
    redirectUri?: string,
  ): Promise<IOutlookStoredToken> {
    const token = await this.tokenService.exchangeAuthCode(code, redirectUri);
    if (env.outlook.centralizedMailbox) {
      try {
        await this.ensureCentralizedMailbox(env.outlook.centralizedMailbox);
      } catch (err) {
        console.error('[OutlookService] ensureCentralizedMailbox error on auth callback:', err);
      }
    }
    // Kick off an immediate sync in the background so emails start ingesting right away
    void this.syncAll().then((summary) => {
      console.log(`[OutlookService] Post-auth sync completed: synced ${summary.mailboxes.length} mailbox(es), ${summary.errors.length} error(s)`);
    }).catch((err) => {
      console.error('[OutlookService] Post-auth sync failed:', err);
    });
    return token;
  }

  // ----- Status -----

  public async getStatus(): Promise<OutlookStatus> {
    const cached = await this.tokenService.getCachedToken();
    const mailboxes = await this.monitoredMailboxRepository.listActive();
    const isDelegated =
      typeof this.tokenService?.isDelegated === 'function'
        ? await this.tokenService.isDelegated()
        : false;
    return {
      configured: this.tokenService.isConfigured(),
      cachedTokenExpiresAt: cached?.expiresAt ?? null,
      monitoredMailboxCount: mailboxes.length,
      accountType: isDelegated ? 'delegated' : 'app_only',
      hasRefreshToken: Boolean(cached?.refreshToken),
    };
  }
}
