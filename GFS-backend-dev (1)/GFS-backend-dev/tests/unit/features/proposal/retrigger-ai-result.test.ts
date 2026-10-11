// How an AI re-extraction result lands after a Zoho/Teams/email approval: the
// frame-family guard, the single-unit sync, and invalid unit values.

import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';

jest.mock('../../../../src/features/proposal/queues/stage-trigger.publisher', () => {
  const { jest: j } = require('@jest/globals');
  return {
    StageTriggerPublisher: j.fn().mockImplementation(() => ({
      publish: j.fn().mockResolvedValue(undefined),
      publishExtraction: j.fn().mockResolvedValue(undefined),
    })),
  };
});

const projectId = '507f1f77bcf86cd799439011';

const singleUnitSchema = () => {
  const schema = createEmptySchema();
  for (const stage of [1, 2, 3, 4, 5] as const) (schema.pipeline_status as any)[`stage_${stage}_status`] = 'APPROVED';
  schema.stage_2.glass_type.value = 'GLASS_WITH_IGU';
  schema.stage_3.decision.frame_type.value = 'SERIES_2000_PEDESTAL';
  (schema.stage_3.decision as any).proposal_number = { value: 13 };
  (schema.stage_3.decision as any).assembly_type = { value: 'KD' };
  Object.assign(schema.units['A']!, {
    value_width_in: 70,
    value_length_in: 432,
    value_glass_type: 'GLASS_WITH_IGU',
    value_frame_type: 'SERIES_2000_PEDESTAL',
  });
  return schema;
};

const aiResult = (frame: string) => ({
  stage_3: {
    decision: {
      frame_type: { value: frame, status: 'NEEDS_REVIEW' },
      proposal_number: { value: 7, updated_by: 'rules_engine' },
      assembly_type: { value: 'MANUAL', updated_by: 'rules_engine' },
    },
    _signals: { frame_type_stated: { value: 'Perimeter NTB', citation: null } },
  },
});

describe('AI re-extraction result after an approved change', () => {
  let proposalRepo: any;
  let projectRepo: any;
  let service: ProposalService;

  const saved = (): any => proposalRepo.appendVersion.mock.calls[0][0].nextSchema;
  const withApproved = (instruction: string | null, startedAt = new Date()) => {
    projectRepo.findById.mockResolvedValue({
      assignedEstimators: [],
      activeRetrigger: instruction ? { correlationId: 'zohoCrmContext:p:h', source: 'ZOHO', instruction, startedAt } : null,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = {
      ensureProposalExists: jest.fn().mockResolvedValue(undefined),
      getCurrentSchema: jest.fn().mockResolvedValue(singleUnitSchema()),
      appendVersion: jest.fn(),
    };
    projectRepo = {
      findById: jest.fn(),
      updateById: jest.fn().mockResolvedValue({ referenceNumber: 'GFS-2026-1082' }),
    };
    service = new ProposalService(proposalRepo, projectRepo, { recalculate: jest.fn() } as any, {} as any);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('applies a frame-family change the approved note names, on the project and its single unit', async () => {
    withApproved('spoke with customer they needed glass with igu and frame type of series 3000');

    await service.pushDeepSchemaFromAI(projectId, 0, aiResult('SERIES_3000'), 'AI');

    expect(saved().stage_3.decision.frame_type.value).toBe('SERIES_3000');
    expect(saved().units.A.value_frame_type).toBe('SERIES_3000');
    expect(saved().stage_3.decision.proposal_number.value).toBe(7);
    expect(saved().pipeline_status.stage_4_status).toBe('PENDING');
  });

  it('rejects the change, and what the rules derived from it, when nothing approved names the family', async () => {
    withApproved(null);

    await service.pushDeepSchemaFromAI(projectId, 0, aiResult('SERIES_3000'), 'AI');

    expect(saved().stage_3.decision.frame_type.value).toBe('SERIES_2000_PEDESTAL');
    expect(saved().stage_3.decision.proposal_number.value).toBe(13);
    expect(saved().stage_3.decision.assembly_type.value).toBe('KD');
    expect(saved().units.A.value_frame_type).toBe('SERIES_2000_PEDESTAL');
  });

  it('rejects a family the approved note does not name', async () => {
    withApproved('customer wants series 3000');

    await service.pushDeepSchemaFromAI(projectId, 0, aiResult('ECONOFRAME'), 'AI');

    expect(saved().stage_3.decision.frame_type.value).toBe('SERIES_2000_PEDESTAL');
  });

  it('does not let an expired approval authorise a change', async () => {
    withApproved('frame type of series 3000', new Date(Date.now() - 3 * 60 * 60 * 1000));

    await service.pushDeepSchemaFromAI(projectId, 0, aiResult('SERIES_3000'), 'AI');

    expect(saved().stage_3.decision.frame_type.value).toBe('SERIES_2000_PEDESTAL');
  });

  it('keeps stored unit values when the AI sends free text, and still saves the rest', async () => {
    withApproved(null);

    await service.pushDeepSchemaFromAI(projectId, 0, {
      units: {
        A: {
          status: 'NEEDS_REVIEW',
          value_glass_type: '10MM LOW IRON TEMPERED + 1.52MM SENTRYGLAS',
          value_frame_type: 'SERIES 2000',
          value_length_in: 430,
        },
      },
    }, 'AI');

    expect(saved().units.A).toMatchObject({
      status: 'NEEDS_REVIEW',
      value_glass_type: 'GLASS_WITH_IGU',
      value_frame_type: 'SERIES_2000_PEDESTAL',
      value_length_in: 430,
    });
  });
});
