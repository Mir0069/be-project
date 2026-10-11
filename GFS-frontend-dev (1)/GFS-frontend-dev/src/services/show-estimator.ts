import { apiClient } from "@/shared/api/client";

export interface Estimator {
  id: string;
  name: string;
  email: string;
  status?: string;
  firstName?: string;
  lastName?: string;
}

export const getEstimators = async (): Promise<Estimator[]> => {
  const { data } = await apiClient.get<
    { success: boolean; data: any[] }
  >("/users/estimators");

  // Map the backend IPublicUser to the frontend Estimator interface
  return (data.data || []).map((u: any) => ({
    id: u.id,
    name: u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Unknown Estimator',
    email: u.email,
    status: u.isActive ? 'Active' : 'Inactive'
  }));
};