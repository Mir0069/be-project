type ApiErrorLike = {
  status?: number;
  message?: unknown;
  data?: {
    error?: {
      code?: unknown;
      message?: unknown;
    };
    message?: unknown;
  };
};

const asApiError = (error: unknown): ApiErrorLike =>
  error && typeof error === "object" ? (error as ApiErrorLike) : {};

export const getUserManagementErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  const apiError = asApiError(error);
  const errorCode = apiError.data?.error?.code;

  if (apiError.status === 409 || errorCode === "CONFLICT") {
    return "A user with this email already exists. Please use a different email address.";
  }

  const message = apiError.message ?? apiError.data?.error?.message ?? apiError.data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
};
