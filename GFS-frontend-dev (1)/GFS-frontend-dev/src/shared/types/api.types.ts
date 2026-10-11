// shared/types/api.types.ts

export interface ApiError {
  message: string
  code?: string
  statusCode?: number
}

export interface ApiResponse<T> {
  data: T
  message?: string
}
