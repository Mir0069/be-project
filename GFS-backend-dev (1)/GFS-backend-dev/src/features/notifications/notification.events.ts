import { EventEmitter } from 'events';

import type { UserRole } from '@db/models/user.model';

import type { INotificationView } from './notification.types';

export const notificationEventBus = new EventEmitter();

export enum NotificationEvent {
  CREATED = 'CREATED',
}

export interface NotificationCreatedPayload {
  roles: UserRole[];
  userIds: string[];
  view: INotificationView;
}
