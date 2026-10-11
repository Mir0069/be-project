import { Router } from 'express';
import multer from 'multer';
import { UserRole } from '@db/models/user.model';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { callRecordRepository, projectRepository } from '@repositories/index';

import { PhoneTranscriptService } from './phone-transcript.service';
import { PhoneTranscriptController } from './phone-transcript.controller';
import { CreateCallRecordSchema, ListCallRecordsQuerySchema, UpdateCallRecordSchema } from './phone-transcript.types';
import { documentIngestion } from '@repositories/index';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
});

const service = new PhoneTranscriptService(
  callRecordRepository, 
  projectRepository,
  documentIngestion
);
const controller = new PhoneTranscriptController(service);

const router = Router({ mergeParams: true });

router.post(
  '/',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  validateRequest(CreateCallRecordSchema),
  asyncHandler((req, res) => controller.createCallRecord(req, res)),
);

router.get(
  '/',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  validateRequest(ListCallRecordsQuerySchema),
  asyncHandler((req, res) => controller.listCallRecords(req, res)),
);

router.get(
  '/:recordId',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  asyncHandler((req, res) => controller.getCallRecord(req, res)),
);

router.patch(
  '/:recordId',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  validateRequest(UpdateCallRecordSchema),
  asyncHandler((req, res) => controller.updateCallRecord(req, res)),
);

router.delete(
  '/:recordId',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  asyncHandler((req, res) => controller.deleteCallRecord(req, res)),
);

router.post(
  '/:recordId/extract',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  asyncHandler((req, res) => controller.triggerAiExtraction(req, res)),
);

router.post(
  '/:recordId/transcribe',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN),
  upload.single('audio'),
  asyncHandler((req, res) => controller.transcribeAudio(req, res)),
);

router.post(
  '/upload-audio',
  authenticate,
  authorize(UserRole.ESTIMATOR, UserRole.SALES_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN),
  upload.single('file'),
  asyncHandler((req, res) => controller.uploadAndTranscribe(req, res)),
);
export default router;
