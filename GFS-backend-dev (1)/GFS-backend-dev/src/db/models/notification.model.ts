import mongoose, { Document, Schema } from 'mongoose';

import { UserRole } from '@db/models/user.model';
import { hasAnyRole } from '@shared/security/role-access';

export enum NotificationType {
  PROJECT_CREATED = 'PROJECT_CREATED',
  PROJECT_ASSIGNED = 'PROJECT_ASSIGNED',
  MAIL_LINKED = 'MAIL_LINKED',
  DRAFT_REQUIRES_REVIEW = 'DRAFT_REQUIRES_REVIEW',
  CLOUD_LINK_FAILED = 'CLOUD_LINK_FAILED',
  TEAMS_WORKSPACE_CREATED = 'TEAMS_WORKSPACE_CREATED',
  DROPBOX_WORKSPACE_CREATED = 'DROPBOX_WORKSPACE_CREATED',
  TEAMS_WORKSPACE_NEEDS_DECISION = 'TEAMS_WORKSPACE_NEEDS_DECISION',
  TEAMS_MEMBER_NOT_ADDED = 'TEAMS_MEMBER_NOT_ADDED',
  ZOHO_ACTIVITY_CREATED = 'ZOHO_ACTIVITY_CREATED',
  DOCS_PROCESSING = 'DOCS_PROCESSING',
  DOCS_PROCESSED = 'DOCS_PROCESSED',
  PROJECT_COMPLETED = 'PROJECT_COMPLETED',
  DOCUMENT_ADDED = 'DOCUMENT_ADDED',
  PROPOSAL_APPROVAL_REQUESTED = 'PROPOSAL_APPROVAL_REQUESTED',
}

const GLOBAL_VIEW_NOTIFICATION_ROLES: readonly UserRole[] = [
  UserRole.SALES_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
];

export const canViewAllNotifications = (role: UserRole): boolean =>
  hasAnyRole(role, GLOBAL_VIEW_NOTIFICATION_ROLES);

export interface INotification extends Document {
  type: NotificationType;
  title: string;
  message: string;
  projectId?: mongoose.Types.ObjectId | null;
  roles: UserRole[];
  // Users this notification is targeted at directly (e.g. a specific estimator assigned to a project).
  // A notification is delivered to a user if their role is in `roles` OR their id is in `userIds`.
  userIds: mongoose.Types.ObjectId[];
  payload?: Record<string, unknown> | null;
  // Optional application-level idempotency key for lifecycle notifications.
  dedupeKey?: string | null;
  readBy: mongoose.Types.ObjectId[];
  // Clearing a notification is personal to the recipient. Keep the shared
  // notification for other eligible users while excluding it from this user's
  // feed.
  dismissedBy: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    type: { type: String, enum: Object.values(NotificationType), required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    roles: { type: [String], enum: Object.values(UserRole), required: true, default: [] },
    userIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    payload: { type: Schema.Types.Mixed, default: null },
    dedupeKey: { type: String, trim: true },
    readBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    dismissedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true },
);

NotificationSchema.index({ roles: 1, createdAt: -1 });
NotificationSchema.index({ userIds: 1, createdAt: -1 });
NotificationSchema.index({ dismissedBy: 1, createdAt: -1 });
// Existing notifications do not have a dedupeKey, so the sparse unique index
// can be introduced without changing or colliding with historical records.
NotificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
