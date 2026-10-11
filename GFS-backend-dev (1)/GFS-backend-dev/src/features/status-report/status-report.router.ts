import { Router } from 'express';
import { authenticate } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { safeJson } from '@shared/http/safe-json';
import { StatusCodes } from 'http-status-codes';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { StatusReportService } from './status-report.service';
import type { StatusReportPeriod } from './status-report.types';

const service = new StatusReportService(new MongooseProjectRepository());
const router = Router();

router.get('/status-report', authenticate, asyncHandler(async (req, res) => {
  const period = String(req.query['period'] ?? 'ytd') as StatusReportPeriod;
  const year = Number(req.query['year'] ?? new Date().getUTCFullYear());
  const compareYear = req.query['compareYear'] === undefined ? undefined : Number(req.query['compareYear']);
  if (!['weekly', 'monthly', 'ytd'].includes(period) || !Number.isInteger(year)) {
    res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Invalid status report query' });
    return;
  }
  // Estimators must receive a report for their own assignments only. The
  // identity comes from the access token, never from a client-supplied id.
  const assignedEstimatorId = req.user?.role === 'ESTIMATOR' ? req.user.userId : undefined;
  const data = await service.build({ period, year, compareYear, assignedEstimatorId });
  safeJson(res, StatusCodes.OK, { success: true, data });
}));

export default router;
