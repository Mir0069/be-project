import type { HydratedDocument } from 'mongoose';

import {
  Notification,
  NotificationType,
  canViewAllNotifications,
} from '@db/models/notification.model';
import type { INotification } from '@db/models/notification.model';
import { UserRole } from '@db/models/user.model';
import type {
  ICreateNotificationFields,
  ICreateNotificationResult,
  INotificationDomain,
  INotificationRepository,
  IPageOptions,
} from '@repositories/interfaces/i-notification.repository';

export class MongooseNotificationRepository implements INotificationRepository {
  public async create(fields: ICreateNotificationFields): Promise<INotificationDomain> {
    const notification = await Notification.create({
      type: fields.type,
      title: fields.title,
      message: fields.message,
      projectId: fields.projectId ?? null,
      roles: fields.roles,
      userIds: fields.userIds ?? [],
      payload: fields.payload ?? null,
      ...(fields.dedupeKey ? { dedupeKey: fields.dedupeKey } : {}),
    });
    return this.toDomain(notification);
  }

  public async createIfAbsent(
    fields: ICreateNotificationFields,
  ): Promise<ICreateNotificationResult> {
    if (!fields.dedupeKey) {
      return { notification: await this.create(fields), created: true };
    }

    const insertFields = {
      type: fields.type,
      title: fields.title,
      message: fields.message,
      projectId: fields.projectId ?? null,
      roles: fields.roles,
      userIds: fields.userIds ?? [],
      payload: fields.payload ?? null,
      dedupeKey: fields.dedupeKey,
    };

    try {
      const result = await Notification.findOneAndUpdate(
        { dedupeKey: fields.dedupeKey },
        { $setOnInsert: insertFields },
        {
          returnDocument: 'after',
          upsert: true,
          includeResultMetadata: true,
        },
      );

      if (!result.value) {
        throw new Error('Notification upsert did not return a document');
      }

      return {
        notification: this.toDomain(result.value),
        created: result.lastErrorObject?.updatedExisting === false,
      };
    } catch (error: any) {
      // A concurrent caller may win the unique insert between the upsert
      // attempts. Return that already-created notification instead of emitting
      // a duplicate or failing the workflow.
      if (error?.code !== 11000) throw error;

      const existing = await Notification.findOne({ dedupeKey: fields.dedupeKey });
      if (!existing) throw error;

      return { notification: this.toDomain(existing), created: false };
    }
  }

  public async listForRole(
    role: UserRole,
    userId: string,
    options: IPageOptions,
  ): Promise<INotificationDomain[]> {
    const notifications = await Notification.find(this.audienceFilter(role, userId))
      .sort({ createdAt: -1 })
      .skip(options.skip)
      .limit(options.limit);
    return notifications.map((notification) => this.toDomain(notification));
  }

  public async countForRole(role: UserRole, userId: string): Promise<number> {
    return Notification.countDocuments(this.audienceFilter(role, userId));
  }

  public async countUnreadForRole(role: UserRole, userId: string): Promise<number> {
    return Notification.countDocuments({
      ...this.audienceFilter(role, userId),
      readBy: { $ne: userId },
    });
  }

  public async countUnreadDraftAlertsForRole(role: UserRole, userId: string): Promise<number> {
    return Notification.countDocuments({
      ...this.audienceFilter(role, userId),
      type: NotificationType.DRAFT_REQUIRES_REVIEW,
      readBy: { $ne: userId },
    });
  }

  public async markRead(id: string, userId: string): Promise<boolean> {
    const result = await Notification.updateOne({ _id: id }, { $addToSet: { readBy: userId } });
    return result.matchedCount > 0;
  }

  public async markAllReadForRole(role: UserRole, userId: string): Promise<number> {
    const result = await Notification.updateMany(
      { ...this.audienceFilter(role, userId), readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } },
    );
    return result.modifiedCount;
  }

  public async markAllDraftAlertsReadForRole(role: UserRole, userId: string): Promise<number> {
    const result = await Notification.updateMany(
      {
        ...this.audienceFilter(role, userId),
        type: NotificationType.DRAFT_REQUIRES_REVIEW,
        readBy: { $ne: userId },
      },
      { $addToSet: { readBy: userId } },
    );
    return result.modifiedCount;
  }

  public async dismissAllMailForRole(role: UserRole, userId: string): Promise<number> {
    const result = await Notification.updateMany(
      {
        ...this.audienceFilter(role, userId),
        type: NotificationType.MAIL_LINKED,
      },
      { $addToSet: { dismissedBy: userId } },
    );
    return result.modifiedCount;
  }

  public async replaceProposalApprovalRequest(
    fields: ICreateNotificationFields,
  ): Promise<INotificationDomain> {
    if (!fields.projectId) {
      throw new Error('A project approval notification requires a project id');
    }

    // Approval requests are a live work queue, not an audit trail. A stable
    // key gives every project exactly one active request even if an assignment
    // is retried or the approver is changed.
    const dedupeKey = `proposal-approval:${fields.projectId}`;
    const now = new Date();
    const notification = await Notification.findOneAndUpdate(
      { dedupeKey },
      {
        $set: {
          type: fields.type,
          title: fields.title,
          message: fields.message,
          projectId: fields.projectId,
          roles: fields.roles,
          userIds: fields.userIds ?? [],
          payload: fields.payload ?? null,
          readBy: [],
          // A reassigned request is newly actionable and should return to the
          // top of the recipient's notification list.
          createdAt: now,
        },
        $setOnInsert: { dedupeKey },
      },
      { returnDocument: 'after', upsert: true },
    );

    if (!notification) {
      throw new Error('Approval notification upsert did not return a document');
    }

    // Remove copies created before the project-level idempotency key existed,
    // as well as requests left behind for a previously assigned approver.
    await Notification.deleteMany({
      type: NotificationType.PROPOSAL_APPROVAL_REQUESTED,
      projectId: fields.projectId,
      _id: { $ne: notification._id },
    });

    return this.toDomain(notification);
  }

  public async deleteProposalApprovalRequests(projectId: string, approverId: string): Promise<number> {
    const result = await Notification.deleteMany({
      type: NotificationType.PROPOSAL_APPROVAL_REQUESTED,
      projectId,
      userIds: approverId,
    });
    return result.deletedCount;
  }

  private audienceFilter(role: UserRole, userId: string) {
    const audience = canViewAllNotifications(role) ? {} : { userIds: userId };
    const notDismissed = { dismissedBy: { $ne: userId } };

    // Draft opportunities are a Sales Manager queue. Keep this role boundary
    // in the repository so list and unread-count queries stay consistent.
    if (role === UserRole.ESTIMATOR) {
      return {
        ...audience,
        ...notDismissed,
        type: { $ne: NotificationType.DRAFT_REQUIRES_REVIEW },
      };
    }

    // A proposal approval request is addressed to the one Sales Manager
    // assigned as approver, not "any Sales Manager" — global visibility must
    // not leak it to every Sales Manager the way project-wide notifications
    // (e.g. PROJECT_ASSIGNED) are meant to be seen. Admins keep full
    // visibility here since they can approve on any project as an override.
    if (role === UserRole.SALES_MANAGER) {
      return {
        ...audience,
        ...notDismissed,
        $or: [
          { type: { $ne: NotificationType.PROPOSAL_APPROVAL_REQUESTED } },
          { userIds: userId },
        ],
      };
    }

    return { ...audience, ...notDismissed };
  }

  private toDomain(notification: HydratedDocument<INotification>): INotificationDomain {
    return {
      id: notification._id.toString(),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      projectId: notification.projectId ? notification.projectId.toString() : null,
      roles: notification.roles,
      userIds: (notification.userIds ?? []).map((entry) => entry.toString()),
      payload: (notification.payload ?? null) as Record<string, unknown> | null,
      readBy: notification.readBy.map((entry) => entry.toString()),
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }
}
