import { AppError } from '@shared/errors/app.error';

export const describeError = (err: unknown): string => {
  if (err instanceof AppError) {
    const details = err.details !== undefined ? ` details=${JSON.stringify(err.details)}` : '';
    return `HTTP ${err.statusCode} ${err.message}${details}`;
  }
  return err instanceof Error ? err.message : String(err);
};
