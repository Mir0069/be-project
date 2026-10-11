import { UserRole } from '@db/models/user.model';
import { NotificationType } from '@db/models/notification.model';
import { NotificationService } from '@features/notifications/notification.service';
import {
  notificationEventBus,
  NotificationEvent,
} from '@features/notifications/notification.events';
import type {
  INotificationDomain,
  INotificationRepository,
} from '@repositories/interfaces/i-notification.repository';

const makeRepo = (): jest.Mocked<INotificationRepository> => ({
  create: jest.fn(),
  createIfAbsent: jest.fn(),
  replaceProposalApprovalRequest: jest.fn(),
  listForRole: jest.fn(),
  countForRole: jest.fn(),
  countUnreadForRole: jest.fn(),
  countUnreadDraftAlertsForRole: jest.fn(),
  markRead: jest.fn(),
  markAllReadForRole: jest.fn(),
  markAllDraftAlertsReadForRole: jest.fn(),
  dismissAllMailForRole: jest.fn(),
  deleteProposalApprovalRequests: jest.fn(),
});

const domain = (overrides: Partial<INotificationDomain> = {}): INotificationDomain => ({
  id: 'n1',
  type: NotificationType.PROJECT_CREATED,
  title: 'New project created',
  message: 'msg',
  projectId: 'p1',
  roles: [UserRole.ESTIMATOR, UserRole.SALES_MANAGER],
  userIds: [],
  payload: { referenceNumber: 'GFS-2026-1001' },
  readBy: [],
  createdAt: new Date('2026-06-24T00:00:00.000Z'),
  updatedAt: new Date('2026-06-24T00:00:00.000Z'),
  ...overrides,
});

describe('NotificationService', () => {
  let repo: jest.Mocked<INotificationRepository>;
  let service: NotificationService;

  beforeEach(() => {
    repo = makeRepo();
    service = new NotificationService(repo);
  });

  describe('notifyProjectCreated', () => {
    it('creates a PROJECT_CREATED notification for sales managers and emits it', async () => {
      const created = domain();
      repo.create.mockResolvedValue(created);
      const emitSpy = jest.spyOn(notificationEventBus, 'emit');

      await service.notifyProjectCreated({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme',
        zohoLeadId: 'z1',
        leadName: 'Acme Lead',
        leadStatus: 'Need to Quote',
        creationSource: 'ZOHO_FIRST',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.PROJECT_CREATED,
          roles: [UserRole.SALES_MANAGER],
          projectId: 'p1',
          payload: expect.objectContaining({
            referenceNumber: 'PRJ-2026-0001',
            projectName: 'Acme',
            zohoLeadId: 'z1',
          }),
        }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        NotificationEvent.CREATED,
        expect.objectContaining({
          roles: created.roles,
          view: expect.objectContaining({ id: 'n1', isRead: false }),
        }),
      );
    });

    it('swallows repository errors so the caller never throws', async () => {
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyProjectCreated({
          projectId: 'p1',
          referenceNumber: 'r',
          projectName: 'n',
          zohoLeadId: 'z',
          leadName: null,
          leadStatus: null,
          creationSource: 'ZOHO_FIRST',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyEstimatorAssigned', () => {
    it('creates one PROJECT_ASSIGNED notification per estimator, each targeted privately', async () => {
      repo.create.mockImplementation(async (fields) =>
        domain({ type: NotificationType.PROJECT_ASSIGNED, roles: [], userIds: fields.userIds ?? [] }),
      );

      await service.notifyEstimatorAssigned({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme',
        estimators: [
          { id: 'est-1', name: 'Dan Muniz' },
          { id: 'est-2', name: 'Jane Roe' },
        ],
      });

      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: NotificationType.PROJECT_ASSIGNED,
          projectId: 'p1',
          roles: [],
          userIds: ['est-1'],
          message: expect.stringContaining('Dan Muniz'),
        }),
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ userIds: ['est-2'], message: expect.stringContaining('Jane Roe') }),
      );
    });

    it('does nothing when there are no estimators to notify', async () => {
      await service.notifyEstimatorAssigned({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme',
        estimators: [],
      });

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('swallows repository errors so the caller never throws', async () => {
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyEstimatorAssigned({
          projectId: 'p1',
          referenceNumber: 'r',
          projectName: null,
          estimators: [{ id: 'est-1', name: 'Dan' }],
        }),
      ).resolves.toBeUndefined();
    });

    it('sends email to newly assigned estimator when mailerService is provided', async () => {
      const mockMailer = {
        sendMail: jest.fn(),
        sendInviteLink: jest.fn(),
        sendPasswordResetLink: jest.fn(),
        sendEstimatorAssignedNotification: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithMailer = new NotificationService(repo, undefined, mockMailer as any);

      await serviceWithMailer.notifyEstimatorAssigned({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Facade',
        estimators: [{ id: 'est-1', name: 'Dan Muniz', email: 'dan@example.com' }],
        assignedByName: 'Sarah Manager',
      });

      expect(mockMailer.sendEstimatorAssignedNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dan@example.com',
          recipientName: 'Dan Muniz',
          referenceNumber: 'PRJ-2026-0001',
          projectName: 'Acme Facade',
          assignedByName: 'Sarah Manager',
        }),
      );
    });

    it('skips email sending when sendEmail is false', async () => {
      const mockMailer = {
        sendMail: jest.fn(),
        sendInviteLink: jest.fn(),
        sendPasswordResetLink: jest.fn(),
        sendEstimatorAssignedNotification: jest.fn(),
      };
      const serviceWithMailer = new NotificationService(repo, undefined, mockMailer as any);

      await serviceWithMailer.notifyEstimatorAssigned({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Facade',
        estimators: [{ id: 'est-1', name: 'Dan Muniz', email: 'dan@example.com' }],
        sendEmail: false,
      });

      expect(mockMailer.sendEstimatorAssignedNotification).not.toHaveBeenCalled();
      expect(mockMailer.sendMail).not.toHaveBeenCalled();
    });

    it('swallows mailer errors so estimator assignment is not blocked', async () => {
      const mockMailer = {
        sendMail: jest.fn(),
        sendInviteLink: jest.fn(),
        sendPasswordResetLink: jest.fn(),
        sendEstimatorAssignedNotification: jest.fn().mockRejectedValue(new Error('Graph API 503')),
      };
      const serviceWithMailer = new NotificationService(repo, undefined, mockMailer as any);

      await expect(
        serviceWithMailer.notifyEstimatorAssigned({
          projectId: 'p1',
          referenceNumber: 'PRJ-2026-0001',
          projectName: 'Acme Facade',
          estimators: [{ id: 'est-1', name: 'Dan Muniz', email: 'dan@example.com' }],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyTeamsMemberNotAdded', () => {
    it('asks sales managers to add the person by hand and links to the project', async () => {
      repo.create.mockResolvedValue(domain({ type: NotificationType.TEAMS_MEMBER_NOT_ADDED }));

      await service.notifyTeamsMemberNotAdded({
        projectId: 'p1',
        referenceNumber: 'GFS-2026-1001',
        projectName: 'Tower',
        memberName: 'Eli Est',
        memberEmail: 'eli@gfs.test',
        reason: 'No Microsoft account was found and guest invitations are not permitted (User.Invite.All).',
      });

      expect(repo.create).toHaveBeenCalledWith({
        type: NotificationType.TEAMS_MEMBER_NOT_ADDED,
        title: 'Teams access needs attention',
        message: 'Eli Est could not be added to this project\'s Teams workspace. Add the member manually in Teams.',
        projectId: 'p1',
        roles: [UserRole.SALES_MANAGER],
        payload: {
          referenceNumber: 'GFS-2026-1001',
          projectName: 'Tower',
          memberName: 'Eli Est',
          memberEmail: 'eli@gfs.test',
          reason: 'No Microsoft account was found and guest invitations are not permitted (User.Invite.All).',
        },
      });
    });

    it('never throws when the notification cannot be stored', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyTeamsMemberNotAdded({
          projectId: 'p1',
          projectName: null,
          memberName: 'Eli Est',
          memberEmail: 'eli@gfs.test',
          reason: 'x',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyMailLinked', () => {
    it('creates a MAIL_LINKED notification for sales managers and the project estimators', async () => {
      repo.create.mockResolvedValue(
        domain({ type: NotificationType.MAIL_LINKED, roles: [UserRole.SALES_MANAGER], userIds: ['est-1'] }),
      );

      await service.notifyMailLinked({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme',
        mailSubject: 'RE: quote',
        fromName: 'Amritanshu',
        estimatorIds: ['est-1'],
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.MAIL_LINKED,
          projectId: 'p1',
          roles: [UserRole.SALES_MANAGER],
          userIds: ['est-1'],
          message: expect.stringContaining('RE: quote'),
        }),
      );
    });

    it('swallows repository errors so the caller never throws', async () => {
      repo.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyMailLinked({
          projectId: 'p1',
          referenceNumber: 'r',
          projectName: null,
          mailSubject: null,
          fromName: null,
          estimatorIds: [],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('listForUser', () => {
    it('computes isRead per user, strips readBy, and reports pagination', async () => {
      repo.listForRole.mockResolvedValue([
        domain({ id: 'a', readBy: ['user-1'] }),
        domain({ id: 'b', readBy: [] }),
      ]);
      repo.countForRole.mockResolvedValue(2);
      repo.countUnreadForRole.mockResolvedValue(1);

      const result = await service.listForUser({
        role: UserRole.SALES_MANAGER,
        userId: 'user-1',
        page: 1,
        limit: 20,
      });

      expect(repo.listForRole).toHaveBeenCalledWith(UserRole.SALES_MANAGER, 'user-1', { skip: 0, limit: 20 });
      expect(repo.countForRole).toHaveBeenCalledWith(UserRole.SALES_MANAGER, 'user-1');
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
      expect(result.unreadCount).toBe(1);
      expect(result.items[0]).toMatchObject({ id: 'a', isRead: true });
      expect(result.items[1]).toMatchObject({ id: 'b', isRead: false });
      expect(result.items[0]).not.toHaveProperty('readBy');
    });

    it('derives skip from page and limit', async () => {
      repo.listForRole.mockResolvedValue([]);
      repo.countForRole.mockResolvedValue(0);
      repo.countUnreadForRole.mockResolvedValue(0);

      await service.listForUser({ role: UserRole.ESTIMATOR, userId: 'u', page: 3, limit: 10 });

      expect(repo.listForRole).toHaveBeenCalledWith(UserRole.ESTIMATOR, 'u', { skip: 20, limit: 10 });
    });

    it('reports the current lifecycle state for draft opportunities', async () => {
      const opportunity = domain({
        type: NotificationType.DRAFT_REQUIRES_REVIEW,
        projectId: null,
        payload: { emailId: 'email-1', projectName: '125 Main Street' },
      });
      repo.listForRole.mockResolvedValue([opportunity]);
      repo.countForRole.mockResolvedValue(1);
      repo.countUnreadForRole.mockResolvedValue(1);
      const resolveStatuses = jest.fn().mockResolvedValue(new Map([['email-1', 'CONVERTED']]));
      const lifecycleService = new NotificationService(repo, resolveStatuses);

      const result = await lifecycleService.listForUser({
        role: UserRole.SALES_MANAGER,
        userId: 'user-1',
        page: 1,
        limit: 20,
      });

      expect(resolveStatuses).toHaveBeenCalledWith(['email-1']);
      expect(result.items[0]).toMatchObject({
        type: NotificationType.DRAFT_REQUIRES_REVIEW,
        opportunityStatus: 'CONVERTED',
      });
      expect(result.items[0]?.payload).toEqual({
        emailId: 'email-1',
        projectName: '125 Main Street',
      });
    });
  });

  describe('notifyStage7ApprovalRequested', () => {
    it('keeps one project-level approval request while identifying the requester', async () => {
      repo.replaceProposalApprovalRequest.mockResolvedValue(
        domain({ type: NotificationType.PROPOSAL_APPROVAL_REQUESTED }),
      );

      await service.notifyStage7ApprovalRequested({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Tower',
        approverId: 'manager-1',
        approverName: 'Manager One',
        finalPrice: 12_500,
        assignedByName: 'Esther Estimator',
      });

      expect(repo.replaceProposalApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.PROPOSAL_APPROVAL_REQUESTED,
        title: 'Pending approval for PRJ-2026-0001 – Acme Tower',
        message: 'Approval request from Esther Estimator for PRJ-2026-0001 – Acme Tower.',
        payload: expect.objectContaining({ requestedByName: 'Esther Estimator' }),
      }));
    });
  });

  describe('notifyDropboxWorkspaceCreated', () => {
    it('emits one project-linked notification, regardless of later syncs', async () => {
      const created = domain({ type: NotificationType.DROPBOX_WORKSPACE_CREATED });
      repo.createIfAbsent.mockResolvedValue({ notification: created, created: true });
      const emitSpy = jest.spyOn(notificationEventBus, 'emit');

      await service.notifyDropboxWorkspaceCreated({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Tower',
        folderPath: '/GFS Projects/Acme Tower - PRJ-2026-0001',
        estimatorIds: ['est-1'],
      });

      expect(repo.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.DROPBOX_WORKSPACE_CREATED,
        title: 'Dropbox folder created',
        message: 'Dropbox folder created successfully for PRJ-2026-0001 – Acme Tower.',
        roles: [UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION],
        userIds: ['est-1'],
        projectId: 'p1',
        dedupeKey: 'dropbox-workspace:p1',
      }));
      expect(emitSpy).toHaveBeenCalledWith(NotificationEvent.CREATED, expect.any(Object));
    });
  });

  describe('notifyDocumentAdded', () => {
    it('creates a DOCUMENT_ADDED notification for sales manager, head of division, and estimators on Dropbox upload', async () => {
      const created = domain({ type: NotificationType.DOCUMENT_ADDED });
      repo.create.mockResolvedValue(created);
      const emitSpy = jest.spyOn(notificationEventBus, 'emit');

      await service.notifyDocumentAdded({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Tower',
        fileNames: ['floor_plan.pdf', 'elevation.pdf'],
        estimatorIds: ['est-1', 'est-2'],
        source: 'dropbox',
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.DOCUMENT_ADDED,
        title: 'New document uploaded in Dropbox',
        message: 'New document "floor_plan.pdf, elevation.pdf" has been uploaded in Dropbox for PRJ-2026-0001 – Acme Tower.',
        roles: [UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION, UserRole.ESTIMATOR],
        userIds: ['est-1', 'est-2'],
        projectId: 'p1',
        payload: expect.objectContaining({
          referenceNumber: 'PRJ-2026-0001',
          projectName: 'Acme Tower',
          fileNames: ['floor_plan.pdf', 'elevation.pdf'],
          source: 'dropbox',
        }),
      }));
      expect(emitSpy).toHaveBeenCalledWith(NotificationEvent.CREATED, expect.any(Object));
    });

    it('creates a standard DOCUMENT_ADDED notification when source is manual upload', async () => {
      const created = domain({ type: NotificationType.DOCUMENT_ADDED });
      repo.create.mockResolvedValue(created);

      await service.notifyDocumentAdded({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Tower',
        fileNames: ['quote.xlsx'],
        estimatorIds: ['est-1'],
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.DOCUMENT_ADDED,
        title: 'New document added',
        message: 'New document "quote.xlsx" added to project PRJ-2026-0001 – Acme Tower.',
        roles: [UserRole.SALES_MANAGER, UserRole.HEAD_OF_DIVISION, UserRole.ESTIMATOR],
        userIds: ['est-1'],
      }));
    });
  });

  describe('notifyTeamsWorkspaceCreated', () => {
    it('keeps the workspace notification concise because the project is displayed separately', async () => {
      repo.create.mockResolvedValue(domain({ type: NotificationType.TEAMS_WORKSPACE_CREATED }));

      await service.notifyTeamsWorkspaceCreated({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme Tower',
        teamName: 'GFS - Acme Tower',
        channelName: 'Acme Tower discussion',
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        type: NotificationType.TEAMS_WORKSPACE_CREATED,
        title: 'Teams workspace ready',
        message: 'A Teams workspace and discussion channel are ready for this project.',
      }));
    });
  });

  describe('resolveStage7ApprovalRequests', () => {
    it('removes only the completed project approval requests for its assigned approver', async () => {
      repo.deleteProposalApprovalRequests.mockResolvedValue(2);

      await service.resolveStage7ApprovalRequests('project-1', 'approver-1');

      expect(repo.deleteProposalApprovalRequests).toHaveBeenCalledWith('project-1', 'approver-1');
    });

    it('does not let notification cleanup failure affect an approved proposal', async () => {
      repo.deleteProposalApprovalRequests.mockRejectedValue(new Error('db down'));

      await expect(
        service.resolveStage7ApprovalRequests('project-1', 'approver-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('clearAllMail', () => {
    it('clears only mail notifications for the current user', async () => {
      repo.dismissAllMailForRole.mockResolvedValue(3);

      await expect(service.clearAllMail(UserRole.SALES_MANAGER, 'manager-1')).resolves.toBe(3);

      expect(repo.dismissAllMailForRole).toHaveBeenCalledWith(UserRole.SALES_MANAGER, 'manager-1');
    });
  });

  describe('markAllDraftAlertsRead', () => {
    it('marks only the current user\'s draft alerts as read', async () => {
      repo.markAllDraftAlertsReadForRole.mockResolvedValue(2);

      await expect(service.markAllDraftAlertsRead(UserRole.SALES_MANAGER, 'manager-1')).resolves.toBe(2);

      expect(repo.markAllDraftAlertsReadForRole).toHaveBeenCalledWith(UserRole.SALES_MANAGER, 'manager-1');
    });
  });

  describe('notifyProjectCompleted', () => {
    it('creates a completion notification for sales managers and assigned estimators', async () => {
      const created = domain({ type: NotificationType.PROJECT_COMPLETED });
      repo.createIfAbsent.mockResolvedValue({ notification: created, created: true });

      await service.notifyProjectCompleted({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme',
        estimatorIds: ['est-1'],
      });

      expect(repo.createIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.PROJECT_COMPLETED,
          roles: [UserRole.SALES_MANAGER, UserRole.ESTIMATOR],
          userIds: ['est-1'],
          dedupeKey: 'PROJECT_COMPLETED:p1',
          message: expect.stringContaining('Excel is ready for download.'),
        }),
      );
    });

    it('does not emit a duplicate when completion is retried', async () => {
      const created = domain({ type: NotificationType.PROJECT_COMPLETED });
      repo.createIfAbsent.mockResolvedValue({ notification: created, created: false });
      const emitSpy = jest.spyOn(notificationEventBus, 'emit');

      await service.notifyProjectCompleted({
        projectId: 'p1',
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Acme',
        estimatorIds: ['est-1'],
      });

      expect(repo.createIfAbsent).toHaveBeenCalledTimes(1);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('swallows repository errors so completion does not fail the workflow', async () => {
      repo.createIfAbsent.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyProjectCompleted({
          projectId: 'p1',
          referenceNumber: 'r',
          projectName: null,
          estimatorIds: [],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('delegations', () => {
    it('unreadCount delegates to the repository', async () => {
      repo.countUnreadForRole.mockResolvedValue(7);
      await expect(service.unreadCount({ role: UserRole.ESTIMATOR, userId: 'u' })).resolves.toBe(7);
      expect(repo.countUnreadForRole).toHaveBeenCalledWith(UserRole.ESTIMATOR, 'u');
    });

    it('unreadDraftAlertCount delegates to the repository', async () => {
      repo.countUnreadDraftAlertsForRole.mockResolvedValue(3);
      await expect(service.unreadDraftAlertCount({ role: UserRole.SALES_MANAGER, userId: 'u' })).resolves.toBe(3);
      expect(repo.countUnreadDraftAlertsForRole).toHaveBeenCalledWith(UserRole.SALES_MANAGER, 'u');
    });

    it('markRead delegates to the repository', async () => {
      repo.markRead.mockResolvedValue(true);
      await expect(service.markRead('n1', 'u')).resolves.toBe(true);
      expect(repo.markRead).toHaveBeenCalledWith('n1', 'u');
    });

    it('markAllRead delegates to the repository', async () => {
      repo.markAllReadForRole.mockResolvedValue(3);
      await expect(service.markAllRead(UserRole.SALES_MANAGER, 'u')).resolves.toBe(3);
      expect(repo.markAllReadForRole).toHaveBeenCalledWith(UserRole.SALES_MANAGER, 'u');
    });
  });
});
