import { apiClient } from "@/shared/api/client";

import type { ApiResponse } from "@/shared/types/auth.types";

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  email: string;
  role: "ESTIMATOR" | "SALES_MANAGER" | "SUPER_ADMIN" | "SYSTEM_ADMIN" | "HEAD_OF_DIVISION";
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
}

// Create User
export const createUser = async (
  payload: CreateUserPayload
) => {
  const { data } =
    await apiClient.post<ApiResponse>(
      "/users/createuser",
      payload
    );

  return data;
};


// Get All Users
export const getAllUsers =
  async (): Promise<User[]> => {
    const { data } =
      await apiClient.get<
        ApiResponse<{
          users: User[];
        }>
      >("/users/getalluser");

    return (
      data.data?.users || []
    );
  };

// Edit User
export const editUser = async (
  userId: string,
  payload: Partial<CreateUserPayload>
) => {
  const { data } = await apiClient.put<ApiResponse>(
    `/users/edituser/${userId}`,
    payload
  );
  return data;
};

// Disable/Enable User
export const disableUser = async (userId: string) => {
  const { data } = await apiClient.put<ApiResponse>(
    `/users/disableuser/${userId}`
  );
  return data;
};

// Reset Password
export const resetUserPassword = async (userId: string) => {
  const { data } = await apiClient.post<ApiResponse>(
    `/users/resetpassword/${userId}`
  );
  return data;
};