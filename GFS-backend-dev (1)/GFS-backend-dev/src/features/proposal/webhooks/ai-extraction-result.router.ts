import { Router } from 'express';
import { AiExtractionResultController } from './ai-extraction-result.controller';
import { pendingApprovalService } from '../pending-approval.router';

export function createAiExtractionResultRouter(controller: AiExtractionResultController): Router {
  const router = Router();

  // Webhook endpoint for AI extraction results
  // This receives the extraction results from GFS-AI and updates pending approvals
  router.post('/ai-extraction-result/:correlationId', controller.handleExtractionResult);

  return router;
}

export const aiExtractionResultController = new AiExtractionResultController(pendingApprovalService);
export const aiExtractionResultRouter = createAiExtractionResultRouter(aiExtractionResultController);
export default aiExtractionResultRouter;

