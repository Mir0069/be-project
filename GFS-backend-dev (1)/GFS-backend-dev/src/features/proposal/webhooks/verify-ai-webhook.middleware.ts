import crypto from 'crypto';
import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { StatusCodes } from 'http-status-codes';
import type { Request, Response, NextFunction } from 'express';

export function verifyAiStageWebhook(req: Request, _res: Response, next: NextFunction): void {
  const signature = req.header('X-GFS-Webhook-Signature');
  const timestampHeader = req.header('X-GFS-Webhook-Timestamp');

  if (!signature || !timestampHeader) {
    throw new AppError('Missing webhook signature headers', StatusCodes.UNAUTHORIZED);
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > env.aiWebhook.maxSkewMs) {
    // rejects both stale AND future-dated timestamps — blocks replay attacks
    throw new AppError('Webhook timestamp outside allowed skew', StatusCodes.UNAUTHORIZED);
  }

  const expected = crypto
    .createHmac('sha256', env.aiWebhook.secret)
    .update(`${timestampHeader}.${JSON.stringify(req.body)}`)
    .digest('hex');

  const provided = Buffer.from(signature, 'hex');
  const computed = Buffer.from(expected, 'hex');
  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    throw new AppError('Invalid webhook signature', StatusCodes.UNAUTHORIZED);
  }

  next();
}
