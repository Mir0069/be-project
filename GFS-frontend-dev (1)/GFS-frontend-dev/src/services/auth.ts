// services/auth.ts

import {
  apiClient,
  publicClient,
} from "@/shared/api/client";

import type {
  ApiResponse,
  LoginPayload,
  MeResponse,
  RegisterPayload,
} from "@/shared/types/auth.types";

// Login
export const loginUser = async (
  payload: LoginPayload
): Promise<ApiResponse<MeResponse>> => {
  const { data } = await publicClient.post<
    ApiResponse<MeResponse>
  >("/auth/login", payload);

  return data;
};

// Get Current Logged In User
export const getCurrentUser = async () => {
  const { data } = await apiClient.get<
    ApiResponse<MeResponse>
  >("/auth/me");

  return data.data?.user;
};

// Clear tokens left by older deployments that returned an access token in the
// login response. The current cookie-based session does not need this token,
// but removing it prevents the auth query from restoring a session after logout.
export const clearStoredAccessToken = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("accessToken");
  }
};

// Logout
export const logoutUser = async () => {
  try {
    const { data } = await apiClient.post<
      ApiResponse
    >("/auth/logout");

    return data;
  } finally {
    // Clear the client session even when the server token is already expired.
    clearStoredAccessToken();
  }
};

// Register
export const registerUser = async (
  payload: RegisterPayload
) => {
  const { data } = await apiClient.post<
    ApiResponse
  >("/auth/register", payload);

  return data;
};

export interface ForgotPasswordPayload {
  email: string;
}

// Forgot Password
export const forgotPassword =
  async (
    payload: ForgotPasswordPayload
  ) => {

    const { data } =
      await publicClient.post<
        ApiResponse
      >(
        "/auth/forgot-password",
        payload
      );

    return data;

};

