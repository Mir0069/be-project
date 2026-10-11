import { ProposalService } from '../../../../src/features/proposal/proposal.service';
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

describe('ProposalService — Zoho & Teams Retrigger Approval Flow', () => {
  let proposalRepo: any;
  let projectRepo: any;
  let blobStorage: any;
  let service: ProposalService;

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = {
      ensureProposalExists: jest.fn().mockResolvedValue(undefined),
    };
    projectRepo = {
      updateById: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        referenceNumber: 'REF-100',
        projectName: 'Test Project',
        assignedEstimators: [],
      }),
    };
    blobStorage = {
      createSignedDownloadUrl: jest.fn().mockImplementation(async (key: string) => {
        const filename = key.split('/').pop() || 'file.pdf';
        return `https://storage.blob.core.windows.net/test/${filename}?sas=123`;
      }),
    };
    service = new ProposalService(proposalRepo, projectRepo, {} as any, blobStorage);
  });

  it('triggers BEGIN_EXTRACTION for Zoho approval even when project documents have cachedAiResultRef', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    const documentId = '507f1f77bcf86cd799439099';

    // Mock existing document that HAS cachedAiResultRef set from a previous run
    const mockDocs = [
      {
        _id: new mongoose.Types.ObjectId(documentId),
        originalName: 'drawing.pdf',
        storageKey: 'projects/123/drawing.pdf',
        blobUrl: 'https://storage.blob.core.windows.net/test/drawing.pdf',
        cachedAiResultRef: 'cached-ai-result-abc-123', // <--- Previously caused silent early return
      },
    ];

    const find = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockDocs),
    });
    const modelSpy = jest.spyOn(mongoose, 'model').mockReturnValue({ find } as any);

    try {
      // Simulate approving a Zoho note change
      await service.triggerStage0Extraction(projectId, [], {
        subject: 'Zoho notes updated: Change panel count to 10',
        fromAddress: 'Estimator',
        correlationId: `zohoCrmContext:${projectId}:hash12345`,
      });
    } finally {
      modelSpy.mockRestore();
    }

    expect(proposalRepo.ensureProposalExists).toHaveBeenCalledWith(projectId);
    
    // Verify that stage trigger publisher WAS CALLED with BEGIN_EXTRACTION
    const publisherInstance = (service as any).triggerPublisher;
    expect(publisherInstance.publishExtraction).toHaveBeenCalledTimes(1);
    expect(publisherInstance.publishExtraction).toHaveBeenCalledWith({
      trigger: 'BEGIN_EXTRACTION',
      jobType: 'PROJECT_EXTRACTION',
      projectId,
      correlationId: `zohoCrmContext:${projectId}:hash12345`,
      payload: {
        subject: 'Zoho notes updated: Change panel count to 10',
        sender: 'Estimator',
        documents: [],
        // The changed text now rides with every trigger. Empty here because this
        // harness stubs mongoose.model with a documents-only mock.
        context: {
          triggerSource: null,
          changeSummary: null,
          zohoDescription: null,
          teamsChatSummaries: [],
          teamsMeetingSummaries: [],
          zohoDescriptionAt: null,
          zohoNotes: [],
          emails: [],
        },
      },
    });
  });

  it('triggers BEGIN_EXTRACTION for Teams summary approval even when project documents have cachedAiResultRef', async () => {
    const projectId = '507f1f77bcf86cd799439011';
    const documentId = '507f1f77bcf86cd799439099';

    const mockDocs = [
      {
        _id: new mongoose.Types.ObjectId(documentId),
        originalName: 'specifications.pdf',
        storageKey: 'projects/123/specifications.pdf',
        blobUrl: 'https://storage.blob.core.windows.net/test/specifications.pdf',
        cachedAiResultRef: 'cached-ai-result-xyz-789',
      },
    ];

    const find = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockDocs),
    });
    const modelSpy = jest.spyOn(mongoose, 'model').mockReturnValue({ find } as any);

    try {
      // Simulate approving a Teams chat summary change
      await service.triggerStage0Extraction(projectId, [], {
        subject: 'Teams chat summary approved: Update panel count to 10',
        fromAddress: 'Teams',
        correlationId: `teamsSummary:chat:${projectId}:fingerprint99`,
      });
    } finally {
      modelSpy.mockRestore();
    }

    const publisherInstance = (service as any).triggerPublisher;
    expect(publisherInstance.publishExtraction).toHaveBeenCalledTimes(1);
    expect(publisherInstance.publishExtraction).toHaveBeenCalledWith({
      trigger: 'BEGIN_EXTRACTION',
      jobType: 'PROJECT_EXTRACTION',
      projectId,
      correlationId: `teamsSummary:chat:${projectId}:fingerprint99`,
      payload: {
        subject: 'Teams chat summary approved: Update panel count to 10',
        sender: 'Teams',
        documents: [],
        context: {
          triggerSource: null,
          changeSummary: null,
          zohoDescription: null,
          teamsChatSummaries: [],
          teamsMeetingSummaries: [],
          zohoDescriptionAt: null,
          zohoNotes: [],
          emails: [],
        },
      },
    });
  });
});
