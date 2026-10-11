import type { AuthProvider, UserRole } from '@db/models/user.model';
import type { IAuthUser } from '@features/auth/auth.types';

export interface IUpdateUserFields {
  refreshTokenHash?: string | null;
  authProvider?: AuthProvider;
  providerId?: string;
  passwordHash?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface ICreateUserFields {
  email: string;
  passwordHash?: string;
  authProvider?: AuthProvider;
  providerId?: string;
  role: UserRole;
  firstName: string;
  lastName: string;
}

export interface IUserRepository {
  findByEmail(email: string): Promise<IAuthUser | null>;
  findById(id: string): Promise<IAuthUser | null>;
  findByProviderId(provider: AuthProvider, providerId: string): Promise<IAuthUser | null>;
  findByEmailWithPassword(email: string): Promise<IAuthUser | null>;
  findByIdWithRefreshToken(id: string): Promise<IAuthUser | null>;
  updateById(id: string, fields: IUpdateUserFields): Promise<void>;
  create(fields: ICreateUserFields): Promise<IAuthUser>;
  findAll(): Promise<IAuthUser[]>;
}
