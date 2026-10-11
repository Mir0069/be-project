import { Router } from 'express';
import { z } from 'zod';
import { validateRequest as validate } from '@shared/middleware/validate.middleware';
import { authenticate, authorize } from '@features/auth/auth.middleware';
import { UserRole } from '@db/models/user.model';
import { requireProjectAccess } from '@shared/middleware/project-access.middleware';
import { ProposalController } from './proposal.controller';
import { ProposalService } from './proposal.service';
import { MongooseProposalRepository } from '@repositories/mongoose/proposal.repository';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { FormulaEngineService } from './formula-engine/formula-engine.service';
import { blobStorage } from '@features/document-ingestion/document-ingestion.router';
import { ZohoService } from '@features/zoho/zoho.service';
import { ZohoLeadStatusService } from '@features/zoho/zoho-lead-status.service';
import { zohoTokenRepository } from '@repositories/index';
import {
  projectIdParamSchema,
  stageParamSchema,
  runStageSchema,
  patchFieldSchema,
  saveStageFieldsSchema,
  unapproveStageSchema,
  getVersionSchema,
  aiStageResultWebhookSchema,
  patchStage7CostSchema,
  patchStage7QuantitySchema,
  patchStage7ChargeSelectionSchema,
  patchStage7OptionalAddOnStatusSchema,
  patchProposalCellsSchema,
  proposalDocumentParamsSchema,
  assignStage7ApproverSchema,
} from './proposal.validation';

import { AiStageResultController } from './webhooks/ai-stage-result.controller';
import { logIncomingAiPayload } from './webhooks/ai-payload-log';
import { dropInvalidAiUnitFields } from './webhooks/ai-unit-fields.middleware';
import { auditLogService } from '@features/audit-logs/audit-logs.service';



const proposalRepo = new MongooseProposalRepository();
const projectRepo = new MongooseProjectRepository();
const formulaEngine = new FormulaEngineService();

// Built from the leaf modules on purpose: importing zohoLeadStatusService from
// zoho.router would close the existing app -> zoho.router -> pending-approval.router
// -> proposal.router require cycle and resolve to undefined at module-eval time.
const zohoLeadStatusService = new ZohoLeadStatusService(
  new ZohoService(zohoTokenRepository),
  projectRepo,
);

export const proposalService = new ProposalService(
  proposalRepo,
  projectRepo,
  formulaEngine,
  blobStorage,
  zohoLeadStatusService,
  auditLogService,
);
const proposalController = new ProposalController(proposalService);
const aiStageResultController = new AiStageResultController(proposalService);

const proposalRouter = Router();

// =============================================================================
// SCHEMA FIELD CONFIG ROUTES (No Auth Required for these generic configs)
// =============================================================================
proposalRouter.get(
  '/schema/fields',
  proposalController.getSchemaFields
);

proposalRouter.get(
  '/schema/fields/:stage',
  validate(z.object({ params: stageParamSchema })),
  proposalController.getSchemaFields
);

proposalRouter.get(
  '/schema/fields/:fieldPath/options',
  proposalController.getFieldOptions
);

// =============================================================================
// AI SPECIFIC ROUTES (No Auth Required for System AI)
// =============================================================================

proposalRouter.post(
  '/webhooks/:projectId/ai-stage-result',
  logIncomingAiPayload('ai-stage-result'),
  dropInvalidAiUnitFields,
  validate(aiStageResultWebhookSchema),
  aiStageResultController.handleResult
);

proposalRouter.post(
  '/:projectId/stages/:stage/run',
  logIncomingAiPayload('stage-run'),
  validate(runStageSchema),
  proposalController.runStage
);

// =============================================================================
// PROJECT SPECIFIC ROUTES (Auth Required)
// =============================================================================
proposalRouter.use(authenticate);

// Fires for every route below that carries a :projectId, so an estimator can
// only read or write proposals on projects assigned to them. The AI routes
// above are unauthenticated by design and pass straight through.
proposalRouter.param('projectId', requireProjectAccess);

proposalRouter.post(
  '/backfill-prices',
  proposalController.backfillPrices
);

proposalRouter.get(
  '/:projectId/final-parameters-schema',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getFinalParametersSchema
);


proposalRouter.get(
  '/:projectId/stages',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getAllStages
);

proposalRouter.get(
  '/:projectId/timeline',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getTimeline
);

proposalRouter.get(
  '/:projectId/stream',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.streamProject
);

proposalRouter.get(
  '/:projectId/stages/:stage',
  validate(z.object({ params: projectIdParamSchema.merge(stageParamSchema) })),
  proposalController.getStage
);

proposalRouter.post(
  '/:projectId/stages/:stage/approve',
  validate(z.object({ params: projectIdParamSchema.merge(stageParamSchema) })),
  proposalController.approveStage
);

proposalRouter.post(
  '/:projectId/stages/:stage/unapprove',
  validate(unapproveStageSchema),
  proposalController.unapproveStage
);

// Unified editing route (single field patch)
proposalRouter.patch(
  '/:projectId/field',
  validate(patchFieldSchema),
  proposalController.patchField
);

// Multi-field stage-save wrapper route
proposalRouter.put(
  '/:projectId/stages/:stage',
  validate(saveStageFieldsSchema),
  proposalController.saveStageFields
);

// Stage 7 Specific routes
proposalRouter.patch(
  '/:projectId/stages/7/cost',
  validate(patchStage7CostSchema),
  proposalController.patchStage7Cost
);

proposalRouter.patch(
  '/:projectId/stages/7/quantity',
  validate(patchStage7QuantitySchema),
  proposalController.patchStage7Quantity
);

proposalRouter.patch(
  '/:projectId/stages/7/charge-selection',
  validate(patchStage7ChargeSelectionSchema),
  proposalController.patchStage7ChargeSelection
);

proposalRouter.patch(
  '/:projectId/stages/7/optional-add-on-status',
  validate(patchStage7OptionalAddOnStatusSchema),
  proposalController.patchStage7OptionalAddOnStatus,
);

proposalRouter.get(
  '/:projectId/stages/7/eligible-approvers',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getStage7EligibleApprovers
);

proposalRouter.post(
  '/:projectId/stages/7/approver',
  validate(assignStage7ApproverSchema),
  proposalController.assignStage7Approver
);

proposalRouter.get(
  '/:projectId/stages/7/stream',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.streamStage7
);

proposalRouter.get(
  '/:projectId/history',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getHistory
);

proposalRouter.get(
  '/:projectId/version/latest',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getLatestVersion
);

proposalRouter.get(
  '/:projectId/version/:version',
  validate(getVersionSchema),
  proposalController.getVersion
);

proposalRouter.get(
  '/:projectId/excel',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.generateExcel
);

proposalRouter.get(
  '/:projectId/feedback/export',
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.HEAD_OF_DIVISION),
  proposalController.exportFeedbackCsv
);

proposalRouter.get(
  '/:projectId/proposal',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.getProposal
);

proposalRouter.post(
  '/:projectId/proposal/approve',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.approveProposalLead
);

proposalRouter.patch(
  '/:projectId/proposal/cells',
  validate(patchProposalCellsSchema),
  proposalController.updateProposalCells
);

proposalRouter.get(
  '/:projectId/proposal/download',
  validate(z.object({ params: projectIdParamSchema })),
  proposalController.downloadProposal
);

proposalRouter.get(
  '/:projectId/proposal/documents/:documentId/file',
  validate(proposalDocumentParamsSchema),
  proposalController.downloadProposalDocument
);

proposalRouter.get(
  '/:projectId/proposal/documents/:documentId/pdf',
  validate(proposalDocumentParamsSchema),
  proposalController.downloadProposalDocumentPdf
);

export { proposalRouter };
