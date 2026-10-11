import type { NotificationType } from '@db/models/notification.model';
import type { UserRole } from '@db/models/user.model';

export type OpportunityStatus = 'OPEN' | 'CONVERTED' | 'REJECTED';

export interface INotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId: string | null;
  payload: Record<string, unknown> | null;
  opportunityStatus: OpportunityStatus | null;
  isRead: boolean;
  createdAt: Date;
}

export interface INotificationListResult {
  items: INotificationView[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export interface IProjectCreatedNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string;
  zohoLeadId: string;
  leadName: string | null;
  leadStatus: string | null;
  creationSource: string;
}

export interface IAssignedEstimator {
  id: string;
  name: string | null;
  email?: string | null;
}

export interface IEstimatorAssignedNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  estimators: IAssignedEstimator[];
  assignedByName?: string | null;
  sendEmail?: boolean;
}

export interface IStage7ApprovalRequestedNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  approverId: string;
  approverName: string;
  finalPrice: number | null;
  assignedByName: string | null;
}

export interface IMailLinkedNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  mailSubject: string | null;
  fromName: string | null;
  estimatorIds: string[];
}

export interface IFollowUpActivityNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  leadOwner: string | null;
}

export interface IDocsProcessingNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  estimatorIds: string[];
}

export interface IProjectCompletedNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  estimatorIds: string[];
  completionKey?: string;
}
export interface IListNotificationsParams {
  role: UserRole;
  userId: string;
  page: number;
  limit: number;
}

export interface IUnreadCountParams {
  role: UserRole;
  userId: string;
}

export interface IDropboxWorkspaceCreatedNotificationInput {
  projectId: string;
  referenceNumber?: string | null;
  projectName: string;
  folderPath: string;
  estimatorIds?: string[];
}

export interface IDocumentAddedNotificationInput {
  projectId: string;
  referenceNumber: string;
  projectName: string | null;
  fileNames: string[];
  estimatorIds: string[];
  source?: string;
}

