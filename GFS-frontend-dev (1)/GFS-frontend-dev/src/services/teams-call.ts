import { apiClient } from "@/shared/api/client";
import type { ApiResponse, UserRole } from "@/shared/types/auth.types";

export interface CallDirectoryUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
}

// Returns active Sales Managers and Heads of Division (HOD inherits the SM role).
export const getCallDirectory = async (): Promise<CallDirectoryUser[]> => {
  const { data } = await apiClient.get<ApiResponse<CallDirectoryUser[]>>("/users/sales-managers");
  return data.data ?? [];
};

// Returns active Estimators, plus Heads of Division, which inherit the estimator role.
export const getEstimatorDirectory = async (): Promise<CallDirectoryUser[]> => {
  const { data } = await apiClient.get<ApiResponse<CallDirectoryUser[]>>("/users/estimators");
  return data.data ?? [];
};
