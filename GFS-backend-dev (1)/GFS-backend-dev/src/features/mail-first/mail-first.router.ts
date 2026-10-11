import { Router } from 'express';

import { authenticate, authorize } from '@features/auth/auth.middleware';
import { asyncHandler } from '@shared/utils/async-handler';
import { validateRequest } from '@shared/middleware/validate.middleware';
import { UserRole } from '@db/models/user.model';
import { zohoService, zohoSyncService } from '@features/zoho/zoho.router';

import { MailFirstService } from './mail-first.service';
import { MailFirstController } from './mail-first.controller';
import {
  draftIdSchema,
  updateDraftSchema,
  previewAttachmentSchema,
  linkDraftSchema,
} from './mail-first.validation';
import { blobStorage } from '@features/document-ingestion/document-ingestion.router';

const mailFirstService = new MailFirstService(zohoService, zohoSyncService, blobStorage);
const mailFirstController = new MailFirstController(mailFirstService);

const router = Router();

router.get(
  '/drafts',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.ESTIMATOR),
  asyncHandler((req, res) => mailFirstController.listDrafts(req, res))
);

router.patch(
  '/drafts/:emailId',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN),
  validateRequest(updateDraftSchema),
  asyncHandler((req, res) => mailFirstController.updateDraft(req, res)),
);

// Streams an attachment's bytes back to the browser. Same reader roles as the
// drafts list, since it exposes nothing the list does not already show.
router.post(
  '/drafts/:emailId/attachments/preview',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.ESTIMATOR),
  validateRequest(previewAttachmentSchema),
  asyncHandler((req, res) => mailFirstController.previewAttachment(req, res)),
);

router.post(
  '/drafts/:emailId/approve',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN),
  validateRequest(draftIdSchema),
  asyncHandler((req, res) => mailFirstController.approve(req, res)),
);

router.post(
  '/drafts/:emailId/link',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.ESTIMATOR),
  validateRequest(linkDraftSchema),
  asyncHandler((req, res) => mailFirstController.link(req, res)),
);

router.post(
  '/drafts/:emailId/reject',
  authenticate,
  authorize(UserRole.SALES_MANAGER, UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN),
  validateRequest(draftIdSchema),
  asyncHandler((req, res) => mailFirstController.reject(req, res)),
);

export default router;
