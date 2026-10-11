import type { UserRole } from '@db/models/user.model';

export type CreatableUserRole =
  | UserRole.ESTIMATOR
  | UserRole.SALES_MANAGER
  | UserRole.SYSTEM_ADMIN
  | UserRole.SUPER_ADMIN
  | UserRole.HEAD_OF_DIVISION;

export interface ICreateUserRequest {
  firstName: string;
  lastName: string;
  email: string;
  role: CreatableUserRole;
}

export interface IEditUserRequest {
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface IPublicUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

export interface ICreateUserResult {
  user: IPublicUser;
  inviteSent: boolean;
}
