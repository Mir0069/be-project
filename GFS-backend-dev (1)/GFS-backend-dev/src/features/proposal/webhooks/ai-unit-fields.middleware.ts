import type { NextFunction, Request, Response } from 'express';
import { dropInvalidUnitFields } from '../multi-unit.contract';

/**
 * Runs before validation on AI result routes: an invalid unit value is dropped
 * and logged instead of turning the whole stage result into a 400.
 */
export const dropInvalidAiUnitFields = (req: Request, _res: Response, next: NextFunction): void => {
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const dropped = dropInvalidUnitFields(body as Record<string, unknown>);
    if (dropped.length > 0) {
      console.warn(
        `[AiStageResult] Ignored invalid AI unit value(s) for project ${String(req.params['projectId'] ?? '')}: ${dropped.join(', ')}`,
      );
    }
  }
  next();
};
