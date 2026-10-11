import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';

const getDefaultErrorCode = (statusCode: number): ErrorCode => {
  switch (statusCode) {
    case StatusCodes.UNAUTHORIZED:
      return ErrorCode.UNAUTHORIZED;
    case StatusCodes.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case StatusCodes.TOO_MANY_REQUESTS:
      return ErrorCode.TOO_MANY_REQUESTS; 
    case StatusCodes.NOT_FOUND:   
      return ErrorCode.NOT_FOUND;
    case StatusCodes.CONFLICT:
      return ErrorCode.CONFLICT;
    case StatusCodes.SERVICE_UNAVAILABLE:
      return ErrorCode.SERVICE_UNAVAILABLE;
    case StatusCodes.UNPROCESSABLE_ENTITY:
    case StatusCodes.BAD_REQUEST:
      return ErrorCode.VALIDATION_ERROR;
    default:
      return ErrorCode.INTERNAL_SERVER_ERROR;
  }
};

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code ?? getDefaultErrorCode(err.statusCode),
        message: err.message,
        statusCode: err.statusCode,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(StatusCodes.NOT_FOUND).json({
      success: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
        statusCode: StatusCodes.NOT_FOUND,
      },
    });
    return;
  }

  // Unhandled / unexpected errors
  if (env.app.nodeEnv !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[errorMiddleware] Unhandled error', {
      method: req.method,
      path: req.originalUrl,
      error: err,
    });
  }

  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      message: 'An unexpected error occurred',
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      ...(env.app.nodeEnv !== 'production' && err.stack
        ? { details: { stack: err.stack, message: err.message } }
        : {}),
    },
  });
};
