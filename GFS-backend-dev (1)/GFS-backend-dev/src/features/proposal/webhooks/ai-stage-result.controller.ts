import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ProposalService } from '../proposal.service';
import { ProjectAnalysisStatus } from '@db/models/project.model';
import { normalizeAiMultiUnitPayload, type NormalizedAiStageResult } from '../multi-unit.contract';
import { logSavedSchemaAfterAi } from './ai-payload-log';

const TRIGGER_TARGET_STAGE = /^STAGE_\d+_APPROVED_START_(\d+)$/;

/**
 * GFS-AI's FastAPI returns `{ project_id, status: "COMPLETE", output: {...} }`
 * (PipelineResponse / POST /stage/N). The rules worker normally re-wraps that
 * as `{ stage, status, fields_to_show: output }`, but when the raw response is
 * forwarded as-is there is no `stage` and no `stage_N` key at the root, so the
 * stage inference below falls through to 0 — a full re-extraction that merges
 * `output` into the schema root and never ingests stage_6_proposal. Normalize
 * it to the fields_to_show shape first.
 */
export const unwrapPipelineResponse = (body: Record<string, any>): Record<string, any> => {
  const output = body?.['output'];
  if (!output || typeof output !== 'object' || Array.isArray(output) || body['fields_to_show'] !== undefined) {
    return body;
  }

  const { output: _output, project_id: _projectId, ...rest } = body;
  let stage: number | undefined = body['stage'] !== undefined ? Number(body['stage']) : undefined;
  const triggerMatch = typeof body['trigger'] === 'string' ? TRIGGER_TARGET_STAGE.exec(body['trigger']) : null;
  if (stage === undefined && triggerMatch) stage = Number(triggerMatch[1]);
  if (stage === undefined) {
    // A stage-N result carries stage_N plus earlier blocks it echoes (Stage 5
    // also returns stage_4), so the highest stage key is the one that ran.
    const stageKeys = Object.keys(output)
      .map((key) => (key === 'stage_6_proposal' ? 6 : Number(/^stage_(\d+)$/.exec(key)?.[1] ?? NaN)))
      .filter(Number.isFinite);
    if (stageKeys.length > 0) stage = Math.max(...stageKeys);
  }
  if (stage === undefined) return body;

  return {
    ...rest,
    stage,
    status: body['status'] === 'COMPLETE' ? 'SUCCESS' : body['status'],
    fields_to_show: output,
  };
};

export class AiStageResultController {
  constructor(private readonly proposalService: ProposalService) {}

  handleResult = async (req: Request, res: Response) => {

    const projectId = String(req.params['projectId'] ?? '');
    const rawPayload = unwrapPipelineResponse({ ...req.body });
    let payload: NormalizedAiStageResult;

    try {
      payload = normalizeAiMultiUnitPayload(rawPayload);
    } catch (error) {
      throw new AppError(
        'Invalid multi-unit AI stage result',
        StatusCodes.BAD_REQUEST,
        true,
        { details: error },
      );
    }


    console.log(`\n======================================================`);
    console.log(`📥 [AiStageResultWebhook] Incoming Webhook Triggered!`);
    console.log(`======================================================`);
    console.log(`URL Params (projectId):`, projectId);
    console.log(`Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`Raw Body Payload:`, JSON.stringify(rawPayload, null, 2));
    console.log(`======================================================\n`);

    if (payload.status === 'FAILED' || payload.status === 'NO_DOCUMENTS') {
      console.error(`AI Pipeline Error for Project ${projectId}: ${payload.status}`, payload);
      if (payload.stage === undefined || payload.stage === 0) {
        await this.proposalService.updateAnalysisStatus(projectId, ProjectAnalysisStatus.FAILED);
      }
      res.status(StatusCodes.OK).json({ success: true, message: 'Error logged' });
      return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // STAGE_6_PROPOSAL: handled first, but WITHOUT an early return.
    // AI sends stage_6 and stage_6_proposal together nested inside
    // fields_to_show for Stage 6 (MD §3/§5.3):
    //   { stage: 6, status: "SUCCESS",
    //     fields_to_show: { stage_6: {...}, stage_6_proposal: {...} } }
    // Older payloads may also carry stage_6_proposal top-level. Handle both:
    // ingest the proposal block into its own isolated path, strip it, then
    // let anything else (like stage_6) continue through the normal flow below.
    // ─────────────────────────────────────────────────────────────────────
    const nestedProposal = (payload as any)?.fields_to_show?.stage_6_proposal;
    if (nestedProposal) {
      await this.proposalService.ingestProposalCells(
        projectId as string,
        nestedProposal,
        'AI_WEBHOOK'
      );
      delete (payload as any).fields_to_show.stage_6_proposal;
    }
    if (payload.stage_6_proposal) {
      await this.proposalService.ingestProposalCells(
        projectId as string,
        payload.stage_6_proposal,
        'AI_WEBHOOK'
      );
      delete payload.stage_6_proposal;
    }

    // If that was the entire payload, nothing else to process.
    if (Object.keys(payload).length === 0) {
      res.status(StatusCodes.OK).json({ status: 'ACCEPTED', proposal: true });
      return;
    }

    let stage = 0;
    let deepPayload = payload;

    const hasFieldsToShow = payload.fields_to_show !== null
      && typeof payload.fields_to_show === 'object'
      && !Array.isArray(payload.fields_to_show);

    if (payload.stage !== undefined && hasFieldsToShow) {
      // Handle the case where AI sends { stage: 2, fields_to_show: { ... } }
      stage = Number(payload.stage);
      const fieldsToShow = payload.fields_to_show as Record<string, unknown>;
      const hasStageKeys = Object.keys(fieldsToShow).some(k => /^stage_\d+$/.test(k));
      if (hasStageKeys) {
        deepPayload = fieldsToShow;
      } else {
        deepPayload = {
          [`stage_${stage}`]: fieldsToShow,
        };
      }
      // Units are persisted at the schema root even though the Stage 4 API
      // response exposes them inside fields_to_show.
      if (payload.units) deepPayload['units'] = payload.units;
    } else if (payload.stage !== undefined && payload.units) {
      stage = Number(payload.stage);
      deepPayload = { ...payload };
      delete deepPayload.stage;
      delete deepPayload.status;
      delete deepPayload['aiRunId'];
      delete deepPayload['idempotencyKey'];
      delete deepPayload['correlationId'];
    } else {
      // Infer stage from the payload keys (e.g. {"stage_1": {...}} -> stage 1)
      // FIX: exact match "stage_<digits>" only. The previous
      // parseInt(key.replace('stage_', '')) approach silently truncated
      // keys like "stage_6_proposal" into stage 6, which would wipe
      // stage_6.cells and reset pipeline_status.stage_6_status if this
      // key ever reached this loop unstripped.
      const keys = Object.keys(payload);
      for (const key of keys) {
        const match = key.match(/^stage_(\d+)$/);
        if (match) {
          stage = parseInt(match[1] as string, 10);
          break;
        }
      }
      // Stage 0 posts { stage: 0, status: "EXTRACTION_DONE", fields: {...} }
      // (MD §2) — unwrap the full unified doc the same way runStage does.
      if (stage === 0 && (payload as any).fields && typeof (payload as any).fields === 'object') {
        deepPayload = (payload as any).fields;
      }
    }

    // Since idempotencyKey and aiRunId are not sent in the raw schema payload,
    // we bypass the history deduplication logic here or assign a default.
    const aiRunId = 'AI_WEBHOOK';

    // Process the result using pushDeepSchemaFromAI
    const result = await this.proposalService.pushDeepSchemaFromAI(
      projectId as string,
      stage as any,
      deepPayload,
      aiRunId
    );

    if (stage === 0) {
      await this.proposalService.updateAnalysisStatus(projectId, ProjectAnalysisStatus.COMPLETED);
    }

    await logSavedSchemaAfterAi(() => this.proposalService.getSavedSchema(projectId), {
      route: 'ai-stage-result',
      project: projectId,
      stage,
    });
    res.status(StatusCodes.OK).json({
      status: 'ACCEPTED',
      version: result.stage,
    });
  };
}
