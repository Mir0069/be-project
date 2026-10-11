// =============================================================================
// PROPOSAL SERVICE — REVISE STAGE (UNAPPROVE) & REVISION TRACKING
// =============================================================================

import ExcelJS from 'exceljs';
import { StatusCodes } from 'http-status-codes';
import { ProjectStatus, ProjectAnalysisStatus } from '../../../../src/db/models/project.model';
import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { ProposalEvent, proposalEventBus } from '../../../../src/features/proposal/proposal.events';
import { notificationService } from '../../../../src/features/notifications/notification.router';
import { loadTemplateBuffer } from '../../../../src/features/proposal/excel/graph.generator';
import { StageTriggerPublisher } from '../../../../src/features/proposal/queues/stage-trigger.publisher';
import { PipelineTrigger } from '../../../../src/features/proposal/pipeline-triggers';

jest.mock('../../../../src/features/proposal/queues/stage-trigger.publisher', () => {
  const { jest: j } = require('@jest/globals');
  return {
    StageTriggerPublisher: j.fn().mockImplementation(() => ({
      publish: j.fn().mockResolvedValue(undefined),
      publishExtraction: j.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('../../../../src/features/proposal/excel/graph.generator', () => {
  const actual = jest.requireActual('../../../../src/features/proposal/excel/graph.generator');
  return {
    ...actual,
    loadTemplateBuffer: jest.fn(),
    generateProposalExcelWithFallback: jest.fn().mockImplementation(async () => {
      const wb = new (require('exceljs').Workbook)();
      wb.addWorksheet('Proposal');
      const buffer = await wb.xlsx.writeBuffer();
      return { buffer: Buffer.from(buffer), calculatedByGraph: false };
    }),
  };
});

jest.mock('../../../../src/features/projects/dropbox-sync.service', () => ({
  dropboxSyncService: {
    uploadDirectDocument: jest.fn().mockResolvedValue(undefined),
    outwardSync: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../../src/db/models/document.model', () => {
  const actual = jest.requireActual('../../../../src/db/models/document.model');
  return {
    ...actual,
    DocumentModel: {
      create: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      }),
      updateOne: jest.fn().mockResolvedValue({}),
    },
  };
});

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    model: jest.fn((name: string, ...args: any[]) => {
      if (name === 'User') {
        return {
          find: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            { _id: 'u1', firstName: 'Jane', lastName: 'Doe' },
            { _id: 'u2', firstName: 'John', lastName: 'Smith' },
          ]),
        };
      }
      return actual.model(name, ...args);
    }),
  };
});

const projectId = '507f1f77bcf86cd799439011';
const estimatorId = '507f1f77bcf86cd799439012';

const buildProposalRepo = () => ({
  findByProjectId: jest.fn(),
  ensureProposalExists: jest.fn(),
  getCurrentSchema: jest.fn(),
  appendVersion: jest.fn(),
  getVersionHistory: jest.fn(),
  getVersion: jest.fn(),
  logExcelGeneration: jest.fn(),
  appendRevision: jest.fn(),
});

const buildProjectRepo = () => ({
  findById: jest.fn().mockResolvedValue({ assignedEstimators: [estimatorId] }),
  updateById: jest.fn().mockResolvedValue({ status: 'READY_FOR_ESTIMATOR' }),
});

const buildService = (proposalRepo: any, projectRepo: any) =>
  new ProposalService(proposalRepo, projectRepo, { recalculate: jest.fn() } as any, {} as any);

const captureAppendVersionArgs = (proposalRepo: any): any =>
  proposalRepo.appendVersion.mock.calls[0][0];

const getPublishMock = (): jest.Mock => {
  const instance = (StageTriggerPublisher as unknown as jest.Mock).mock.results[0]!.value as any;
  return instance.publish as jest.Mock;
};

describe('ProposalService — unapproveStage (Revise)', () => {
  let proposalRepo: any;
  let projectRepo: any;
  let service: ProposalService;

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = buildProposalRepo();
    projectRepo = buildProjectRepo();
    service = buildService(proposalRepo, projectRepo);
  });

  const approvedSchema = () => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'LOCKED';
    schema.pipeline_status.stage_4_status = 'LOCKED';
    schema.pipeline_status.stage_5_status = 'APPROVED';
    schema.pipeline_status.stage_6_status = 'APPROVED';
    schema.pipeline_status.stage_7_status = 'LOCKED';
    schema.stage_2.glass_type.status = 'APPROVED';
    schema.stage_5.addons.duty.status = 'APPROVED';
    schema.stage_5.calculated.total_sqft.status = 'APPROVED';
    schema.stage_7 = { status: 'APPROVED', cost_overrides: { C9: 555 } };
    return schema;
  };

  it('appends a revision record with the provided reason', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN', 'client changed spec');

    expect(proposalRepo.appendRevision).toHaveBeenCalledWith({
      projectId,
      stage: 2,
      reason: 'client changed spec',
      revisedBy: estimatorId,
    });
    expect(proposalRepo.appendVersion).toHaveBeenCalledTimes(1);
  });

  it('stores an empty reason when none is provided', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    expect(proposalRepo.appendRevision).toHaveBeenCalledWith({
      projectId,
      stage: 2,
      reason: '',
      revisedBy: estimatorId,
    });
  });

  it('returns PENDING status for the revised stage', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    const result = await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    expect(result.status).toBe('PENDING');
    expect(result.stage).toBe(2);
  });

  it('marks the project as needing revision while the reopened stage is pending', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN', 'client changed glass');

    expect(projectRepo.updateById).toHaveBeenCalledWith(projectId, expect.objectContaining({
      status: ProjectStatus.NEEDS_REVISION,
      revisionRequest: expect.objectContaining({
        stage: 2,
        reason: 'client changed glass',
        requestedBy: estimatorId,
        requestedAt: expect.any(Date),
      }),
    }));
  });

  it('throws when the stage is not currently approved', async () => {
    const schema = approvedSchema();
    schema.pipeline_status.stage_2_status = 'PENDING';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await expect(service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN')).rejects.toThrow(
      expect.objectContaining({ statusCode: StatusCodes.BAD_REQUEST })
    );
  });

  it('cascades pipeline statuses: target PENDING, downstream LOCKED, stage 6 PENDING', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.pipeline_status.stage_2_status).toBe('PENDING');
    expect(nextSchema.pipeline_status.stage_5_status).toBe('LOCKED');
    expect(nextSchema.pipeline_status.stage_6_status).toBe('PENDING');
    expect(nextSchema.pipeline_status.stage_7_status).toBe('LOCKED');
  });

  it('invalidates (APPROVED -> PENDING) fields of the revised and downstream stages', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.status).toBe('PENDING');
    expect(nextSchema.stage_5.addons.duty.status).toBe('PENDING');
    expect(nextSchema.stage_5.calculated.total_sqft.status).toBe('PENDING');
  });

  it('keeps stage 7 cost overrides intact (invalidate-but-keep)', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_7.cost_overrides).toEqual({ C9: 555 });
  });

  it('emits STAGE_REOPENED with the revision reason', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedSchema());
    const emitSpy = jest.spyOn(proposalEventBus, 'emit');

    await service.unapproveStage(projectId, 2, estimatorId, 'SUPER_ADMIN', 'rework required');

    const reopenedCall = emitSpy.mock.calls.find(([name]) => name === ProposalEvent.STAGE_REOPENED);
    expect(reopenedCall).toBeDefined();
    expect(reopenedCall![1]).toMatchObject({
      projectId,
      data: { stage: 2, status: 'PENDING', reason: 'rework required' },
    });
  });
});

describe('ProposalService — getStage revision metadata', () => {
  it('returns revisions (newest first) and revision_count', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());
    const schema = createEmptySchema();
    proposalRepo.findByProjectId.mockResolvedValue({
      schema,
      revisions: {
        stage_2: [
          { reason: 'first', revisedBy: 'u1', revisedAt: new Date(), revisionNumber: 1 },
          { reason: 'second', revisedBy: 'u2', revisedAt: new Date(), revisionNumber: 2 },
        ],
      },
    });

    const result = await service.getStage(projectId, 2);

    expect(result.revision_count).toBe(2);
    expect(result.revisions.map((r: any) => r.revisionNumber)).toEqual([2, 1]);
    expect(result.revisions[0].reason).toBe('second');
    expect(result.revisions.map((r: any) => r.revisedBy)).toEqual(['John Smith', 'Jane Doe']);
  });

  it('handles legacy proposals without a revisions field', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());
    proposalRepo.findByProjectId.mockResolvedValue({ schema: createEmptySchema() });

    const result = await service.getStage(projectId, 2);

    expect(result.revision_count).toBe(0);
    expect(result.revisions).toEqual([]);
  });
});

describe('ProposalService — per-unit specifications on decision stages', () => {
  it('returns each unit glass type on Stage 2 without copying the global decision', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());
    const schema = createEmptySchema();
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    schema.units = {
      A: {
        unit_id: 'A',
        value_glass_type: 'GLASS_WITH_IGU',
        reasoning: ['Unit A requires insulated glass.'],
        extracted_confidence: 92,
      } as any,
      B: { unit_id: 'B', value_glass_type: null } as any,
    };
    proposalRepo.findByProjectId.mockResolvedValue({ schema, revisions: {} });

    const result = await service.getStage(projectId, 2);

    expect(result.fields_to_show.units).toMatchObject({
      A: {
        unit_id: 'A',
        value_glass_type: 'GLASS_WITH_IGU',
        reasoning: ['Unit A requires insulated glass.'],
        extracted_confidence: 92,
      },
      B: { unit_id: 'B', value_glass_type: null, reasoning: [] },
    });
  });

  it('returns each unit frame type on Stage 3', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());
    const schema = createEmptySchema();
    schema.units = {
      A: { unit_id: 'A', value_frame_type: 'SERIES_2000_PEDESTAL' } as any,
      B: { unit_id: 'B', value_frame_type: 'SERIES_3000' } as any,
    };
    proposalRepo.findByProjectId.mockResolvedValue({ schema, revisions: {} });

    const result = await service.getStage(projectId, 3);

    expect(result.fields_to_show.units).toMatchObject({
      A: { unit_id: 'A', value_frame_type: 'SERIES_2000_PEDESTAL' },
      B: { unit_id: 'B', value_frame_type: 'SERIES_3000' },
    });
  });
});

describe('ProposalService — single-unit project defaults', () => {
  const singleUnitSchema = () => {
    const schema = createEmptySchema();
    schema.stage_2.glass_type.value = 'GLASS_WITH_IGU';
    schema.stage_3.decision.frame_type.value = 'SERIES_2000_PEDESTAL';
    schema.units.A = { unit_id: 'A', value_width_in: 72, value_length_in: 60 } as any;
    return schema;
  };

  it('shows valid project decisions on the only take-off unit without mutating a read', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());
    const schema = singleUnitSchema();
    proposalRepo.findByProjectId.mockResolvedValue({ schema, revisions: {} });

    const result = await service.getStage(projectId, 4);

    expect(result.fields_to_show.units.A).toMatchObject({
      value_glass_type: 'GLASS_WITH_IGU',
      value_frame_type: 'SERIES_2000_PEDESTAL',
    });
    expect(schema.units.A.value_glass_type).toBeUndefined();
    expect(schema.units.A.value_frame_type).toBeUndefined();
  });

  it('persists valid defaults only when Stage 4 is approved', () => {
    const service = buildService(buildProposalRepo(), buildProjectRepo());
    const schema = singleUnitSchema();

    const changedPaths = (service as any)._applySingleUnitProjectDefaults(schema);

    expect(changedPaths).toEqual([
      'units.A.value_glass_type',
      'units.A.value_frame_type',
    ]);
    expect(schema.units.A.value_glass_type).toBe('GLASS_WITH_IGU');
    expect(schema.units.A.value_frame_type).toBe('SERIES_2000_PEDESTAL');
  });

  it('does not guess an unsupported legacy frame label or default a multi-unit project', () => {
    const service = buildService(buildProposalRepo(), buildProjectRepo());
    const schema = singleUnitSchema();
    schema.stage_3.decision.frame_type.value = 'MODIFIED SERIES 1000';
    schema.units.B = { unit_id: 'B', value_width_in: 48 } as any;

    expect((service as any)._applySingleUnitProjectDefaults(schema)).toEqual([]);
    expect(schema.units.A.value_glass_type).toBeUndefined();
    expect(schema.units.A.value_frame_type).toBeUndefined();
  });
});

describe('ProposalService — approveStage idempotency key', () => {
  it('suffixes the key with the stage revision count so re-runs are unique', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({
      revisions: { stage_2: [{ reason: 'x', revisedBy: 'u', revisedAt: new Date(), revisionNumber: 1 }] },
    });

    await service.approveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const publishMock = getPublishMock();
    expect(publishMock).toHaveBeenCalledTimes(1);
    const payload = publishMock.mock.calls[0][0];
    expect(payload.trigger).toBe(PipelineTrigger.STAGE_2_APPROVED_START_3);
    expect(payload.idempotencyKey).toBe(`${projectId}:${PipelineTrigger.STAGE_2_APPROVED_START_3}:1`);
  });

  it('uses a 0 suffix on first approval (no prior revisions)', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_2: [] } });

    await service.approveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const publishMock = getPublishMock();
    expect(publishMock.mock.calls[0][0].idempotencyKey).toBe(
      `${projectId}:${PipelineTrigger.STAGE_2_APPROVED_START_3}:0`
    );
  });
});

describe('ProposalService — revision status reset', () => {
  it('clears Needs Revision after the reopened stage is approved again', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = buildProjectRepo();
    const service = buildService(proposalRepo, projectRepo);
    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_2: [] } });
    projectRepo.findById.mockResolvedValue({
      assignedEstimators: [estimatorId],
      status: ProjectStatus.NEEDS_REVISION,
      revisionRequest: { stage: 2, reason: 'client changed glass' },
    });

    await service.approveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    expect(projectRepo.updateById).toHaveBeenCalledWith(projectId, {
      status: ProjectStatus.ESTIMATOR_DRAFTING,
      analysisStatus: ProjectAnalysisStatus.COMPLETED,
      revisionRequest: null,
    });
  });
});

describe('ProposalService — initializeStage7 preserves estimator overrides', () => {
  it('merges existing cost_overrides over template seeds', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());

    const schema = createEmptySchema();
    schema.stage_7 = { status: 'READY', cost_overrides: { C9: 999 } };
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('C9').value = 100;
    sheet.getCell('C10').value = 200;
    const buffer = await workbook.xlsx.writeBuffer();
    (loadTemplateBuffer as unknown as jest.Mock).mockResolvedValue(buffer);

    await service.initializeStage7(projectId);

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_7.cost_overrides).toEqual({ C9: 999, C10: 200 });
    expect(nextSchema.pipeline_status.stage_7_status).toBe('PENDING');
  });

  it('fills cells from the template when no overrides exist yet', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());

    proposalRepo.getCurrentSchema.mockResolvedValue(createEmptySchema());

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('C9').value = 100;
    const buffer = await workbook.xlsx.writeBuffer();
    (loadTemplateBuffer as unknown as jest.Mock).mockResolvedValue(buffer);

    await service.initializeStage7(projectId);

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_7.cost_overrides).toEqual({ C9: 100 });
  });
});

describe('ProposalService - Stage 0 completion', () => {
  it('marks the project ready only after the extracted schema is persisted', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = buildProjectRepo();
    const service = buildService(proposalRepo, projectRepo);
    proposalRepo.getCurrentSchema.mockResolvedValue(createEmptySchema());
    proposalRepo.appendVersion.mockResolvedValue(undefined);

    await service.pushDeepSchemaFromAI(projectId, 0, { stage_1: {} }, 'ai-worker');

    expect(proposalRepo.appendVersion).toHaveBeenCalledTimes(1);
    expect(projectRepo.updateById).toHaveBeenCalledWith(projectId, {
      status: 'READY_FOR_ESTIMATOR',
      analysisStatus: 'COMPLETED',
    });
    expect(proposalRepo.appendVersion.mock.invocationCallOrder[0]!).toBeLessThan(
      projectRepo.updateById.mock.invocationCallOrder[0]!
    );
  });

  it('does not change the master project status for later stage callbacks', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = buildProjectRepo();
    const service = buildService(proposalRepo, projectRepo);
    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(projectId, 1, { stage_1: {} }, 'ai-worker');

    expect(projectRepo.updateById).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AI PUSHES MUST NOT SILENTLY REWRITE AN APPROVED STAGE
//
// A stage-N run echoes the AI's whole canonical schema, so every block it
// carried used to be applied: an approved glass_type reverted to the AI's older
// answer while pipeline_status still read APPROVED, because deepMergeSchema
// skips pipeline_status. Only a re-extraction may revisit an approved stage,
// and it has to reopen it.
// =============================================================================
describe('ProposalService — pushDeepSchemaFromAI stage scoping', () => {
  let proposalRepo: any;
  let service: ProposalService;

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = buildProposalRepo();
    service = buildService(proposalRepo, buildProjectRepo());
  });

  const schemaWithApprovedStage2 = () => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'PENDING';
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    schema.stage_2.glass_type.status = 'APPROVED';
    return schema;
  };

  const versionForStage = (stage: number): any =>
    proposalRepo.appendVersion.mock.calls.map((call: any[]) => call[0]).find((args: any) => args.stage === stage);

  it('ignores an approved foreign stage block carried by a stage run', async () => {
    const schema = schemaWithApprovedStage2();
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      3,
      {
        stage_3: { decision: { frame_type: { value: 'SERIES_3000', status: 'PENDING' } } },
        stage_2: { glass_type: { value: 'GLASS_WITH_IGU', status: 'NEEDS_REVIEW' } },
      },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_NO_IGU');
    expect(nextSchema.stage_2.glass_type.status).toBe('APPROVED');
    expect(nextSchema.pipeline_status.stage_2_status).toBe('APPROVED');
    // The stage the run is actually authoritative for still lands.
    expect(nextSchema.stage_3.decision.frame_type.value).toBe('SERIES_3000');
  });

  it('applies a foreign stage block when that stage is not approved', async () => {
    const schema = schemaWithApprovedStage2();
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      2,
      { stage_3: { decision: { frame_type: { value: 'SERIES_3000' } } } },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_3.decision.frame_type.value).toBe('SERIES_3000');
  });

  it('still applies the run its own declared stage, approved or not', async () => {
    const schema = schemaWithApprovedStage2();
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      2,
      { stage_2: { glass_type: { value: 'GLASS_WITH_IGU' } } },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_WITH_IGU');
    expect(nextSchema.pipeline_status.stage_2_status).toBe('PENDING');
  });

  it('re-extraction applies the change but reopens the approved stage it changed', async () => {
    const schema = schemaWithApprovedStage2();
    schema.pipeline_status.stage_5_status = 'APPROVED';
    schema.stage_5.addons.krypton_gas.value = 'n';
    schema.stage_5.addons.krypton_gas.status = 'APPROVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      0,
      { stage_5: { addons: { krypton_gas: { value: 'y' } } } },
      'AI',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_5.addons.krypton_gas.value).toBe('y');
    expect(nextSchema.pipeline_status.stage_5_status).toBe('PENDING');
    expect(nextSchema.stage_5.addons.krypton_gas.status).toBe('PENDING');
    // Untouched approved stages keep their approval.
    expect(nextSchema.pipeline_status.stage_2_status).toBe('APPROVED');
  });

  it('re-extraction leaves an approved stage approved when no value changed', async () => {
    const schema = schemaWithApprovedStage2();
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      0,
      {
        stage_2: {
          glass_type: { value: 'GLASS_NO_IGU', reasoning: ['re-read the same drawing'] },
        },
      },
      'AI',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.pipeline_status.stage_2_status).toBe('APPROVED');
    expect(nextSchema.stage_2.glass_type.status).toBe('APPROVED');
    expect(nextSchema.stage_2.glass_type.reasoning).toEqual(['re-read the same drawing']);
  });

  // ---------------------------------------------------------------------------
  // Reproduces GFS-2026-1125: revising Project Header twice reset an explicitly
  // chosen Glass Type to the rules engine's MANUAL, because the revise cleared
  // the APPROVED status the guard above keys on.
  // ---------------------------------------------------------------------------
  const humanSetGlassType = (value: string) => {
    const schema = createEmptySchema();
    // What "revise stage 1" leaves behind: nothing downstream is APPROVED any more.
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = value;
    schema.stage_2.glass_type.status = 'PENDING';
    schema.stage_2.glass_type.updated_by = 'estimator-1';
    schema.stage_2.glass_type.reasoning = ['Set by the estimator'];
    schema.stage_2.glass_type._meta = {
      ...(schema.stage_2.glass_type._meta ?? { manual: false }),
      human_override: true,
      human_override_at: new Date().toISOString(),
      human_override_by: 'estimator-1',
    };
    return schema;
  };

  it('keeps a human-set value when its own stage re-runs after a revise', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(humanSetGlassType('GLASS_WITH_IGU'));

    await service.pushDeepSchemaFromAI(
      projectId,
      2,
      {
        stage_2: {
          glass_type: {
            value: 'MANUAL',
            status: 'PENDING',
            updated_by: 'rules_engine',
            reasoning: ['is_walkable is null - walkability not confirmed in documents'],
          },
        },
      },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_WITH_IGU');
    expect(nextSchema.stage_2.glass_type.updated_by).toBe('estimator-1');
    // The AI's reasoning describes the value it picked, so it must not be shown
    // next to the value the human picked.
    expect(nextSchema.stage_2.glass_type.reasoning).toEqual(['Set by the estimator']);
    expect(nextSchema.stage_2.glass_type._meta?.human_override).toBe(true);
  });

  it('still applies a stage run to fields no human has touched', async () => {
    const schema = humanSetGlassType('GLASS_WITH_IGU');
    schema.pipeline_status.stage_2_status = 'APPROVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      3,
      { stage_3: { decision: { frame_type: { value: 'SERIES_3000' } } } },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_3.decision.frame_type.value).toBe('SERIES_3000');
  });

  it('lets a re-extraction change a human-set value and drops the marker', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(humanSetGlassType('GLASS_WITH_IGU'));

    await service.pushDeepSchemaFromAI(
      projectId,
      0,
      { stage_2: { glass_type: { value: 'GLASS_NO_IGU', reasoning: ['new drawing set'] } } },
      'AI',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_NO_IGU');
    expect(nextSchema.stage_2.glass_type.reasoning).toEqual(['new drawing set']);
    expect(nextSchema.stage_2.glass_type._meta?.human_override).toBeUndefined();
  });

  it('keeps the marker when a re-extraction re-sends the same human value', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(humanSetGlassType('GLASS_WITH_IGU'));

    await service.pushDeepSchemaFromAI(
      projectId,
      0,
      { stage_2: { glass_type: { value: 'GLASS_WITH_IGU', reasoning: ['re-read'] } } },
      'AI',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_WITH_IGU');
    expect(nextSchema.stage_2.glass_type._meta?.human_override).toBe(true);
  });

  it('holds a human-edited takeoff row against a stage 4 re-run', async () => {
    const schema = humanSetGlassType('GLASS_WITH_IGU');
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'APPROVED';
    schema.units['A'] = {
      ...(schema.units['A'] as any),
      value_panel_count: 12,
      updated_by: 'estimator-1',
      _meta: { manual: false, human_override: true },
    } as any;
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      4,
      { units: { A: { value_panel_count: 3, updated_by: 'rules_engine' } } },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.units['A']?.value_panel_count).toBe(12);
  });

  // ---------------------------------------------------------------------------
  // Reproduces the "revise Stage 4, re-approve, description still empty" bug:
  // editing one field on a unit (e.g. panel count) was blocking every AI-only
  // field on that same unit forever, including value_description and
  // value_man_hours, which the estimator never touched.
  // ---------------------------------------------------------------------------
  it('only holds the specific field a human edited on a unit, not the whole row', async () => {
    const schema = humanSetGlassType('GLASS_WITH_IGU');
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'APPROVED';
    schema.units['A'] = {
      ...(schema.units['A'] as any),
      value_width_in: 60,
      value_length_in: 432,
      value_panel_count: 12,
      value_description: null,
      updated_by: 'estimator-1',
      _meta: { manual: false, human_override_fields: ['value_panel_count'] },
    } as any;
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      4,
      {
        units: {
          A: {
            value_panel_count: 6,
            value_description: '(1 Qty.) 60" x 432" ICC approved Series 2000 SkyFloor...',
            value_man_hours: 24,
            updated_by: 'rules_engine',
          },
        },
      },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    // The human's panel-count correction survives...
    expect(nextSchema.units['A']?.value_panel_count).toBe(12);
    // ...but the AI-only fields on the very same unit still update.
    expect(nextSchema.units['A']?.value_description).toBe(
      '(1 Qty.) 60" x 432" ICC approved Series 2000 SkyFloor...',
    );
    expect(nextSchema.units['A']?.value_man_hours).toBe(24);
    expect(nextSchema.units['A']?._meta?.human_override_fields).toEqual(['value_panel_count']);
  });

  it('keeps unit-specific frame and glass selections isolated across AI pushes', async () => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_3_status = 'APPROVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      4,
      {
        units: {
          A: {
            value_frame_type: 'SERIES_2000_PEDESTAL',
            value_glass_type: 'GLASS_WITH_IGU',
            value_width_in: 48,
            value_length_in: 96,
          },
          B: {
            value_frame_type: 'SERIES_1000_RECESSED',
            value_glass_type: 'GLASS_NO_IGU',
            value_width_in: 36,
            value_length_in: 72,
          },
        },
      },
      'AI_WEBHOOK',
    );

    const firstPush = captureAppendVersionArgs(proposalRepo).nextSchema;
    expect(firstPush.units.A).toEqual(expect.objectContaining({
      value_frame_type: 'SERIES_2000_PEDESTAL',
      value_glass_type: 'GLASS_WITH_IGU',
    }));
    expect(firstPush.units.B).toEqual(expect.objectContaining({
      value_frame_type: 'SERIES_1000_RECESSED',
      value_glass_type: 'GLASS_NO_IGU',
    }));

    proposalRepo.getCurrentSchema.mockResolvedValue(firstPush);
    proposalRepo.appendVersion.mockClear();

    await service.pushDeepSchemaFromAI(
      projectId,
      4,
      { units: { A: { value_width_in: 54 } } },
      'AI_WEBHOOK',
    );

    const secondPush = captureAppendVersionArgs(proposalRepo).nextSchema;
    expect(secondPush.units.A).toEqual(expect.objectContaining({
      value_width_in: 54,
      value_frame_type: 'SERIES_2000_PEDESTAL',
      value_glass_type: 'GLASS_WITH_IGU',
    }));
    expect(secondPush.units.B).toEqual(expect.objectContaining({
      value_frame_type: 'SERIES_1000_RECESSED',
      value_glass_type: 'GLASS_NO_IGU',
    }));
  });

  it('records a version in the bucket of every stage the push changed', async () => {
    const schema = schemaWithApprovedStage2();
    schema.pipeline_status.stage_3_status = 'PENDING';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      0,
      {
        stage_1: {},
        stage_3: { decision: { frame_type: { value: 'SERIES_3000' } } },
      },
      'AI',
    );

    // Stage 0 keeps writing its primary version to the stage 1 bucket, and the
    // collaterally changed stage 3 no longer goes unrecorded.
    expect(versionForStage(1)).toBeDefined();
    const stage3Version = versionForStage(3);
    expect(stage3Version).toBeDefined();
    expect(stage3Version.changedFieldPaths).toContain('stage_3.decision.frame_type.value');
  });
});

describe('ProposalService — approveStage field statuses', () => {
  it('promotes AI and estimator field statuses, not just PENDING', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    schema.stage_2.glass_type.status = 'NEEDS_REVIEW';
    schema.stage_2._signals.is_walkable.status = 'EXTRACTED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_2: [] } });

    await service.approveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.status).toBe('APPROVED');
    // AI-internal signals are not estimator-approvable fields.
    expect(nextSchema.stage_2._signals.is_walkable.status).toBe('EXTRACTED');
  });

  it('promotes a saved estimator edit so revise can reset it later', async () => {
    const proposalRepo = buildProposalRepo();
    const service = buildService(proposalRepo, buildProjectRepo());

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = 'GLASS_NO_IGU';
    schema.stage_2.glass_type.status = 'SAVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_2: [] } });

    await service.approveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.stage_2.glass_type.status).toBe('APPROVED');
    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_NO_IGU');
  });
});

describe('ProposalService — project workflow status auto-sync', () => {
  it('transitions READY_FOR_ESTIMATOR to ESTIMATOR_DRAFTING on Stage 1 approval', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        status: 'READY_FOR_ESTIMATOR',
        assignedEstimators: [estimatorId],
      }),
      updateById: jest.fn().mockResolvedValue({ status: 'ESTIMATOR_DRAFTING' }),
    };
    const service = buildService(proposalRepo, projectRepo);

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'PENDING';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_1: [] } });

    await service.approveStage(projectId, 1, estimatorId, 'SUPER_ADMIN');

    expect(projectRepo.updateById).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({
        status: 'ESTIMATOR_DRAFTING',
        analysisStatus: ProjectAnalysisStatus.COMPLETED,
      }),
    );
  });

  it('transitions ESTIMATOR_DRAFTING to ESTIMATOR_FINAL on Stage 6 approval', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        status: 'ESTIMATOR_DRAFTING',
        assignedEstimators: [estimatorId],
      }),
      updateById: jest.fn().mockResolvedValue({ status: 'ESTIMATOR_FINAL' }),
    };
    const service = buildService(proposalRepo, projectRepo);

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'APPROVED';
    schema.pipeline_status.stage_4_status = 'APPROVED';
    schema.pipeline_status.stage_5_status = 'APPROVED';
    schema.pipeline_status.stage_6_status = 'PENDING';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_6: [] } });

    await service.approveStage(projectId, 6, estimatorId, 'SUPER_ADMIN');

    expect(projectRepo.updateById).toHaveBeenCalledWith(projectId, {
      status: 'ESTIMATOR_FINAL',
      analysisStatus: ProjectAnalysisStatus.COMPLETED,
    });
  });

  it('transitions READY_FOR_ESTIMATOR to ESTIMATOR_DRAFTING when saving field edits', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        status: 'READY_FOR_ESTIMATOR',
        assignedEstimators: [estimatorId],
      }),
      updateById: jest.fn().mockResolvedValue({ status: 'ESTIMATOR_DRAFTING' }),
    };
    const service = buildService(proposalRepo, projectRepo);

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'PENDING';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.saveFieldEdit(projectId, 'stage_1.project_name', 'New Name', estimatorId, 'ESTIMATOR');

    expect(projectRepo.updateById).toHaveBeenCalledWith(projectId, {
      status: 'ESTIMATOR_DRAFTING',
      analysisStatus: ProjectAnalysisStatus.COMPLETED,
    });
  });
});

describe('ProposalService — Stage 7 approval & quote generation', () => {
  it('issues quote number, saves document, and triggers Dropbox sync on Stage 7 approval', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        referenceNumber: 'GFS-2026-1012',
        quoteNumber: null,
        assignedEstimators: [estimatorId],
      }),
      updateById: jest.fn().mockResolvedValue({
        id: projectId,
        referenceNumber: 'GFS-2026-1012',
        quoteNumber: '20261012',
      }),
    };

    const blobStorage = {
      put: jest.fn().mockResolvedValue({ storageKey: 'quotes/quote-1.xlsx', blobUrl: 'https://blob/quote-1.xlsx' }),
      download: jest.fn(),
    };

    const service = new ProposalService(
      proposalRepo,
      projectRepo as any,
      { recalculate: jest.fn() } as any,
      blobStorage as any
    );

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'APPROVED';
    schema.pipeline_status.stage_4_status = 'APPROVED';
    schema.pipeline_status.stage_5_status = 'APPROVED';
    schema.pipeline_status.stage_6_status = 'APPROVED';
    schema.pipeline_status.stage_7_status = 'PENDING';
    schema.stage_7 = {
      status: 'PENDING',
      cost_overrides: {},
      approval: { approverId: estimatorId, approverName: 'Assigned approver' },
    } as any;
    schema.stage_1.project_address = { value: '123 Main St', status: 'APPROVED' } as any;
    schema.stage_1.contact_name = { value: 'John Smith', status: 'APPROVED' } as any;

    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_7: [] } });
    const resolveApprovalRequests = jest
      .spyOn(notificationService, 'resolveStage7ApprovalRequests')
      .mockResolvedValue(undefined);

    const result = await service.approveStage(projectId, 7, estimatorId, 'SUPER_ADMIN');

    expect(result.status).toBe('APPROVED');
    expect(projectRepo.updateById).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ quoteNumber: '20261012' })
    );
    expect(blobStorage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        originalName: expect.stringContaining('Glass Flooring Systems Proposal #20261012.xlsx'),
      })
    );
    expect(resolveApprovalRequests).toHaveBeenCalledWith(projectId, estimatorId);
    resolveApprovalRequests.mockRestore();
  });

  it('issues Revision A when re-approving Stage 7 after revision', async () => {
    const proposalRepo = buildProposalRepo();
    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        referenceNumber: 'GFS-2026-1012',
        quoteNumber: '20261012',
        assignedEstimators: [estimatorId],
      }),
      updateById: jest.fn().mockResolvedValue({
        id: projectId,
        referenceNumber: 'GFS-2026-1012',
        quoteNumber: '20261012A',
      }),
    };

    const blobStorage = {
      put: jest.fn().mockResolvedValue({ storageKey: 'quotes/quote-2.xlsx', blobUrl: 'https://blob/quote-2.xlsx' }),
      download: jest.fn(),
    };

    const service = new ProposalService(
      proposalRepo,
      projectRepo as any,
      { recalculate: jest.fn() } as any,
      blobStorage as any
    );

    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'APPROVED';
    schema.pipeline_status.stage_3_status = 'APPROVED';
    schema.pipeline_status.stage_4_status = 'APPROVED';
    schema.pipeline_status.stage_5_status = 'APPROVED';
    schema.pipeline_status.stage_6_status = 'APPROVED';
    schema.pipeline_status.stage_7_status = 'PENDING';
    schema.stage_1.project_address = { value: '123 Main St', status: 'APPROVED' } as any;
    schema.stage_1.contact_name = { value: 'John Smith', status: 'APPROVED' } as any;

    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_7: [{ revisionNumber: 1 }] } });

    await service.approveStage(projectId, 7, estimatorId, 'SUPER_ADMIN');

    expect(projectRepo.updateById).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ quoteNumber: '20261012A' })
    );
    expect(blobStorage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: expect.stringContaining('Glass Flooring Systems Proposal #20261012A.xlsx'),
      })
    );
  });
});

describe('ProposalService — generateExcel read-only behavior', () => {
  it('serves the existing latest quote document from storage without minting a new revision', async () => {
    const { DocumentModel } = require('../../../../src/db/models/document.model');
    const existingDoc = {
      _id: 'doc-123',
      storageKey: 'quotes/test-quote.xlsx',
      originalName: '8.30.26 - 123 Main St - John Smith - Glass Flooring Systems Proposal #20261012A.xlsx',
      createdAt: new Date('2026-09-15T12:00:00.000Z'),
    };

    DocumentModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(existingDoc),
    });

    const fileContent = Buffer.from('mock-excel-file-content');
    const blobStorage = {
      download: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield fileContent;
        })(),
      }),
    };

    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        referenceNumber: 'GFS-2026-1012',
        quoteNumber: '20261012A',
        assignedEstimators: [estimatorId],
      }),
      updateById: jest.fn().mockResolvedValue({ id: projectId }),
    };

    const proposalRepo = buildProposalRepo();
    proposalRepo.getCurrentSchema.mockResolvedValue({ pipeline_status: { stage_7_status: 'APPROVED' } });

    const service = new ProposalService(
      proposalRepo,
      projectRepo as any,
      { recalculate: jest.fn() } as any,
      blobStorage as any
    );

    const { buffer, fileName } = await service.generateExcel(projectId, estimatorId, 'SUPER_ADMIN');

    expect(buffer.toString()).toBe(fileContent.toString());
    expect(fileName).toBe('8.30.26 - 123 Main St - John Smith - Glass Flooring Systems Proposal #20261012A.xlsx');
    // Downloading never bumps quoteNumber — any updateById call is only the
    // (already-approved) project-completion side effect, never a quote re-issue.
    for (const call of projectRepo.updateById.mock.calls) {
      expect(call[1]).not.toHaveProperty('quoteNumber');
    }
  });

  it('allows SALES_MANAGER to generate Excel without being assigned to the project', async () => {
    const { DocumentModel } = require('../../../../src/db/models/document.model');
    const existingDoc = {
      id: 'doc-existing-id',
      storageKey: 'quotes/test-quote.xlsx',
      originalName: 'Proposal.xlsx',
      createdAt: new Date('2026-09-15T12:00:00.000Z'),
    };

    DocumentModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(existingDoc),
    });

    const fileContent = Buffer.from('mock-excel-file-content');
    const blobStorage = {
      download: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield fileContent;
        })(),
      }),
    };

    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        referenceNumber: 'GFS-2026-1012',
        quoteNumber: '20261012A',
        assignedEstimators: [], // Not assigned to any estimator
      }),
      updateById: jest.fn().mockResolvedValue({ id: projectId }),
    };

    const proposalRepo = buildProposalRepo();
    proposalRepo.getCurrentSchema.mockResolvedValue({ pipeline_status: { stage_7_status: 'APPROVED' } });

    const service = new ProposalService(
      proposalRepo,
      projectRepo as any,
      { recalculate: jest.fn() } as any,
      blobStorage as any
    );

    const { buffer } = await service.generateExcel(projectId, 'unassigned-sales-manager-id', 'SALES_MANAGER');
    expect(buffer.toString()).toBe(fileContent.toString());
  });

  it('blocks unassigned ESTIMATOR from generating Excel', async () => {
    const projectRepo = {
      findById: jest.fn().mockResolvedValue({
        id: projectId,
        assignedEstimators: ['other-estimator-id'],
      }),
      updateById: jest.fn(),
    };

    const service = new ProposalService(
      buildProposalRepo(),
      projectRepo as any,
      { recalculate: jest.fn() } as any,
      {} as any
    );

    await expect(
      service.generateExcel(projectId, 'unassigned-estimator-id', 'ESTIMATOR')
    ).rejects.toThrow('You are not authorized to edit or approve this proposal');
  });

  describe('ProposalService — local price computation and value sync', () => {
    it('returns Graph snapshot price when available', () => {
      const service = new ProposalService(
        buildProposalRepo(),
        {} as any,
        { recalculate: jest.fn() } as any,
        {} as any
      );

      const schema: any = {
        stage_7: {
          computed_snapshot: { final_price: 25450.75 },
          cost_overrides: { C9: 100 },
        },
      };

      expect(service.computeProposalPrice(schema)).toBe(25450.75);
    });

    it('computes line-item total from final parameters schema and cost overrides when Graph snapshot is not available', () => {
      const service = new ProposalService(
        buildProposalRepo(),
        {} as any,
        { recalculate: jest.fn() } as any,
        {} as any
      );

      const schema: any = {
        stage_2: {
          glass_type: { value: 'GLASS_NO_IGU' },
        },
        stage_5: {
          calculated: {
            total_sqft: { value: 150 },
            perimeter_lf: { value: 40 },
          },
          addons: {
            sentry_glass: { value: 'y' },
          },
        },
        stage_7: {
          cost_overrides: {
            C9: 50, // 150 sqft * 50 = 7500
            C16: 10, // 150 sqft * 10 = 1500
          },
        },
      };

      const computedPrice = service.computeProposalPrice(schema);
      expect(computedPrice).toBe(9000);
    });
  });

  describe('ProposalService — Stage 1 header fields & estimator assignment', () => {
    it('removes quote_number from fields_to_show and defaults person_quoting to single assigned estimator', async () => {
      const proposalRepo = buildProposalRepo();
      const projectRepo = {
        findById: jest.fn().mockResolvedValue({
          id: projectId,
          assignedEstimators: [{ id: estimatorId, name: 'Alice Walker' }],
        }),
      };
      const service = buildService(proposalRepo, projectRepo);

      const schema = createEmptySchema();
      // Legacy document with quote_number in schema
      (schema.stage_1 as any).quote_number = { value: '20261012', status: 'PENDING' };
      schema.stage_1.person_quoting = { value: null, status: 'PENDING' };

      proposalRepo.findByProjectId.mockResolvedValue({
        schema,
        revisions: { stage_1: [] },
      });

      const result = await service.getStage(projectId, 1);

      expect(result.fields_to_show.quote_number).toBeUndefined();
      expect(result.fields_to_show.person_quoting.value).toBe('Alice Walker');
      expect(result.fields_to_show.person_quoting._meta.value_type).toBe('select');
      expect(result.fields_to_show.person_quoting._meta.allowed_values).toEqual(['Alice Walker']);
    });

    it('provides multi-estimator options when multiple estimators are assigned', async () => {
      const proposalRepo = buildProposalRepo();
      const projectRepo = {
        findById: jest.fn().mockResolvedValue({
          id: projectId,
          assignedEstimators: [
            { id: 'est-1', name: 'Alice Walker' },
            { id: 'est-2', name: 'Bob Stone' },
          ],
        }),
      };
      const service = buildService(proposalRepo, projectRepo);

      const schema = createEmptySchema();
      schema.stage_1.person_quoting = { value: null, status: 'PENDING' };

      proposalRepo.findByProjectId.mockResolvedValue({
        schema,
        revisions: { stage_1: [] },
      });

      const result = await service.getStage(projectId, 1);

      expect(result.fields_to_show.person_quoting.value).toBe('Alice Walker');
      expect(result.fields_to_show.person_quoting._meta.allowed_values).toEqual([
        'Alice Walker',
        'Bob Stone',
        'Alice Walker & Bob Stone',
      ]);
    });

    it('preserves an existing user-selected estimator in person_quoting', async () => {
      const proposalRepo = buildProposalRepo();
      const projectRepo = {
        findById: jest.fn().mockResolvedValue({
          id: projectId,
          assignedEstimators: [
            { id: 'est-1', name: 'Alice Walker' },
            { id: 'est-2', name: 'Bob Stone' },
          ],
        }),
      };
      const service = buildService(proposalRepo, projectRepo);

      const schema = createEmptySchema();
      schema.stage_1.person_quoting = { value: 'Bob Stone', status: 'PENDING' };

      proposalRepo.findByProjectId.mockResolvedValue({
        schema,
        revisions: { stage_1: [] },
      });

      const result = await service.getStage(projectId, 1);

      expect(result.fields_to_show.person_quoting.value).toBe('Bob Stone');
      expect(result.fields_to_show.person_quoting._meta.allowed_values).toEqual([
        'Alice Walker',
        'Bob Stone',
        'Alice Walker & Bob Stone',
      ]);
    });

    it('populates default estimator in person_quoting on Stage 1 approval if not set', async () => {
      const proposalRepo = buildProposalRepo();
      const projectRepo = {
        findById: jest.fn().mockResolvedValue({
          id: projectId,
          status: 'READY_FOR_ESTIMATOR',
          assignedEstimators: [{ id: estimatorId, name: 'Alice Walker' }],
        }),
        updateById: jest.fn().mockResolvedValue({ status: 'ESTIMATOR_DRAFTING' }),
      };
      const service = buildService(proposalRepo, projectRepo);

      const schema = createEmptySchema();
      schema.pipeline_status.stage_1_status = 'PENDING';
      schema.stage_1.person_quoting = { value: null, status: 'PENDING' };

      proposalRepo.getCurrentSchema.mockResolvedValue(schema);
      proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_1: [] } });

      await service.approveStage(projectId, 1, estimatorId, 'SUPER_ADMIN');

      expect(proposalRepo.appendVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 1,
          nextSchema: expect.objectContaining({
            stage_1: expect.objectContaining({
              person_quoting: expect.objectContaining({
                value: 'Alice Walker',
              }),
            }),
          }),
        })
      );
    });
  });
});



// ---------------------------------------------------------------------------
// Per-unit man hours + proposal descriptions reach the backend on two AI
// channels (Stage 5 units, Stage 6 workbook cells). Both must land on
// units.X so the preview/PDF and Parameters/Final Parameters can show them.
// ---------------------------------------------------------------------------
describe('ProposalService — per-unit man hours and descriptions', () => {
  let proposalRepo: any;
  let service: ProposalService;

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = buildProposalRepo();
    service = buildService(proposalRepo, buildProjectRepo());
  });

  const approvedThrough = (stage: number) => {
    const schema = createEmptySchema();
    for (let s = 1; s <= stage; s++) (schema.pipeline_status as any)[`stage_${s}_status`] = 'APPROVED';
    schema.units['A'] = { ...(schema.units['A'] as any), value_location: 'Foyer', value_width_in: 96, value_length_in: 120, value_panel_count: 10 };
    schema.units['B'] = { ...(schema.units['B'] as any), value_location: 'Deck Skylights', value_width_in: 24, value_length_in: 48, value_panel_count: 3 };
    return schema;
  };

  it('persists Stage 5 per-unit descriptions even though Stage 4 (owner of units) is approved', async () => {
    proposalRepo.getCurrentSchema.mockResolvedValue(approvedThrough(4));

    await service.pushDeepSchemaFromAI(
      projectId,
      5,
      {
        stage_5: {},
        units: {
          A: { value_man_hours: 44, value_description: '(1 Qty.) 96" x 120" floor', generated_desc_at: '2026-09-24T00:00:00Z' },
          B: { value_man_hours: 16, value_description: '(1 Qty.) 24" x 48" floor' },
        },
      },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.units.A).toEqual(expect.objectContaining({ value_man_hours: 44, value_description: '(1 Qty.) 96" x 120" floor' }));
    expect(nextSchema.units.B).toEqual(expect.objectContaining({ value_man_hours: 16, value_description: '(1 Qty.) 24" x 48" floor' }));
    expect(nextSchema.pipeline_status.stage_4_status).toBe('APPROVED');
  });

  it('back-fills unit man hours from Stage 6 row-71 cells without replacing existing values', async () => {
    const schema = approvedThrough(5);
    schema.units['B']!.value_man_hours = 20;
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.pushDeepSchemaFromAI(
      projectId,
      6,
      { stage_6: { status: 'READY_FOR_EXCEL', cells: { E71: 44, H71: 16, E115: 96 } } },
      'AI_WEBHOOK',
    );

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.units.A.value_man_hours).toBe(44);
    expect(nextSchema.units.B.value_man_hours).toBe(20);
    expect(nextSchema.stage_6.cells).toEqual(expect.objectContaining({ E71: 44, H71: 16 }));
  });

  it('fills missing unit descriptions from AI Stage 6 proposal cells', async () => {
    const schema = approvedThrough(5);
    schema.units['B']!.value_description = 'Existing B';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.ingestProposalCells(projectId, {
      status: 'READY_FOR_EXCEL',
      cells: { J23: '(1 Qty.) 96" x 120" floor', J24: 'AI B', J25: 'Description' },
    });

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.units.A.value_description).toBe('(1 Qty.) 96" x 120" floor');
    expect(nextSchema.units.B.value_description).toBe('Existing B');
    expect(nextSchema.units.C.value_description ?? null).toBeNull();
  });

  it('turns an estimator description edit into a held unit description', async () => {
    const schema = approvedThrough(5);
    schema.units['A']!.value_description = 'AI wording';
    schema.units['B']!.value_description = 'Untouched B';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    await service.updateProposalCells(projectId, 'estimator-1', {
      cells: { J23: 'Estimator wording', J24: 'Untouched B' },
    });

    const { nextSchema } = captureAppendVersionArgs(proposalRepo);
    expect(nextSchema.units.A.value_description).toBe('Estimator wording');
    expect(nextSchema.units.A.description_manually_edited).toBe(true);
    expect(nextSchema.units.A._meta.human_override_fields).toContain('value_description');
    // Re-saving an unchanged cell is not an edit.
    expect(nextSchema.units.B._meta?.human_override_fields ?? []).not.toContain('value_description');

    // A later AI Stage 5 run keeps the estimator's wording.
    proposalRepo.getCurrentSchema.mockResolvedValue(nextSchema);
    proposalRepo.appendVersion.mockClear();
    await service.pushDeepSchemaFromAI(
      projectId,
      5,
      { stage_5: {}, units: { A: { value_description: 'AI rewrite', value_man_hours: 44 } } },
      'AI_WEBHOOK',
    );
    const rerun = captureAppendVersionArgs(proposalRepo).nextSchema;
    expect(rerun.units.A.value_description).toBe('Estimator wording');
    expect(rerun.units.A.value_man_hours).toBe(44);
  });
});

describe('ProposalService — Stage 2 needs a chosen glass type', () => {
  const stage2Schema = (glass: unknown, units: Record<string, any> = {}) => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.stage_2.glass_type.value = glass;
    Object.assign(schema.units, units);
    return schema;
  };
  const unit = (id: string, glass: string | null) => ({ unit_id: id, value_width_in: 60, value_length_in: 90, value_glass_type: glass });

  const approve = async (schema: any) => {
    const proposalRepo = buildProposalRepo();
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    proposalRepo.findByProjectId.mockResolvedValue({ revisions: { stage_2: [] } });
    await buildService(proposalRepo, buildProjectRepo()).approveStage(projectId, 2, estimatorId, 'SUPER_ADMIN');
    return proposalRepo;
  };

  it.each([['MANUAL'], [null], ['']])('refuses to approve glass %p', async (glass) => {
    await expect(approve(stage2Schema(glass, { A: unit('A', null) }))).rejects.toThrow(
      expect.objectContaining({ statusCode: StatusCodes.BAD_REQUEST, message: 'Select a glass type before approving Stage 2' }),
    );
  });

  it('approves a chosen glass type', async () => {
    const proposalRepo = await approve(stage2Schema('GLASS_WITH_IGU', { A: unit('A', null) }));

    expect(captureAppendVersionArgs(proposalRepo).nextSchema.pipeline_status.stage_2_status).toBe('APPROVED');
  });

  it('checks each unit of a multi-unit project, falling back to the project glass', async () => {
    await expect(approve(stage2Schema('MANUAL', { A: unit('A', 'GLASS_WITH_IGU'), B: unit('B', 'GLASS_NO_IGU') }))).resolves.toBeDefined();
    await expect(approve(stage2Schema('GLASS_NO_IGU', { A: unit('A', 'GLASS_WITH_IGU'), B: unit('B', null) }))).resolves.toBeDefined();
    await expect(approve(stage2Schema('MANUAL', { A: unit('A', 'GLASS_WITH_IGU'), B: unit('B', null) }))).rejects.toThrow(
      'Select a glass type for every active unit before approving Stage 2',
    );
  });
});

describe('ProposalService — glass/frame edits on a one-unit project', () => {
  const edit = async (units: Record<string, any>, patches: Array<{ fieldPath: string; value: unknown }>) => {
    const proposalRepo = buildProposalRepo();
    const schema = createEmptySchema();
    schema.pipeline_status.stage_1_status = 'APPROVED';
    schema.pipeline_status.stage_2_status = 'PENDING';
    schema.pipeline_status.stage_3_status = 'PENDING';
    schema.stage_2.glass_type.value = 'MANUAL';
    schema.stage_3.decision.frame_type.value = 'SERIES_2000_PEDESTAL';
    Object.assign(schema.units, units);
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    await buildService(proposalRepo, buildProjectRepo()).saveManyFieldEdits(projectId, patches, estimatorId, 'ESTIMATOR');
    return captureAppendVersionArgs(proposalRepo);
  };
  const unitA = { unit_id: 'A', value_width_in: 60, value_length_in: 90, value_glass_type: 'GLASS_2_0', value_frame_type: 'SERIES_2000_PEDESTAL' };

  it('saves the chosen glass on the project and on its only unit', async () => {
    const { nextSchema, changedFieldPaths } = await edit({ A: { ...unitA } }, [{ fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' }]);

    expect(nextSchema.stage_2.glass_type.value).toBe('GLASS_WITH_IGU');
    expect(nextSchema.units.A.value_glass_type).toBe('GLASS_WITH_IGU');
    expect(nextSchema.units.A._meta.human_override_fields).toEqual(['value_glass_type']);
    expect(changedFieldPaths).toEqual(expect.arrayContaining(['stage_2.glass_type', 'units.A.value_glass_type']));
  });

  it('moves the only unit with a frame edit too', async () => {
    const { nextSchema } = await edit({ A: { ...unitA } }, [{ fieldPath: 'stage_3.decision.frame_type', value: 'SERIES_3000' }]);

    expect(nextSchema.units.A.value_frame_type).toBe('SERIES_3000');
    expect(nextSchema.units.A.value_glass_type).toBe('GLASS_2_0');
  });

  it('leaves units alone on a multi-unit project', async () => {
    const { nextSchema } = await edit(
      { A: { ...unitA }, B: { ...unitA, unit_id: 'B' } },
      [{ fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' }],
    );

    expect(nextSchema.units.A.value_glass_type).toBe('GLASS_2_0');
    expect(nextSchema.units.B.value_glass_type).toBe('GLASS_2_0');
  });

  it('keeps a unit value edited in the same request', async () => {
    const { nextSchema } = await edit({ A: { ...unitA } }, [
      { fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' },
      { fieldPath: 'stage_2.units.A.value_glass_type', value: 'GLASS_NO_IGU' },
    ]);

    expect(nextSchema.units.A.value_glass_type).toBe('GLASS_NO_IGU');
  });
});
