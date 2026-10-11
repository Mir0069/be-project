import { hostname } from 'os';
import type { NextFunction, Request, Response } from 'express';

type LogContext = Record<string, string | number | null | undefined>;

// One marked block per payload, headed by project and replica, so a re-trigger's
// result can be found in Log Analytics even when another replica served it.
const printBlock = (tag: string, context: LogContext, body: unknown): void => {
  const header = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const json = JSON.stringify(body ?? null, null, 2);
  console.log(`\n===== [${tag}] ${header} =====`);
  console.log(json);
  console.log(`===== [${tag} END] ${header} =====\n`);
};

/**
 * Logs the raw AI payload before validation, so a payload the backend rejects
 * (400) is visible too. Logging must never block the request.
 */
export const logIncomingAiPayload = (route: string) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      printBlock(
        'AI PAYLOAD IN',
        {
          route,
          project: req.params['projectId'] as string | undefined,
          stage: (req.params['stage'] as string | undefined) ?? (body['stage'] as number | undefined),
          status: body['status'] as string | undefined,
          trigger: body['trigger'] as string | undefined,
          idempotencyKey: body['idempotencyKey'] as string | undefined,
          replica: hostname(),
        },
        body,
      );
    } catch (err) {
      console.error('[AI PAYLOAD IN] could not log payload:', err instanceof Error ? err.message : err);
    }
    next();
  };

/** Logs the proposal schema exactly as saved after an AI result was merged. */
export const logSavedSchemaAfterAi = async (
  loadSchema: () => Promise<unknown>,
  context: { route: string; project: string; stage: string | number },
): Promise<void> => {
  try {
    printBlock('AI RESULT SAVED', { ...context, replica: hostname() }, await loadSchema());
  } catch (err) {
    console.error('[AI RESULT SAVED] could not log saved schema:', err instanceof Error ? err.message : err);
  }
};
