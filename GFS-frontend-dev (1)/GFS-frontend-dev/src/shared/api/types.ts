export type ApiResponse<T = any> = {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};
