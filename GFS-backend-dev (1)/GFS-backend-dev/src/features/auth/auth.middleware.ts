import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { hasAnyRole } from '@shared/security/role-access';
import type { UserRole } from '@db/models/user.model';
import type { IAuthTokenPayload } from './auth.types';

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers?.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const queryToken = typeof req.query?.['token'] === 'string' ? req.query['token'] : undefined;
  const token = (req.cookies?.['accessToken'] as string | undefined) || bearerToken || queryToken;

  if (!token) {
    return next(new AppError('Authentication required', StatusCodes.UNAUTHORIZED));
  }

  try {
    const payload = jwt.verify(token, env.auth.jwtSecret) as IAuthTokenPayload;
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    next(new AppError('Invalid or expired token', StatusCodes.UNAUTHORIZED));
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !hasAnyRole(req.user.role, roles)) {
      return next(new AppError('You do not have permission', StatusCodes.FORBIDDEN));
    }
    next();
  };
};
