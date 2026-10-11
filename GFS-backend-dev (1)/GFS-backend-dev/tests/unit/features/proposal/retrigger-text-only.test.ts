import { PendingApprovalController } from '../../../../src/features/proposal/pending-approval.controller';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { StatusCodes } from 'http-status-codes';
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

describe('Text-only & Retrigger Behavior', () => {
  describe('PendingApprovalController — manualRetrigger', () => {
    it('accepts empty/missing documentIds and calls triggerStage0Extraction with empty array', async () => {
      const mockTrigger = {
        triggerStage0Extraction: jest.fn().mockResolvedValue(undefined),
      };
      const mockService = {} as any;
      const controller = new PendingApprovalController(mockService, mockTrigger);

      const req = {
        params: { projectId: 'proj-123' },
        body: {}, // no documentIds provided
        user: { userId: 'user-456' },
      } as any;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await controller.manualRetrigger(req, res);

      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Manual re-trigger initiated successfully',
      });
      expect(mockTrigger.triggerStage0Extraction).toHaveBeenCalledWith(
        'proj-123',
        [],
        expect.objectContaining({
          subject: 'Manual re-trigger',
          fromAddress: 'User user-456',
        })
      );
    });

    it('passes specific documentIds when provided', async () => {
      const mockTrigger = {
        triggerStage0Extraction: jest.fn().mockResolvedValue(undefined),
      };
      const mockService = {} as any;
      const controller = new PendingApprovalController(mockService, mockTrigger);

      const req = {
        params: { projectId: 'proj-123' },
        body: { documentIds: ['doc-1', 'doc-2'] },
        user: { userId: 'user-456' },
      } as any;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await controller.manualRetrigger(req, res);

      expect(mockTrigger.triggerStage0Extraction).toHaveBeenCalledWith(
        'proj-123',
        ['doc-1', 'doc-2'],
        expect.anything()
      );
    });
  });

  describe('ProposalService — triggerStage0Extraction with text-only payload', () => {
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
      };
      blobStorage = {
        createSignedDownloadUrl: jest.fn().mockResolvedValue('https://sas.url'),
      };
      service = new ProposalService(proposalRepo, projectRepo, {} as any, blobStorage);
    });

    it('dispatches extraction payload with empty documents array when documentIds is []', async () => {
      const projectId = '507f1f77bcf86cd799439011';
      const find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      const modelSpy = jest.spyOn(mongoose, 'model').mockReturnValue({ find } as any);

      try {
        await service.triggerStage0Extraction(projectId, [], {
          subject: 'Text only email',
          fromAddress: 'sender@firm.com',
          correlationId: 'outlook:corr-789',
        });
      } finally {
        modelSpy.mockRestore();
      }

      expect(proposalRepo.ensureProposalExists).toHaveBeenCalledWith(projectId);
      expect(projectRepo.updateById).toHaveBeenCalledWith(
        projectId,
        // Both halves of the handover: the project is with the AI, and the
        // workspace can show that analysis is running.
        { status: 'WAITING_FOR_INPUTS', analysisStatus: 'PROCESSING' },
      );

      const publisherInstance = (service as any).triggerPublisher;
      expect(publisherInstance.publishExtraction).toHaveBeenCalledWith({
        trigger: 'BEGIN_EXTRACTION',
        jobType: 'PROJECT_EXTRACTION',
        projectId,
        correlationId: 'outlook:corr-789',
        payload: {
          subject: 'Text only email',
          sender: 'sender@firm.com',
          documents: [],
          // Written context rides along with every trigger; empty here because
          // this harness stubs mongoose.model with a documents-only mock.
          context: { triggerSource: null, changeSummary: null, zohoDescription: null, zohoDescriptionAt: null, teamsChatSummaries: [], teamsMeetingSummaries: [], zohoNotes: [], emails: [] },
        },
      });
    });

    // A cached document means "we have already read this file", which is a reason
    // to skip a fresh UPLOAD. It is never a reason to skip a re-trigger, whose
    // whole purpose is to re-read the same files against context that changed.
    const cachedDocs = (projectId: string) => [
      {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013'),
        projectId,
        originalName: 'plan.pdf',
        storageKey: 'documents/plan.pdf',
        cachedAiResultRef: 'cache-ref-1',
      },
    ];

    it('re-triggers even when every document already has a cached AI result', async () => {
      const projectId = '507f1f77bcf86cd799439011';
      const find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(cachedDocs(projectId)) });
      const modelSpy = jest.spyOn(mongoose, 'model').mockReturnValue({ find } as any);

      try {
        await service.triggerStage0Extraction(projectId, [], {
          subject: 'Approved change',
          fromAddress: 'estimator@gfs.com',
          correlationId: 'approval-1',
        });
      } finally {
        modelSpy.mockRestore();
      }

      const publisher = (service as any).triggerPublisher;
      expect(publisher.publishExtraction).toHaveBeenCalledTimes(1);
      expect(publisher.publishExtraction.mock.calls[0][0].payload.documents).toHaveLength(0);
    });

    it('skips the upload path when every document already has a cached AI result', async () => {
      const projectId = '507f1f77bcf86cd799439011';
      const find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(cachedDocs(projectId)) });
      const modelSpy = jest.spyOn(mongoose, 'model').mockReturnValue({ find } as any);

      try {
        await service.triggerStage0Extraction(
          projectId,
          [],
          { correlationId: 'doc-upload-1' },
          { skipIfAllCached: true },
        );
      } finally {
        modelSpy.mockRestore();
      }

      expect((service as any).triggerPublisher.publishExtraction).not.toHaveBeenCalled();
      expect(projectRepo.updateById).not.toHaveBeenCalled();
    });

    it('sends the Zoho notes, Teams messages and mail bodies with the trigger', async () => {
      // The whole point of a re-trigger: the text changed, the drawings did not.
      const projectId = '507f1f77bcf86cd799439011';
      const chain = (rows: any[]) => ({
        find: () => ({
          sort: () => ({ limit: () => ({ select: () => ({ lean: jest.fn().mockResolvedValue(rows) }) }) }),
        }),
      });
      const modelSpy = jest.spyOn(mongoose, 'model').mockImplementation((name: any) => {
        if (name === 'ZohoLead') {
          return {
            findOne: () => ({
              select: () => ({
                lean: jest.fn().mockResolvedValue({
                  description: 'Storefront glazing, 2 openings',
                  notes: [{ content: 'Client wants 50x50 panels', author: 'Dan', createdTime: null }],
                }),
              }),
            }),
          } as any;
        }
        if (name === 'OutlookEmail') {
          return chain([{ subject: 'dimension change', fromAddress: 'a@b.com', bodyText: 'now 50x50', receivedDateTime: null }]) as any;
        }
        if (name === 'TeamsMonitoredChannel') {
          return { find: () => ({ select: () => ({ lean: jest.fn().mockResolvedValue([{ aiChatSummary: { summary: 'Team agreed Series 3000, non-IGU' } }]) }) }) } as any;
        }
        if (name === 'TeamsMeeting') {
          return chain([{ subject: 'stircase glass discussion', aiSummary: { summary: 'Series 2000 suits staircases' } }]) as any;
        }
        return { find: () => ({ lean: jest.fn().mockResolvedValue([]) }) } as any;
      });

      try {
        await service.triggerStage0Extraction(projectId, [], { correlationId: 'approval-2', summary: 'Panels change to 50x50' });
      } finally {
        modelSpy.mockRestore();
      }

      const sent = (service as any).triggerPublisher.publishExtraction.mock.calls[0][0];
      expect(sent.payload.context.changeSummary).toBe('Panels change to 50x50');
      expect(sent.payload.context.zohoDescription).toBe('Storefront glazing, 2 openings');
      expect(sent.payload.context.teamsChatSummaries).toEqual(['Team agreed Series 3000, non-IGU']);
      expect(sent.payload.context.teamsMeetingSummaries[0].summary).toBe('Series 2000 suits staircases');
      expect(sent.payload.context.zohoNotes[0].content).toBe('Client wants 50x50 panels');
      expect(sent.payload.context.emails[0].body).toBe('now 50x50');
    });

    it('still triggers when the context cannot be read', async () => {
      const projectId = '507f1f77bcf86cd799439011';
      const modelSpy = jest.spyOn(mongoose, 'model').mockImplementation((name: any) => {
        if (name === 'Document') return { find: () => ({ lean: jest.fn().mockResolvedValue([]) }) } as any;
        throw new Error('mongo down');
      });

      try {
        await service.triggerStage0Extraction(projectId, [], { correlationId: 'approval-3' });
      } finally {
        modelSpy.mockRestore();
      }

      const sent = (service as any).triggerPublisher.publishExtraction.mock.calls[0][0];
      expect(sent.payload.context).toEqual({ triggerSource: null, changeSummary: null, zohoDescription: null, zohoDescriptionAt: null, teamsChatSummaries: [], teamsMeetingSummaries: [], zohoNotes: [], emails: [] });
    });

    it('limits explicitly selected documents to the current project', async () => {
      const projectId = '507f1f77bcf86cd799439011';
      const documentId = '507f1f77bcf86cd799439013';
      const find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: new mongoose.Types.ObjectId(documentId),
            originalName: 'drawing.pdf',
            blobUrl: 'https://blob.example/drawing.pdf',
          },
        ]),
      });
      const modelSpy = jest.spyOn(mongoose, 'model').mockReturnValue({ find } as any);

      try {
        await service.triggerStage0Extraction(projectId, [documentId], {
          correlationId: 'corr-project-scope',
        });
      } finally {
        modelSpy.mockRestore();
      }

      expect(find).toHaveBeenCalledWith({
        _id: { $in: [new mongoose.Types.ObjectId(documentId)] },
        projectId: new mongoose.Types.ObjectId(projectId),
        isActive: true,
      });
    });
  });
});
