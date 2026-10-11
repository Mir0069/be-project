import { createHash, randomBytes } from 'crypto';

export const generateRawToken = (): string => randomBytes(32).toString('hex');

export const hashToken = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');
