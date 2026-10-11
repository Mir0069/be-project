import type { UserRole } from '@db/models/user.model';
import type { NotificationType } from '@db/models/notification.model';

export interface ICreateNotificationFields {
  type: NotificationType;
  title: string;
  message: string;
  projectId?: string | null;
  roles: UserRole[];
  userIds?: string[];
  payload?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

export interface INotificationDomain {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId: string | null;
  roles: UserRole[];
  userIds: string[];
  payload: Record<string, unknown> | null;
  readBy: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IPageOptions {
  skip: number;
  limit: number;
}

export interface ICreateNotificationResult {
  notification: INotificationDomain;
  created: boolean;
}

// A notification is visible to a user if their role is in `roles` OR their id is in `userIds`.
export interface INotificationRepository {
  create(fields: ICreateNotificationFields): Promise<INotificationDomain>;
  createIfAbsent(fields: ICreateNotificationFields): Promise<ICreateNotificationResult>;
  /**
   * Keep one actionable Stage 7 approval request per project. Reassigning an
   * approver replaces the recipient and content instead of adding another
   * queue item.
   */
  replaceProposalApprovalRequest(fields: ICreateNotificationFields): Promise<INotificationDomain>;
  listForRole(role: UserRole, userId: string, options: IPageOptions): Promise<INotificationDomain[]>;
  countForRole(role: UserRole, userId: string): Promise<number>;
  countUnreadForRole(role: UserRole, userId: string): Promise<number>;
  countUnreadDraftAlertsForRole(role: UserRole, userId: string): Promise<number>;
  markRead(id: string, userId: string): Promise<boolean>;
  markAllReadForRole(role: UserRole, userId: string): Promise<number>;
  markAllDraftAlertsReadForRole(role: UserRole, userId: string): Promise<number>;
  dismissAllMailForRole(role: UserRole, userId: string): Promise<number>;
  deleteProposalApprovalRequests(projectId: string, approverId: string): Promise<number>;
}
