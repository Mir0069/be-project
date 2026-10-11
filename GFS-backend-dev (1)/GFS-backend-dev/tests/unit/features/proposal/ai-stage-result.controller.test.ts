import { AiStageResultController, unwrapPipelineResponse } from '../../../../src/features/proposal/webhooks/ai-stage-result.controller';

// The exact shape GFS-AI's FastAPI returns for Stage 6 (POST /stage/6 and
// /process-payload), trimmed to the per-unit cells under test.
const rawStage6Response = () => ({
  project_id: '18885',
  status: 'COMPLETE',
  output: {
    stage_6: {
      status: 'READY_FOR_EXCEL',
      cells: { E115: 96, F115: 120, E116: 24, F116: 48, E71: 44, H71: 16 },
    },
    stage_6_proposal: {
      status: 'READY_FOR_EXCEL',
      cells: {
        J23: '(1 Qty.) 96" x 120" modified interior floor glass flooring system, 10 panels',
        J24: '(1 Qty.) 24" x 48" modified interior floor glass flooring system, 3 panels',
      },
    },
  },
});

describe('unwrapPipelineResponse', () => {
  it('turns a raw Stage 6 FastAPI response into the fields_to_show webhook shape', () => {
    expect(unwrapPipelineResponse(rawStage6Response())).toEqual({
      stage: 6,
      status: 'SUCCESS',
      fields_to_show: rawStage6Response().output,
    });
  });

  it('prefers the trigger over stage keys (Stage 5 also echoes stage_4)', () => {
    const unwrapped = unwrapPipelineResponse({
      status: 'COMPLETE',
      trigger: 'STAGE_4_APPROVED_START_5',
      output: { stage_5: {}, stage_4: {}, units: {} },
    });
    expect(unwrapped['stage']).toBe(5);
  });

  it('leaves the rules-worker shape untouched', () => {
    const body = { stage: 6, status: 'SUCCESS', fields_to_show: { stage_6: { cells: {} } } };
    expect(unwrapPipelineResponse(body)).toBe(body);
  });
});

describe('AiStageResultController — raw Stage 6 response', () => {
  it('ingests proposal cells and pushes stage_6 as Stage 6, never as a re-extraction', async () => {
    const service = {
      ingestProposalCells: jest.fn().mockResolvedValue({}),
      pushDeepSchemaFromAI: jest.fn().mockResolvedValue({ stage: 6 }),
      updateAnalysisStatus: jest.fn(),
    };
    const controller = new AiStageResultController(service as any);
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await controller.handleResult({ params: { projectId: 'p1' }, body: rawStage6Response(), headers: {} } as any, res);

    expect(service.ingestProposalCells).toHaveBeenCalledWith('p1', rawStage6Response().output.stage_6_proposal, 'AI_WEBHOOK');
    expect(service.pushDeepSchemaFromAI).toHaveBeenCalledWith(
      'p1',
      6,
      { stage_6: rawStage6Response().output.stage_6 },
      'AI_WEBHOOK',
    );
    expect(service.updateAnalysisStatus).not.toHaveBeenCalled();
  });
});
