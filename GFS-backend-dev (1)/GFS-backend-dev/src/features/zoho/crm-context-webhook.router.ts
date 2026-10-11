import { Router } from 'express';
import { asyncHandler } from '@shared/utils/async-handler';
import { CrmContextWebhookController } from './crm-context-webhook.controller';

const crmContextWebhookController = new CrmContextWebhookController();

const router = Router();

// Webhook endpoint for AI service to update project description from Zoho CRM context
// No authentication required - the AI service is authenticated via Service Bus queue
router.put(
  '/crm-context/:projectId',
  asyncHandler((req, res) => crmContextWebhookController.handleCrmContextUpdate(req, res))
);

export default router;
