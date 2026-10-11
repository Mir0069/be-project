import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ProposalService } from './proposal.service';
import { SCHEMA_FIELDS, getFieldDefinition } from './schema-registry';
import { WorkflowStage } from '@db/models/proposal.model';
import { ProjectAnalysisStatus } from '@db/models/project.model';
import { usersService } from '@features/users/users.router';
import { isEligibleApprover } from './stage7-approval.rules';
import { logSavedSchemaAfterAi } from './webhooks/ai-payload-log';

import {
  proposalEventBus,
  ProposalEvent,
  Stage7CostUpdatedPayload,
  Stage7ChargeSelectionUpdatedPayload,
  Stage7OptionalAddOnStatusUpdatedPayload,
  StagePushedPayload,
  StageUpdatedPayload,
  StageApprovedPayload,
} from './proposal.events';

export class ProposalController {
  constructor(private readonly service: ProposalService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE EXECUTION & REVIEW
  // ───────────────────────────────────────────────────────────────────────────

  runStage = async (req: Request, res: Response) => {
    const { projectId, stage } = req.params;
    const isDeepPayload = !req.body.fields || !Array.isArray(req.body.fields);
    // The incoming payload is logged by logIncomingAiPayload on the route, before validation.

    try {
      let result;
      if (isDeepPayload) {
        let deepPayload = req.body;
        if (req.body.fields && typeof req.body.fields === 'object' && !Array.isArray(req.body.fields)) {
          deepPayload = req.body.fields;
        } else if (req.body.fields_to_show) {
          deepPayload = req.body.fields_to_show;
        } else if (req.body.output) {
          deepPayload = req.body.output;
        }
        result = await this.service.pushDeepSchemaFromAI(
          projectId as string,
          Number(stage) as any,
          deepPayload,
          'AI'
        );
      } else {
        result = await this.service.pushStageFromAI(
          projectId as string,
          Number(stage) as any,
          req.body.fields,
          'AI'
        );
      }

      await logSavedSchemaAfterAi(() => this.service.getSavedSchema(projectId as string), {
        route: 'stage-run',
        project: projectId as string,
        stage: stage as string,
      });
      res.status(StatusCodes.CREATED).json(result);
    } catch (error) {
      if (Number(stage) === 0) {
        await this.service.updateAnalysisStatus(projectId as string, ProjectAnalysisStatus.FAILED).catch(() => undefined);
      }
      throw error;
    }
  };

  getStage = async (req: Request, res: Response) => {
    const { projectId, stage } = req.params;

    const detail = await this.service.getStage(projectId as string, Number(stage) as WorkflowStage);

    res.status(StatusCodes.OK).json(detail);
  };

  getTimeline = async (req: Request, res: Response) => {
    const timeline = await this.service.getTimeline(req.params['projectId'] as string);

    res.status(StatusCodes.OK).json({
      success: true,
      data: timeline,
    });
  };

  getAllStages = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    
    // Quick mock for getAllStages (overview): we could build this directly in service
    // but the prompt focused on getStage. I'll provide a stub or just getHistory.
    const history = await this.service.getHistory(projectId as string);

    res.status(StatusCodes.OK).json({
      success: true,
      data: { stages: history }
    });
  };

  /**
   * Stream project-wide workflow changes so an open workspace can refresh its
   * active stage without requiring a browser reload. This is intentionally
   * separate from the Stage 7 cost stream because stage 0-7 transitions all
   * affect navigation, timeline, and extracted information.
   */
  streamProject = async (req: Request, res: Response) => {
    const { projectId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ event: 'CONNECTED', projectId })}\n\n`);

    const writeProjectEvent = (event: string, data: Record<string, unknown>) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
    };

    const handleStagePushed = (payload: StagePushedPayload) => {
      if (payload.projectId === projectId) {
        writeProjectEvent(ProposalEvent.STAGE_PUSHED, payload.data as unknown as Record<string, unknown>);
      }
    };

    const handleStageUpdated = (payload: StageUpdatedPayload) => {
      if (payload.projectId === projectId) {
        writeProjectEvent(ProposalEvent.STAGE_UPDATED, payload.data as unknown as Record<string, unknown>);
      }
    };

    const handleStageApproved = (payload: StageApprovedPayload) => {
      if (payload.projectId === projectId) {
        writeProjectEvent(ProposalEvent.STAGE_APPROVED, payload.data as unknown as Record<string, unknown>);
      }
    };

    const handleStageReopened = (payload: { projectId: string; data: Record<string, unknown> }) => {
      if (payload.projectId === projectId) {
        writeProjectEvent(ProposalEvent.STAGE_REOPENED, payload.data);
      }
    };

    const handleCostUpdated = (payload: Stage7CostUpdatedPayload) => {
      if (payload.projectId === projectId) {
        writeProjectEvent(ProposalEvent.STAGE_7_COST_UPDATED, payload.data as unknown as Record<string, unknown>);
      }
    };

    const handleChargeSelectionUpdated = (payload: Stage7ChargeSelectionUpdatedPayload) => {
      if (payload.projectId === projectId) {
        res.write(`data: ${JSON.stringify({ event: ProposalEvent.STAGE_7_CHARGE_SELECTION_UPDATED, ...payload.data })}\n\n`);
      }
    };

    const handleOptionalAddOnStatusUpdated = (payload: Stage7OptionalAddOnStatusUpdatedPayload) => {
      if (payload.projectId === projectId) {
        res.write(`data: ${JSON.stringify({ event: ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, ...payload.data })}\n\n`);
      }
    };

    proposalEventBus.on(ProposalEvent.STAGE_PUSHED, handleStagePushed);
    proposalEventBus.on(ProposalEvent.STAGE_UPDATED, handleStageUpdated);
    proposalEventBus.on(ProposalEvent.STAGE_APPROVED, handleStageApproved);
    proposalEventBus.on(ProposalEvent.STAGE_REOPENED, handleStageReopened);
    proposalEventBus.on(ProposalEvent.STAGE_7_COST_UPDATED, handleCostUpdated);
    proposalEventBus.on(ProposalEvent.STAGE_7_CHARGE_SELECTION_UPDATED, handleChargeSelectionUpdated);
    proposalEventBus.on(ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, handleOptionalAddOnStatusUpdated);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(':\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      proposalEventBus.off(ProposalEvent.STAGE_PUSHED, handleStagePushed);
      proposalEventBus.off(ProposalEvent.STAGE_UPDATED, handleStageUpdated);
      proposalEventBus.off(ProposalEvent.STAGE_APPROVED, handleStageApproved);
      proposalEventBus.off(ProposalEvent.STAGE_REOPENED, handleStageReopened);
      proposalEventBus.off(ProposalEvent.STAGE_7_COST_UPDATED, handleCostUpdated);
      proposalEventBus.off(ProposalEvent.STAGE_7_CHARGE_SELECTION_UPDATED, handleChargeSelectionUpdated);
      proposalEventBus.off(ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, handleOptionalAddOnStatusUpdated);
    });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // EDITS & APPROVALS
  // ───────────────────────────────────────────────────────────────────────────

  patchField = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { fieldPath, value, feedback } = req.body;
    const { userId: updatedBy, role } = req.user!;

    const result = await this.service.saveFieldEdit(
      projectId as string,
      fieldPath,
      value,
      updatedBy,
      role,
      feedback
    );

    res.status(StatusCodes.OK).json(result);
  };

  saveStageFields = async (req: Request, res: Response) => {
    const { projectId, stage } = req.params;
    const { fields } = req.body;
    const { userId: updatedBy, role } = req.user!;

    const result = await this.service.saveManyFieldEdits(
      projectId as string,
      fields,
      updatedBy,
      role,
      Number(stage) as WorkflowStage
    );

    res.status(StatusCodes.OK).json(result);
  };

  approveStage = async (req: Request, res: Response) => {
    const { projectId, stage } = req.params;
    const { userId: approvedBy, role } = req.user!;

    const result = await this.service.approveStage(
      projectId as string,
      Number(stage) as WorkflowStage,
      approvedBy,
      role
    );

    res.status(StatusCodes.OK).json(result);
  };

  unapproveStage = async (req: Request, res: Response) => {
    const { projectId, stage } = req.params;
    const { userId: unapprovedBy, role } = req.user!;
    const { reason } = req.body ?? {};

    const result = await this.service.unapproveStage(
      projectId as string,
      Number(stage) as WorkflowStage,
      unapprovedBy,
      role,
      reason
    );

    res.status(StatusCodes.OK).json(result);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 7 NAMED-APPROVER GATE
  // ───────────────────────────────────────────────────────────────────────────

  getStage7EligibleApprovers = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { userId, role } = req.user!;

    const { finalPrice } = await this.service.getStage7ApprovalContext(projectId as string, userId, role);
    const salesManagers = await usersService.listSalesManagers();
    const eligible = salesManagers
      .filter((user) => isEligibleApprover({ role: user.role, email: user.email, isActive: user.isActive }, finalPrice))
      .map((user) => ({ id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: user.email }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.status(StatusCodes.OK).json({ success: true, data: eligible });
  };

  assignStage7Approver = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { approverId } = req.body;
    const { userId: assignedBy, role } = req.user!;

    const result = await this.service.assignStage7Approver(projectId as string, approverId, assignedBy, role);
    res.status(StatusCodes.OK).json({ success: true, data: result });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // STAGE 7 COST OVERRIDES
  // ───────────────────────────────────────────────────────────────────────────

  patchStage7Cost = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { cell, cost, feedback } = req.body;
    const { userId: updatedBy, role } = req.user!;

    const result = await this.service.updateStage7Cost(
      projectId as string,
      cell,
      cost,
      updatedBy,
      role,
      feedback
    );

    res.status(StatusCodes.OK).json(result);
  };

  patchStage7Quantity = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { cell, quantity, feedback } = req.body;
    const { userId: updatedBy, role } = req.user!;

    const result = await this.service.updateStage7Quantity(
      projectId as string,
      cell,
      quantity,
      updatedBy,
      role,
      feedback
    );

    res.status(StatusCodes.OK).json(result);
  };

  patchStage7ChargeSelection = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { cell, selection, feedback } = req.body;
    const { userId: updatedBy, role } = req.user!;

    const result = await this.service.updateStage7ChargeSelection(
      projectId as string,
      cell,
      selection,
      updatedBy,
      role,
      feedback,
    );

    res.status(StatusCodes.OK).json(result);
  };

  patchStage7OptionalAddOnStatus = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { cell, status } = req.body;
    const { userId: updatedBy, role } = req.user!;

    const result = await this.service.updateStage7OptionalAddOnStatus(
      projectId as string,
      cell,
      status,
      updatedBy,
      role,
    );

    res.status(StatusCodes.OK).json(result);
  };

  streamStage7 = async (req: Request, res: Response) => {
    const { projectId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial payload (stage 7 state)
    const initialData = await this.service.getStage(projectId as string, 7);
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);

    const handleCostUpdated = (payload: Stage7CostUpdatedPayload) => {
      if (payload.projectId === projectId) {
        res.write(`data: ${JSON.stringify({ event: ProposalEvent.STAGE_7_COST_UPDATED, ...payload.data })}\n\n`);
      }
    };

    const handleStagePushed = (payload: StagePushedPayload) => {
      if (payload.projectId === projectId && payload.data.stage === 7) {
        res.write(`data: ${JSON.stringify({ event: ProposalEvent.STAGE_PUSHED, ...payload.data })}\n\n`);
      }
    };

    const handleOptionalAddOnStatusUpdated = (payload: Stage7OptionalAddOnStatusUpdatedPayload) => {
      if (payload.projectId === projectId) {
        res.write(`data: ${JSON.stringify({ event: ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, ...payload.data })}\n\n`);
      }
    };

    proposalEventBus.on(ProposalEvent.STAGE_7_COST_UPDATED, handleCostUpdated);
    proposalEventBus.on(ProposalEvent.STAGE_PUSHED, handleStagePushed);
    proposalEventBus.on(ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, handleOptionalAddOnStatusUpdated);

    const keepAlive = setInterval(() => {
      res.write(':\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      proposalEventBus.off(ProposalEvent.STAGE_7_COST_UPDATED, handleCostUpdated);
      proposalEventBus.off(ProposalEvent.STAGE_PUSHED, handleStagePushed);
      proposalEventBus.off(ProposalEvent.STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED, handleOptionalAddOnStatusUpdated);
    });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // HISTORY & VERSIONS
  // ───────────────────────────────────────────────────────────────────────────

  getHistory = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const history = await this.service.getHistory(projectId as string);
    
    res.status(StatusCodes.OK).json({
      success: true,
      data: history,
    });
  };

  getLatestVersion = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const history = await this.service.getHistory(projectId as string);
    const latest = history.length > 0 ? history[history.length - 1] : null;

    res.status(StatusCodes.OK).json({
      success: true,
      data: latest,
    });
  };

  getVersion = async (req: Request, res: Response) => {
    const { projectId, version } = req.params;
    const ver = await this.service.getVersion(projectId as string, Number(version));
    
    if (!ver) {
      throw new AppError('Version not found', StatusCodes.NOT_FOUND);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      data: ver,
    });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // SCHEMA FIELD OPTIONS
  // ───────────────────────────────────────────────────────────────────────────

  getSchemaFields = async (req: Request, res: Response) => {
    const { stage } = req.params;
    
    let fields = SCHEMA_FIELDS.filter(f => !f.internal);
    if (stage) {
      fields = fields.filter(f => f.stage === Number(stage));
    }

    const formatted = fields.map(f => ({
      fieldPath: f.path,
      label: f.label,
      type: f.allowedValues ? 'enum' : 'text',
      manual: f.manual,
      options: f.allowedValues || undefined
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        stage: stage ? Number(stage) : undefined,
        fields: formatted
      }
    });
  };

  getFieldOptions = async (req: Request, res: Response) => {
    const fieldPath = req.params['fieldPath'] as string;
    const def = getFieldDefinition(fieldPath);

    if (!def) {
      throw new AppError('Field not found in schema registry', StatusCodes.NOT_FOUND);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      data: {
        fieldPath: def.path,
        options: def.allowedValues || []
      }
    });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // EXCEL GENERATION
  // ───────────────────────────────────────────────────────────────────────────

  generateExcel = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { userId, role } = req.user!;
    const force = Boolean(req.query['force'] === 'true' || req.query['refresh'] === 'true');

    const { buffer, fileName } = await this.service.generateExcel(
      projectId as string,
      userId,
      role,
      { force }
    );

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  };

  getProposal = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { userId, role: _role } = req.user!;

    const data = await this.service.getProposal(
      projectId as string,
      userId,
      _role
    );

    res.status(StatusCodes.OK).json({ success: true, data });
  };

  approveProposalLead = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { userId, role } = req.user!;

    const data = await this.service.approveProposalLead(projectId as string, userId, role);

    res.status(StatusCodes.OK).json({ success: true, data });
  };

  updateProposalCells = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { userId, role: _role } = req.user!;
    const { cells, target_sheet } = req.body;

    const data = await this.service.updateProposalCells(
      projectId as string,
      userId,
      { cells, target_sheet }
    );

    res.status(StatusCodes.OK).json({ success: true, data });
  };

  downloadProposal = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { userId, role: _role } = req.user!;
    const force = Boolean(req.query['force'] === 'true' || req.query['refresh'] === 'true');

    const data = await this.service.getLatestProposalDownload(
      projectId as string,
      userId,
      _role,
      { force }
    );

    res.status(StatusCodes.OK).json({ success: true, data });
  };

  downloadProposalDocument = async (req: Request, res: Response) => {
    const { projectId, documentId } = req.params;
    const { userId, role } = req.user!;

    const { buffer, fileName } = await this.service.getProposalDocumentFile(
      projectId as string,
      userId,
      role,
      documentId as string
    );

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  };

  downloadProposalDocumentPdf = async (req: Request, res: Response) => {
    const { projectId, documentId } = req.params;
    const { userId, role } = req.user!;

    const { buffer, fileName } = await this.service.getProposalDocumentPdf(
      projectId as string,
      userId,
      role,
      documentId as string
    );

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  };

  getFinalParametersSchema = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const schema = await this.service.getFinalParametersSchema(projectId as string);
    res.status(StatusCodes.OK).json({ success: true, data: schema });
  };

  backfillPrices = async (_req: Request, res: Response) => {
    const result = await this.service.backfillAllProjectPrices();
    res.status(StatusCodes.OK).json({
      success: true,
      data: result,
      message: `Backfilled prices for ${result.updated} projects (${result.skipped} skipped)`,
    });
  };

  exportFeedbackCsv = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const csv = await this.service.exportFeedbackCsv(projectId as string);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="feedback-history-${projectId}.csv"`);
    res.status(StatusCodes.OK).send(csv);
  };

}

