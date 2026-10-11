import type { Response } from 'express';
import { env } from '@config/index';

const DISALLOWED_INTERNAL_KEY_PATTERNS = [/^__/, /^\$__/, /^_doc$/];

const isPlainObjectLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

export const assertPlainApiPayload = (value: unknown, path = 'response'): void => {
  if (!isPlainObjectLike(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  for (const key of keys) {
    if (DISALLOWED_INTERNAL_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new Error(
        `Unsafe API payload at ${path}.${key}: Mongoose internals must not cross the repository boundary`,
      );
    }
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertPlainApiPayload(item, `${path}[${index}]`);
    });
    return;
  }

  for (const [key, nested] of Object.entries(record)) {
    assertPlainApiPayload(nested, `${path}.${key}`);
  }
};

export const safeJson = <T>(res: Response, statusCode: number, payload: T): void => {
  if (env.app.nodeEnv !== 'production') {
    assertPlainApiPayload(payload);
  }

  res.status(statusCode).json(payload);
};
