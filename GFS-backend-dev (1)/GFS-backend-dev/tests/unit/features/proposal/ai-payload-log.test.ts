import { hostname } from 'os';
import { logIncomingAiPayload, logSavedSchemaAfterAi } from '../../../../src/features/proposal/webhooks/ai-payload-log';
import { AiStageResultController } from '../../../../src/features/proposal/webhooks/ai-stage-result.controller';
import { ProposalController } from '../../../../src/features/proposal/proposal.controller';

const printed = (spy: jest.SpyInstance): string => spy.mock.calls.map((call) => call.join(' ')).join('\n');

describe('AI payload logging', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('logIncomingAiPayload', () => {
    it('logs the whole payload under a header naming project, stage and replica, then continues', () => {
      const next = jest.fn();
      const body = { stage: 0, status: 'EXTRACTION_DONE', fields: { units: { A: { value_frame_type: 'SERIES 2000' } } } };

      logIncomingAiPayload('stage-run')({ params: { projectId: 'p1', stage: '0' }, body } as any, {} as any, next);

      const out = printed(log);
      expect(out).toContain(`[AI PAYLOAD IN] route=stage-run project=p1 stage=0 status=EXTRACTION_DONE replica=${hostname()}`);
      expect(out).toContain('"value_frame_type": "SERIES 2000"');
      expect(out).toContain('[AI PAYLOAD IN END]');
      expect(next).toHaveBeenCalledWith();
    });

    it('takes the stage from the body when the route has none', () => {
      logIncomingAiPayload('ai-stage-result')(
        { params: { projectId: 'p1' }, body: { stage: 2, trigger: 'STAGE_1_APPROVED_START_2' } } as any,
        {} as any,
        jest.fn(),
      );

      expect(printed(log)).toContain('route=ai-stage-result project=p1 stage=2 trigger=STAGE_1_APPROVED_START_2');
    });

    it('never blocks the request when the payload cannot be printed', () => {
      const next = jest.fn();
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      logIncomingAiPayload('stage-run')({ params: { projectId: 'p1', stage: '0' }, body: circular } as any, {} as any, next);

      expect(next).toHaveBeenCalledWith();
      expect(error).toHaveBeenCalled();
    });
  });

  describe('logSavedSchemaAfterAi', () => {
    it('prints the saved schema', async () => {
      await logSavedSchemaAfterAi(async () => ({ stage_2: { glass_type: { value: 'GLASS_NO_IGU' } } }), {
        route: 'stage-run',
        project: 'p1',
        stage: 0,
      });

      const out = printed(log);
      expect(out).toContain('[AI RESULT SAVED] route=stage-run project=p1 stage=0');
      expect(out).toContain('"value": "GLASS_NO_IGU"');
    });

    it('swallows a failed schema read', async () => {
      await expect(
        logSavedSchemaAfterAi(async () => { throw new Error('mongo down'); }, { route: 'stage-run', project: 'p1', stage: 0 }),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
    });
  });

  describe('controllers log the schema as saved after the AI push', () => {
    const saved = { stage_3: { decision: { frame_type: { value: 'SERIES_3000' } } } };

    it('stage run (stage 0 re-extraction)', async () => {
      const service = {
        pushDeepSchemaFromAI: jest.fn().mockResolvedValue({ stage: 0 }),
        getSavedSchema: jest.fn().mockResolvedValue(saved),
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await new ProposalController(service as any).runStage(
        { params: { projectId: 'p1', stage: '0' }, body: { stage: 0, fields: { stage_3: {} } } } as any,
        res,
      );

      expect(service.getSavedSchema).toHaveBeenCalledWith('p1');
      expect(service.getSavedSchema.mock.invocationCallOrder[0]).toBeGreaterThan(
        service.pushDeepSchemaFromAI.mock.invocationCallOrder[0] as number,
      );
      expect(printed(log)).toContain('[AI RESULT SAVED] route=stage-run project=p1 stage=0');
      expect(printed(log)).toContain('"value": "SERIES_3000"');
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('stage result webhook', async () => {
      const service = {
        pushDeepSchemaFromAI: jest.fn().mockResolvedValue({ stage: 2 }),
        getSavedSchema: jest.fn().mockResolvedValue(saved),
        updateAnalysisStatus: jest.fn(),
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await new AiStageResultController(service as any).handleResult(
        { params: { projectId: 'p1' }, body: { stage: 2, status: 'SUCCESS', fields_to_show: { glass_type: {} } }, headers: {} } as any,
        res,
      );

      expect(service.getSavedSchema).toHaveBeenCalledWith('p1');
      expect(printed(log)).toContain('[AI RESULT SAVED] route=ai-stage-result project=p1 stage=2');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
