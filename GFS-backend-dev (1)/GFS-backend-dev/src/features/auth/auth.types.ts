import type { AuthProvider, UserRole } from '@db/models/user.model';

export type OAuthProvider = 'microsoft' | 'google';

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IRegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface IAuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface IAuthUser {
  id: string;
  email: string;
  authProvider: AuthProvider;
  providerId?: string | null;
  role: UserRole;
  firstName: string;
  lastName: string;
  isActive: boolean;
  passwordHash?: string;
  refreshTokenHash?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result returned by the password-login service.
 *
 * The controller serializes the user before sending the response so the
 * password and refresh-token hashes can never cross the HTTP boundary.
 */
export interface IAuthLoginResult extends IAuthTokens {
  user: IAuthUser;
}

export interface IOAuthProfile {
  email: string;
  firstName: string;
  lastName: string;
  providerId: string;
}

export interface IForgotPasswordRequest {
  email: string;
}

export interface ISetPasswordRequest {
  token: string;
  password: string;
}
