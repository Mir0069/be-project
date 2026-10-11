// shared/types/auth.types.ts

export type UserRole =
  | "ESTIMATOR"
  | "SALES_MANAGER"
  | "SYSTEM_ADMIN"
  | "SUPER_ADMIN"
  | "HEAD_OF_DIVISION";

export type AuthProvider =
  | "LOCAL"
  | "GOOGLE"
  | "MICROSOFT";


  // Common API Response
export interface ApiResponse<T = undefined> {
  success: boolean;
  message?: string;
  data?: T;
}

//  Login Request Payload Type
export interface LoginPayload {
  email: string;
  password: string;
}

//  Register Request Payload Type
export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

//  Authenticated User Type
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;

  authProvider: AuthProvider;
  providerId: string | null;

  isActive: boolean;

  createdAt: string;
  updatedAt: string;
}

// /me response
export interface MeResponse {
  user: AuthUser;
}