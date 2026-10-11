import type { ErrorCode } from './error-codes';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: ErrorCode;
  public readonly details?: unknown;

  public constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    options?: {
      code?: ErrorCode;
      details?: unknown;
    },
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = options?.code;
    this.details = options?.details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }
}
