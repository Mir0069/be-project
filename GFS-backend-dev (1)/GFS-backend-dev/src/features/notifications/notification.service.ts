import { User, UserRole } from '@db/models/user.model';
import { Project } from '@db/models/project.model';
import { NotificationType } from '@db/models/notification.model';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { isValidObjectId } from 'mongoose';
import { env } from '@config/index';
import { buildEstimatorAssignedEmail, type IMailerService } from '@shared/mailer';
import type {
  INotificationDomain,
  INotificationRepository,
} from '@repositories/interfaces/i-notification.repository';

import { notificationEventBus, NotificationEvent } from './notification.events';
import type { NotificationCreatedPayload } from './notification.events';
import type {
  IEstimatorAssignedNotificationInput,
  IStage7ApprovalRequestedNotificationInput,
  IListNotificationsParams,
  IMailLinkedNotificationInput,
  INotificationListResult,
  INotificationView,
  OpportunityStatus,
  IProjectCreatedNotificationInput,
  IDocsProcessingNotificationInput,
  IProjectCompletedNotificationInput,
  IDocumentAddedNotificationInput,
  IDropboxWorkspaceCreatedNotificationInput,
  IUnreadCountParams,
} from './notification.types';

type OpportunityStatusResolver = (emailIds: string[]) => Promise<Map<string, OpportunityStatus>>;

const resolveOpportunityStatuses: OpportunityStatusResolver = async (emailIds) => {
  const statuses = new Map<string, OpportunityStatus>(
    emailIds.map((id) => [id, 'OPEN']),
  );
  const validIds = emailIds.filter((id) => isValidObjectId(id));
  if (validIds.length === 0) return statuses;

  const emails = await OutlookEmail.find({ _id: { $in: validIds } })
    .select({ _id: 1, status: 1 })
    .lean();

  emails.forEach((email) => {
    const status: OpportunityStatus = email.status === 'DISCARDED'
      ? 'REJECTED'
      : email.status === 'CONFIRMED' || email.status === 'LINKED'
        ? 'CONVERTED'
        : 'OPEN';
    statuses.set(email._id.toString(), status);
  });

  return statuses;
};

const projectLabelOf = (referenceNumber: string, projectName: string | null): string =>
  projectName ? `${referenceNumber} – ${projectName}` : referenceNumber;

export class NotificationService {
  private readonly notificationRepository: INotificationRepository;
  private readonly opportunityStatusResolver: OpportunityStatusResolver;
  private readonly mailerService?: IMailerService;

  public constructor(
    notificationRepository: INotificationRepository,
    opportunityStatusResolver: OpportunityStatusResolver = resolveOpportunityStatuses,
    mailerService?: IMailerService,
  ) {
    this.notificationRepository = notificationRepository;
    this.opportunityStatusResolver = opportunityStatusResolver;
    this.mailerService = mailerService;
  }

  public async notifyProjectCreated(input: IProjectCreatedNotificationInput): Promise<void> {
    try {
      const subject = input.leadName ?? input.projectName;
      const statusSuffix = input.leadStatus ? ` (${input.leadStatus})` : '';
      const created = await this.notificationRepository.create({
        type: NotificationType.PROJECT_CREATED,
        title: 'New project created',
        message: `Project ${input.referenceNumber} was created for ${subject}${statusSuffix}.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER],
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
          zohoLeadId: input.zohoLeadId,
          leadName: input.leadName,
          leadStatus: input.leadStatus,
          creationSource: input.creationSource,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit PROJECT_CREATED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyEstimatorAssigned(input: IEstimatorAssignedNotificationInput): Promise<void> {
    const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
    for (const estimator of input.estimators) {
      try {
        const estimatorLabel = estimator.name ?? 'an estimator';
        const created = await this.notificationRepository.create({
          type: NotificationType.PROJECT_ASSIGNED,
          title: 'Project assigned',
          message: `Project ${projectLabel} assigned to ${estimatorLabel}.`,
          projectId: input.projectId,
          roles: [],
          userIds: [estimator.id],
          payload: {
            referenceNumber: input.referenceNumber,
            projectName: input.projectName,
            estimatorId: estimator.id,
            estimatorName: estimator.name,
          },
        });
        this.emitCreated(created);
      } catch (error) {
        console.error('[Notification] failed to emit PROJECT_ASSIGNED notification', {
          projectId: input.projectId,
          estimatorId: estimator.id,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    // Email notification to newly assigned estimators
    if (this.mailerService && input.sendEmail !== false && input.estimators.length > 0) {
      try {
        let projectDoc: any = null;
        if (isValidObjectId(input.projectId)) {
          projectDoc = await Project.findById(input.projectId).lean();
        }

        const baseUrl = env.app.frontendUrl || 'https://amberflux-gfs.web.app';
        const projectUrl = `${baseUrl.replace(/\/+$/, '')}/projects/${input.projectId}`;

        for (const estimator of input.estimators) {
          let recipientEmail = estimator.email?.trim();
          let recipientName = estimator.name?.trim() || null;

          if (!recipientEmail && isValidObjectId(estimator.id)) {
            try {
              const u = await User.findById(estimator.id).select('email firstName lastName').lean();
              if (u) {
                recipientEmail = u.email;
                if (!recipientName) {
                  recipientName = `${u.firstName} ${u.lastName}`.trim() || null;
                }
              }
            } catch (uErr) {
              console.warn('[Notification] Failed to look up estimator email for notification:', uErr);
            }
          }

          if (!recipientEmail) {
            console.warn(`[Notification] Skipping estimator email assignment notification: no email found for estimator ${estimator.id}`);
            continue;
          }

          const emailInput = {
            to: recipientEmail,
            recipientName,
            referenceNumber: projectDoc?.referenceNumber ?? input.referenceNumber,
            projectName: projectDoc?.projectName ?? input.projectName ?? 'New Project',
            customerName: projectDoc?.customerName ?? null,
            company: projectDoc?.company ?? null,
            projectType: projectDoc?.projectType ?? null,
            dueDate: projectDoc?.dueDate ?? null,
            jobAddress: projectDoc?.jobAddress ?? projectDoc?.siteAddress ?? null,
            projectUrl,
            assignedByName: input.assignedByName ?? null,
          };

          const { subject, text, html } = buildEstimatorAssignedEmail(emailInput);

          try {
            if (typeof this.mailerService.sendEstimatorAssignedNotification === 'function') {
              await this.mailerService.sendEstimatorAssignedNotification(emailInput);
            } else {
              await this.mailerService.sendMail({ to: recipientEmail, subject, text, html });
            }
            console.log(`[Notification] Sent estimator assignment notification email to ${recipientEmail} for project ${input.referenceNumber}`);
          } catch (mailErr) {
            console.error(`[Notification] Failed to send estimator assignment email to ${recipientEmail}:`, mailErr);
          }
        }
      } catch (err) {
        console.error('[Notification] Error during estimator assignment email dispatch:', err);
      }
    }
  }

  public async notifyStage7ApprovalRequested(input: IStage7ApprovalRequestedNotificationInput): Promise<void> {
    try {
      const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
      const assignerLabel = input.assignedByName ?? 'A teammate';
      const notification = await this.notificationRepository.replaceProposalApprovalRequest({
        type: NotificationType.PROPOSAL_APPROVAL_REQUESTED,
        title: `Pending approval for ${projectLabel}`,
        message: `Approval request from ${assignerLabel} for ${projectLabel}.`,
        projectId: input.projectId,
        roles: [],
        userIds: [input.approverId],
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
          finalPrice: input.finalPrice,
          requestedByName: input.assignedByName,
        },
      });
      // A reassignment is a material new request for the newly selected
      // approver, even though it replaces the existing project queue item.
      this.emitCreated(notification);
    } catch (error) {
      console.error('[Notification] failed to emit PROPOSAL_APPROVAL_REQUESTED notification', {
        projectId: input.projectId,
        approverId: input.approverId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Approval requests are actionable queue items, rather than history. Once
   * the associated Stage 7 approval succeeds, remove every outstanding copy
   * for that project and its assigned approver (including any legacy
   * duplicates) so a completed project cannot remain pending in the UI.
   */
  public async resolveStage7ApprovalRequests(projectId: string, approverId: string): Promise<void> {
    try {
      await this.notificationRepository.deleteProposalApprovalRequests(projectId, approverId);
    } catch (error) {
      // Notification cleanup must never invalidate a completed approval.
      console.error('[Notification] failed to resolve PROPOSAL_APPROVAL_REQUESTED notifications', {
        projectId,
        approverId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyMailLinked(input: IMailLinkedNotificationInput): Promise<void> {
    try {
      const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
      const mailLabel = input.mailSubject?.trim() || 'a new email';
      const sender = input.fromName ? ` from ${input.fromName}` : '';
      const created = await this.notificationRepository.create({
        type: NotificationType.MAIL_LINKED,
        title: 'New mail added to project',
        message: `"${mailLabel}"${sender} was added to project ${projectLabel}.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER],
        userIds: input.estimatorIds,
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
          mailSubject: input.mailSubject,
          fromName: input.fromName,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit MAIL_LINKED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyDraftReady(emailId: string, projectName: string, customerName: string): Promise<void> {
    try {
      const created = await this.notificationRepository.create({
        type: NotificationType.DRAFT_REQUIRES_REVIEW as NotificationType,
        title: 'New AI Draft Requires Review',
        message: `A potential project "${projectName}" from ${customerName} is waiting in your drafts.`,
        projectId: null, // It's not a project yet!
        roles: [UserRole.SALES_MANAGER],
        payload: { emailId, projectName, customerName },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit DRAFT_REQUIRES_REVIEW notification', {
        emailId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyCloudLinkFailed(input: {
    emailId: string;
    mailSubject: string;
    sender: string;
    failedUrls: string[];
  }): Promise<void> {
    try {
      const urlsLabel = input.failedUrls.length === 1
        ? 'a cloud document link' : `${input.failedUrls.length} cloud document links`;
      const created = await this.notificationRepository.create({
        type: NotificationType.CLOUD_LINK_FAILED,
        title: 'Cloud link download failed',
        message: `Failed to download ${urlsLabel} from email "${input.mailSubject}" sent by ${input.sender}. If this relates to an existing project, please upload the files manually to that project. If it is a new project, please create the project manually.`,
        projectId: null,
        roles: [UserRole.SALES_MANAGER],
        payload: {
          emailId: input.emailId,
          failedUrls: input.failedUrls,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit CLOUD_LINK_FAILED notification', {
        emailId: input.emailId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  // Teams counterpart of notifyCloudLinkFailed: a Dropbox link shared in a Teams
  // channel could not be downloaded, so the sales manager must upload it by hand.
  // Unlike the email flow, the message already belongs to a project, so the
  // notification links straight to it and names the channel + the failed link(s).
  public async notifyTeamsCloudLinkFailed(input: {
    projectId: string | null;
    channelName?: string | null;
    teamName?: string | null;
    failedUrls: string[];
    messageId?: string | null;
  }): Promise<void> {
    if (input.failedUrls.length === 0) return;
    try {
      const urlsLabel =
        input.failedUrls.length === 1
          ? 'a document'
          : `${input.failedUrls.length} documents`;
      const where = input.channelName
        ? `Teams channel "${input.channelName}"${input.teamName ? ` (${input.teamName})` : ''}`
        : 'a Teams channel';
      const created = await this.notificationRepository.create({
        type: NotificationType.CLOUD_LINK_FAILED,
        title: 'Cloud link download failed',
        message: `Failed to download ${urlsLabel} shared via Dropbox in ${where}. Please upload the file(s) manually to this project. Link(s): ${input.failedUrls.join(', ')}`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER],
        payload: {
          source: 'teams',
          failedUrls: input.failedUrls,
          ...(input.messageId ? { messageId: input.messageId } : {}),
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit CLOUD_LINK_FAILED (teams) notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  // Fired when a project's Teams workspace (team + channel) has been
  // auto-provisioned. Surfaces in the notification tab and links to the project.
  public async notifyTeamsWorkspaceCreated(input: {
    projectId: string;
    referenceNumber?: string | null;
    projectName: string;
    teamName: string;
    channelName: string;
  }): Promise<void> {
    try {
      const created = await this.notificationRepository.create({
        type: NotificationType.TEAMS_WORKSPACE_CREATED,
        title: 'Teams workspace ready',
        message: 'A Teams workspace and discussion channel are ready for this project.',
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER],
        payload: {
          ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
          projectName: input.projectName,
          teamName: input.teamName,
          channelName: input.channelName,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit TEAMS_WORKSPACE_CREATED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  // Fired once a project's Dropbox folder and its standard subfolders are
  // available. A dedupe key prevents routine syncs from becoming notifications.
  public async notifyDropboxWorkspaceCreated(
    input: IDropboxWorkspaceCreatedNotificationInput,
  ): Promise<void> {
    try {
      const label = input.referenceNumber
        ? projectLabelOf(input.referenceNumber, input.projectName)
        : input.projectName;
      const result = await this.notificationRepository.createIfAbsent({
        type: NotificationType.DROPBOX_WORKSPACE_CREATED,
        title: 'Dropbox folder created',
        message: `Dropbox folder created successfully for ${label}.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION],
        userIds: input.estimatorIds ?? [],
        payload: {
          ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
          projectName: input.projectName,
          folderPath: input.folderPath,
        },
        dedupeKey: `dropbox-workspace:${input.projectId}`,
      });
      if (result.created) this.emitCreated(result.notification);
    } catch (error) {
      console.error('[Notification] failed to emit DROPBOX_WORKSPACE_CREATED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyTeamsWorkspaceNeedsDecision(input: {
    projectId: string;
    projectName: string;
    candidateCount: number;
  }): Promise<void> {
    try {
      const message =
        input.candidateCount > 0
          ? `We found ${input.candidateCount} possible Teams channel(s) for project ${input.projectName}. Review and connect one.`
          : `No existing Teams channel matched project ${input.projectName}. Create one or connect it manually.`;
      const created = await this.notificationRepository.create({
        type: NotificationType.TEAMS_WORKSPACE_NEEDS_DECISION,
        title: 'Teams workspace needs your action',
        message,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER],
        payload: { projectName: input.projectName, candidateCount: input.candidateCount },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit TEAMS_WORKSPACE_NEEDS_DECISION notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  // Fired when GFS gave up adding someone to a project's team, so a person can add them by hand.
  public async notifyTeamsMemberNotAdded(input: {
    projectId: string;
    referenceNumber?: string | null;
    projectName: string | null;
    memberName: string;
    memberEmail: string;
    reason: string;
  }): Promise<void> {
    try {
      const created = await this.notificationRepository.create({
        type: NotificationType.TEAMS_MEMBER_NOT_ADDED,
        title: 'Teams access needs attention',
        message: `${input.memberName} could not be added to this project's Teams workspace. Add the member manually in Teams.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER],
        payload: {
          ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
          projectName: input.projectName,
          memberName: input.memberName,
          memberEmail: input.memberEmail,
          reason: input.reason,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit TEAMS_MEMBER_NOT_ADDED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async listForUser(params: IListNotificationsParams): Promise<INotificationListResult> {
    const skip = (params.page - 1) * params.limit;
    const [rows, total, unreadCount] = await Promise.all([
      this.notificationRepository.listForRole(params.role, params.userId, { skip, limit: params.limit }),
      this.notificationRepository.countForRole(params.role, params.userId),
      this.notificationRepository.countUnreadForRole(params.role, params.userId),
    ]);
    const opportunityEmailIds = rows
      .filter((row) => row.type === NotificationType.DRAFT_REQUIRES_REVIEW)
      .map((row) => String(row.payload?.['emailId'] ?? ''))
      .filter(Boolean);
    let opportunityStatuses = new Map<string, OpportunityStatus>();
    try {
      opportunityStatuses = await this.opportunityStatusResolver(opportunityEmailIds);
    } catch (error) {
      console.error('[Notification] failed to resolve opportunity lifecycle', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return {
      items: rows.map((row) => {
        const emailId = String(row.payload?.['emailId'] ?? '');
        return this.toView(row, params.userId, opportunityStatuses.get(emailId));
      }),
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
      unreadCount,
    };
  }

  public async unreadCount(params: IUnreadCountParams): Promise<number> {
    return this.notificationRepository.countUnreadForRole(params.role, params.userId);
  }

  public async unreadDraftAlertCount(params: IUnreadCountParams): Promise<number> {
    return this.notificationRepository.countUnreadDraftAlertsForRole(params.role, params.userId);
  }

  public async markRead(id: string, userId: string): Promise<boolean> {
    return this.notificationRepository.markRead(id, userId);
  }

  public async markAllRead(role: UserRole, userId: string): Promise<number> {
    return this.notificationRepository.markAllReadForRole(role, userId);
  }

  public async markAllDraftAlertsRead(role: UserRole, userId: string): Promise<number> {
    return this.notificationRepository.markAllDraftAlertsReadForRole(role, userId);
  }

  public async clearAllMail(role: UserRole, userId: string): Promise<number> {
    return this.notificationRepository.dismissAllMailForRole(role, userId);
  }

  public async notifyProjectProcessing(input: IDocsProcessingNotificationInput): Promise<void> {
    try {
      const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
      const created = await this.notificationRepository.create({
        type: NotificationType.DOCS_PROCESSING,
        title: 'Project drawings processing',
        message: `Drawings for project ${projectLabel} are currently being processed by the AI.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER, UserRole.ESTIMATOR],
        userIds: input.estimatorIds,
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit DOCS_PROCESSING notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyProjectProcessed(input: IDocsProcessingNotificationInput): Promise<void> {
    try {
      const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
      const created = await this.notificationRepository.create({
        type: NotificationType.DOCS_PROCESSED,
        title: 'Project ready for estimation',
        message: `AI extraction for project ${projectLabel} is complete. The project is ready for estimator review.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER, UserRole.ESTIMATOR],
        userIds: input.estimatorIds,
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit DOCS_PROCESSED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyProjectCompleted(input: IProjectCompletedNotificationInput): Promise<void> {
    try {
      const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
      const result = await this.notificationRepository.createIfAbsent({
        type: NotificationType.PROJECT_COMPLETED,
        title: 'Project completed',
        message: `Project ${projectLabel} completed the estimator workflow. Excel is ready for download.`,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER, UserRole.ESTIMATOR],
        userIds: input.estimatorIds,
        dedupeKey: `${NotificationType.PROJECT_COMPLETED}:${input.completionKey ?? input.projectId}`,
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
        },
      });
      if (result.created) this.emitCreated(result.notification);
    } catch (error) {
      console.error('[Notification] failed to emit PROJECT_COMPLETED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async notifyDocumentAdded(input: IDocumentAddedNotificationInput): Promise<void> {
    try {
      const projectLabel = projectLabelOf(input.referenceNumber, input.projectName);
      const filesText = input.fileNames.join(', ');
      const isDropbox = input.source === 'dropbox';
      const title = isDropbox ? 'New document uploaded in Dropbox' : 'New document added';
      const message = isDropbox
        ? `New document "${filesText}" has been uploaded in Dropbox for ${projectLabel}.`
        : `New document "${filesText}" added to project ${projectLabel}.`;
      const created = await this.notificationRepository.create({
        type: NotificationType.DOCUMENT_ADDED,
        title,
        message,
        projectId: input.projectId,
        roles: [UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION, UserRole.ESTIMATOR],
        userIds: input.estimatorIds,
        payload: {
          referenceNumber: input.referenceNumber,
          projectName: input.projectName,
          fileNames: input.fileNames,
          source: input.source ?? 'manual',
        },
      });
      this.emitCreated(created);
    } catch (error) {
      console.error('[Notification] failed to emit DOCUMENT_ADDED notification', {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private emitCreated(notification: INotificationDomain): void {
    const payload: NotificationCreatedPayload = {
      roles: notification.roles,
      userIds: notification.userIds,
      view: this.toView(notification, ''),
    };
    notificationEventBus.emit(NotificationEvent.CREATED, payload);
  }

  private toView(
    notification: INotificationDomain,
    userId: string,
    opportunityStatus?: OpportunityStatus,
  ): INotificationView {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      projectId: notification.projectId,
      payload: notification.payload,
      opportunityStatus: notification.type === NotificationType.DRAFT_REQUIRES_REVIEW
        ? opportunityStatus ?? 'OPEN'
        : null,
      isRead: userId.length > 0 && notification.readBy.includes(userId),
      createdAt: notification.createdAt,
    };
  }

}
