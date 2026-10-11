// =============================================================================
// FIELD FEEDBACK — SURVIVAL THROUGH THE SERVICE AND REPOSITORY PATHS
//
// The value of this data is that it outlives the edit. These cover the three
// places that walk or overwrite the schema and could silently destroy it.
// =============================================================================

import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { applyPatches } from '../../../../src/features/proposal/schema-merge.engine';
import type { IFieldFeedbackEntry, IProjectSchema } from '../../../../src/db/models/proposal.model';

jest.mock('../../../../src/features/proposal/queues/stage-trigger.publisher', () => ({
  StageTriggerPublisher: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockResolvedValue(undefined),
    publishExtraction: jest.fn().mockResolvedValue(undefined),
  })),
}));

const projectId = '507f1f77bcf86cd799439011';
const estimatorId = '507f1f77bcf86cd799439012';

const buildRepos = (schema: IProjectSchema) => {
  const proposalRepo = {
    findByProjectId: jest.fn(),
    ensureProposalExists: jest.fn(),
    getCurrentSchema: jest.fn().mockResolvedValue(schema),
    appendVersion: jest.fn().mockResolvedValue({}),
    getVersionHistory: jest.fn(),
    getVersion: jest.fn(),
    logExcelGeneration: jest.fn(),
    appendRevision: jest.fn().mockResolvedValue({}),
  };
  const projectRepo = {
    findById: jest.fn().mockResolvedValue({ assignedEstimators: [estimatorId] }),
    // Stage 0 marks the project ready once the extracted schema is persisted.
    updateById: jest.fn().mockResolvedValue({}),
  };
  const service = new ProposalService(
    proposalRepo as any,
    projectRepo as any,
    { recalculate: jest.fn().mockReturnValue([]) } as any,
    {} as any,
  );
  return { service, proposalRepo };
};

const savedSchema = (proposalRepo: any, call = 0): IProjectSchema =>
  proposalRepo.appendVersion.mock.calls[call][0].nextSchema;

/** A stage 1 schema whose project_name already carries one feedback entry. */
const schemaWithFeedback = (): IProjectSchema => {
  const schema = createEmptySchema();
  schema.pipeline_status.stage_1_status = 'PENDING';
  schema.stage_1.project_name.value = '1500 CLINTON';
  return applyPatches(
    schema,
    [{ fieldPath: 'stage_1.project_name', value: '1500 Clinton Street', feedback: { reasonCode: 'AI_READ_IT_WRONG' } }],
    { source: 'ESTIMATOR', updatedBy: estimatorId, authorRole: 'ESTIMATOR' },
  ).nextSchema;
};

const nameFeedback = (schema: IProjectSchema): IFieldFeedbackEntry[] =>
  (schema.stage_1.project_name._feedback ?? []) as IFieldFeedbackEntry[];

describe('field feedback — survives stage transitions', () => {
  it('approveStage leaves _feedback byte-identical', async () => {
    const before = schemaWithFeedback();
    const snapshot = JSON.stringify(nameFeedback(before));
    const { service, proposalRepo } = buildRepos(before);

    await service.approveStage(projectId, 1, estimatorId, 'ESTIMATOR');

    const after = savedSchema(proposalRepo);
    expect(JSON.stringify(nameFeedback(after))).toBe(snapshot);
    expect(after.pipeline_status.stage_1_status).toBe('APPROVED');
  });

  it('unapproveStage leaves _feedback byte-identical', async () => {
    const before = schemaWithFeedback();
    before.pipeline_status.stage_1_status = 'APPROVED';
    const snapshot = JSON.stringify(nameFeedback(before));
    const { service, proposalRepo } = buildRepos(before);

    await service.unapproveStage(projectId, 1, estimatorId, 'ESTIMATOR', 'wrong glass');

    expect(JSON.stringify(nameFeedback(savedSchema(proposalRepo)))).toBe(snapshot);
  });

  it('pushDeepSchemaFromAI holds the estimator value and its _feedback when a stage re-runs', async () => {
    const before = schemaWithFeedback();
    const { service, proposalRepo } = buildRepos(before);

    await service.pushDeepSchemaFromAI(projectId, 1, { stage_1: { project_name: { value: 'AI SAYS THIS' } } }, 'AI');

    const after = savedSchema(proposalRepo);
    // A stage re-run derives from unchanged inputs, so it may not take back a
    // field a human typed. See ProposalService.pushDeepSchemaFromAI.
    expect(after.stage_1.project_name.value).toBe('1500 Clinton Street');
    expect(nameFeedback(after)).toHaveLength(1);
    expect(nameFeedback(after)[0]!.previous_value).toBe('1500 CLINTON');
  });

  it('pushDeepSchemaFromAI lets a re-extraction change the field and keeps its _feedback', async () => {
    const before = schemaWithFeedback();
    const { service, proposalRepo } = buildRepos(before);

    await service.pushDeepSchemaFromAI(projectId, 0, { stage_1: { project_name: { value: 'AI SAYS THIS' } } }, 'AI');

    const after = savedSchema(proposalRepo);
    expect(after.stage_1.project_name.value).toBe('AI SAYS THIS');
    expect(nameFeedback(after)).toHaveLength(1);
    expect(nameFeedback(after)[0]!.previous_value).toBe('1500 CLINTON');
  });
});

describe('field feedback — stage 7 cost cells', () => {
  const stage7Schema = (): IProjectSchema => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_7_status = 'PENDING';
    schema.stage_7 = { status: 'PENDING', cost_overrides: { C10: 124.32 } };
    return schema;
  };

  it('appends the entry under cost_feedback keyed by the cell address', async () => {
    const { service, proposalRepo } = buildRepos(stage7Schema());

    await service.updateStage7Cost(projectId, 'C10', 130, estimatorId, 'ESTIMATOR', {
      reasonCode: 'COMPANY_STANDARD',
      note: 'our list price',
    });

    const entries = savedSchema(proposalRepo).stage_7!.cost_feedback!['C10']!;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      reason_code: 'COMPANY_STANDARD',
      note: 'our list price',
      previous_value: 124.32,
      new_value: 130,
      stage: 7,
    });
  });

  it('does not record feedback for a cell that had no previous override', async () => {
    const schema = stage7Schema();
    schema.stage_7!.cost_overrides = {};
    const { service, proposalRepo } = buildRepos(schema);

    await service.updateStage7Cost(projectId, 'C10', 130, estimatorId, 'ESTIMATOR', { reasonCode: 'OTHER' });

    expect(savedSchema(proposalRepo).stage_7!.cost_feedback).toBeUndefined();
  });
});
