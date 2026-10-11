import { publicClient } from "@/shared/api/client";

import type { ApiResponse } from "@/shared/types/auth.types";

export interface SetPasswordPayload {
  token: string;
  password: string;
}

export const setPassword = async (
  payload: SetPasswordPayload
) => {

  const { data } =
    await publicClient.post<ApiResponse>(
      "/auth/set-password",
      payload
    );

  return data;
};

