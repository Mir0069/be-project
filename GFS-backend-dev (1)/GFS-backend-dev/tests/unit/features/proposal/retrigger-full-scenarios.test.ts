import { PendingApprovalService } from '../../../../src/features/proposal/pending-approval.service';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { ApprovalStatus } from '../../../../src/db/models/pending-change-approval.model';
import mongoose from 'mongoose';

jest.mock('../../../../src/features/proposal/queues/stage-trigger.publisher', () => {
  const { jest: j } = require('@jest/globals');
  return {
    StageTriggerPublisher: j.fn().mockImplementation(() => ({
      publish: j.fn().mockResolvedValue(undefined),
      publishExtraction: j.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('Full Retrigger & Text Context Scenario Verification', () => {
  let pendingApprovalRepo: any;
  let proposalRepo: any;
  let projectRepo: any;
  let blobStorage: any;
  let proposalExtractionTrigger: any;
  let pendingApprovalService: PendingApprovalService;
  let proposalService: ProposalService;

  const projectId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();

    proposalRepo = {
      ensureProposalExists: jest.fn().mockResolvedValue(undefined),
      getCurrentSchema: jest.fn().mockResolvedValue({
        stage_1: { project_name: { value: 'Otter Rock' } },
        stage_4: { takeoff: { panel_count: { value: 4 } } },
        pipeline_status: { stage_1_status: 'APPROVED', stage_4_status: 'APPROVED' },
      }),
      appendVersion: jest.fn().mockResolvedValue(undefined),
    };

    projectRepo = {
      updateById: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        referenceNumber: 'REF-200',
        projectName: 'Otter Rock Project',
        zohoLeadId: '7344067000096471005',
        description: 'Customer needed glass non igu with series 3000 frame type of 30x30 dimension total 20 panels',
      }),
    };

    blobStorage = {
      createSignedDownloadUrl: jest.fn().mockImplementation(async (key: string) => {
        return `https://storage.blob.core.windows.net/test/${key}?sas=123`;
      }),
    };

    proposalService = new ProposalService(proposalRepo, projectRepo, {} as any, blobStorage);

    proposalExtractionTrigger = {
      triggerStage0Extraction: jest.fn().mockImplementation((pId, docIds, source, options) =>
        proposalService.triggerStage0Extraction(pId, docIds, source, options)
      ),
    };
  });

  it('Scenario 1: Approving Zoho description ("20 panels") triggers text-only BEGIN_EXTRACTION with documents: []', async () => {
    const approvalId = '66c81a2f3d157020a60d7401';
    const correlationId = `zohoCrmContext:${projectId}:hash_zoho_20_panels`;

    const mockPendingApproval = {
      _id: approvalId,
      projectId,
      source: 'ZOHO',
      sourceId: 'hash_zoho_20_panels',
      correlationId,
      status: ApprovalStatus.PENDING,
      documentIds: [],
      documentNames: [],
      subject: 'Zoho lead description updated',
      sender: 'Zoho',
      reasoning: 'Zoho lead description was updated: "Customer needed glass non igu with series 3000 frame type of 30x30 dimension total 20 panels"',
    };

    pendingApprovalRepo = {
      findById: jest.fn().mockResolvedValue(mockPendingApproval),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      updateProcessingTimestamps: jest.fn().mockResolvedValue(undefined),
    };

    pendingApprovalService = new PendingApprovalService(
      pendingApprovalRepo,
      proposalRepo,
      proposalExtractionTrigger
    );

    // Mock existing cached PDF document
    const mockCachedDocs = [
      {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'),
        projectId,
        originalName: 'drawing_280_otter_rock.pdf',
        storageKey: 'projects/123/drawing_280_otter_rock.pdf',
        cachedAiResultRef: 'cached-ai-hash-abc',
      },
    ];

    const findMock = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockCachedDocs) });
    const modelSpy = jest.spyOn(mongoose, 'model').mockImplementation((modelName: string) => {
      if (modelName === 'Document') return { find: findMock } as any;
      return { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }), find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }) } as any;
    });

    try {
      await pendingApprovalService.approveChange(approvalId, 'estimator_user_1');
    } finally {
      modelSpy.mockRestore();
    }

    const publisher = (proposalService as any).triggerPublisher;
    expect(publisher.publishExtraction).toHaveBeenCalledTimes(1);

    const msg = publisher.publishExtraction.mock.calls[0][0];
    
    // VERIFY 1: payload.documents MUST be [] (0 documents sent to AI queue)
    expect(msg.payload.documents).toEqual([]);

    // VERIFY 2: payload.context MUST carry the updated Zoho description & reasoning
    expect(msg.payload.context.changeSummary).toContain('20 panels');
    expect(msg.payload.context.zohoDescription).toContain('30x30 dimension');
  });

  it('Scenario 2: Approving Teams chat summary triggers text-only BEGIN_EXTRACTION with documents: []', async () => {
    const approvalId = '66c81a2f3d157020a60d7402';
    const correlationId = `teamsSummary:chat:${projectId}:fingerprint_teams_50`;

    const mockPendingApproval = {
      _id: approvalId,
      projectId,
      source: 'TEAMS_CHAT',
      sourceId: 'fingerprint_teams_50',
      correlationId,
      status: ApprovalStatus.PENDING,
      documentIds: [],
      documentNames: [],
      subject: 'Teams chat summary approved',
      sender: 'Teams',
      reasoning: 'Teams chat summary approved: Update glass deck dimensions to 50x50',
    };

    pendingApprovalRepo = {
      findById: jest.fn().mockResolvedValue(mockPendingApproval),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      updateProcessingTimestamps: jest.fn().mockResolvedValue(undefined),
    };

    pendingApprovalService = new PendingApprovalService(
      pendingApprovalRepo,
      proposalRepo,
      proposalExtractionTrigger
    );

    const mockCachedDocs = [
      {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'),
        projectId,
        originalName: 'specs.pdf',
        cachedAiResultRef: 'cached-ai-hash-xyz',
      },
    ];

    const findMock = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockCachedDocs) });
    const modelSpy = jest.spyOn(mongoose, 'model').mockImplementation((modelName: string) => {
      if (modelName === 'Document') return { find: findMock } as any;
      return { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }), find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }) } as any;
    });

    try {
      await pendingApprovalService.approveChange(approvalId, 'estimator_user_1');
    } finally {
      modelSpy.mockRestore();
    }

    const publisher = (proposalService as any).triggerPublisher;
    expect(publisher.publishExtraction).toHaveBeenCalledTimes(1);

    const msg = publisher.publishExtraction.mock.calls[0][0];
    
    // VERIFY: documents is []
    expect(msg.payload.documents).toEqual([]);
    expect(msg.payload.context.changeSummary).toContain('Update glass deck dimensions to 50x50');
  });

  it('Scenario 3: New document upload includes ONLY the new document file in payload.documents', async () => {
    const newDocId = '507f1f77bcf86cd799439088';
    const mockNewDoc = [
      {
        _id: new mongoose.Types.ObjectId(newDocId),
        projectId,
        originalName: 'site_plan_rev2.pdf',
        storageKey: 'projects/123/site_plan_rev2.pdf',
        cachedAiResultRef: null, // New doc has no cache
      },
    ];

    const findMock = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockNewDoc) });
    const modelSpy = jest.spyOn(mongoose, 'model').mockImplementation((modelName: string) => {
      if (modelName === 'Document') return { find: findMock } as any;
      return { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }), find: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([]) }) } as any;
    });

    try {
      await proposalService.triggerStage0Extraction(
        projectId,
        [newDocId],
        {
          subject: 'New revision site plan attached',
          fromAddress: 'architect@firm.com',
          correlationId: 'outlookEmail:msg12345',
        }
      );
    } finally {
      modelSpy.mockRestore();
    }

    const publisher = (proposalService as any).triggerPublisher;
    expect(publisher.publishExtraction).toHaveBeenCalledTimes(1);

    const msg = publisher.publishExtraction.mock.calls[0][0];
    
    // VERIFY: payload.documents contains ONLY site_plan_rev2.pdf
    expect(msg.payload.documents).toHaveLength(1);
    expect(msg.payload.documents[0].originalName).toBe('site_plan_rev2.pdf');
    expect(msg.payload.documents[0].blobUrl).toContain('site_plan_rev2.pdf?sas=123');
  });

  it('Scenario 4: Duplicate document upload with skipIfAllCached=true skips pipeline dispatch completely', async () => {
    const mockCachedDocs = [
      {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439077'),
        projectId,
        originalName: 'already_processed.pdf',
        cachedAiResultRef: 'cached-ai-hash-exists',
      },
    ];

    const findMock = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockCachedDocs) });
    const modelSpy = jest.spyOn(mongoose, 'model').mockImplementation((modelName: string) => {
      if (modelName === 'Document') return { find: findMock } as any;
      return { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }), find: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([]) }) } as any;
    });

    try {
      await proposalService.triggerStage0Extraction(
        projectId,
        [],
        {
          subject: 'Background sync duplicate',
          fromAddress: 'system',
          correlationId: 'sync:dup123',
        },
        { skipIfAllCached: true }
      );
    } finally {
      modelSpy.mockRestore();
    }

    const publisher = (proposalService as any).triggerPublisher;
    // VERIFY: Did not publish extraction because all docs are cached and skipIfAllCached is true
    expect(publisher.publishExtraction).not.toHaveBeenCalled();
  });
});
