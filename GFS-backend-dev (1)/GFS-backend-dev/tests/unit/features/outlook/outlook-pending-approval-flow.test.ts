
import { OutlookService } from '@features/outlook/outlook.service';
import { ChangeSource } from '@db/models/pending-change-approval.model';

jest.mock('@db/models/document.model', () => ({
  DocumentModel: {
    find: jest.fn().mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => ({
        lean: jest.fn().mockResolvedValue([{ originalName: 'Doc1.pdf' }]),
      })),
      lean: jest.fn().mockResolvedValue([]),
    })),
    updateMany: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const mockEmail = {
    _id: 'email-id-123',
    subject: 'Change in Panel count for Project 1500 CLINTON',
    fromAddress: 'rahul@client.com',
    internetMessageId: '<msg-123@client.com>',
    attachments: [],
  };
  return {
    ...actual,
    model: jest.fn().mockImplementation((name: string) => {
      if (name === 'User') {
        return {
          find: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      }
      if (name === 'OutlookEmail') {
        return {
          findByIdAndUpdate: jest.fn().mockResolvedValue(mockEmail),
          findById: jest.fn().mockResolvedValue(mockEmail),
        };
      }
      if (name === 'Document') {
        return {
          find: jest.fn().mockImplementation(() => ({
            select: jest.fn().mockImplementation(() => ({
              lean: jest.fn().mockResolvedValue([]),
            })),
            lean: jest.fn().mockResolvedValue([]),
          })),
          updateMany: jest.fn().mockResolvedValue(undefined),
        };
      }
      if (name === 'Project') {
        return {
          findById: jest.fn().mockResolvedValue({ id: 'proj-1500-clinton', assignedEstimators: [] }),
        };
      }
      try {
        return actual.model(name);
      } catch {
        return {
          find: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
      }
    }),
  };
});

describe('OutlookService — PendingApproval Integration', () => {
  let service: OutlookService;
  let mockPendingApprovalService: any;
  let mockProjectRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingApprovalService = {
      isSourceProcessed: jest.fn().mockResolvedValue(false),
      createPendingApproval: jest.fn().mockResolvedValue({ id: 'approval-123' }),
    };

    mockProjectRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'proj-1500-clinton', referenceNumber: 'REF1500' }),
    };

    service = new OutlookService(
      {} as any, // graphClient
      {} as any, // tokenService
      {} as any, // monitoredMailboxRepo
      {} as any, // emailRepo
      {} as any, // associationService
      mockProjectRepo,
      {} as any, // documentPort
      undefined, // blobStorage
      false,     // deleteAfterIngest
      undefined, // cloudLinkService
      undefined, // notificationService
      mockPendingApprovalService // <--- pendingApprovalService parameter
    );
  });

  it('calls pendingApprovalService.createPendingApproval when AI result links email to existing project', async () => {
    const aiPayload = {
      correlationId: 'outlookEmail:email-id-123',
      action: 'LINK',
      projectId: 'proj-1500-clinton',
      proposed: {
        isProject: true,
        summary: 'Change Panel count to 4',
        confidence: 0.95,
      },
    };

    await service.processAiResult(aiPayload);

    expect(mockPendingApprovalService.isSourceProcessed).toHaveBeenCalledWith(
      'email-id-123',
      ChangeSource.EMAIL
    );

    expect(mockPendingApprovalService.createPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1500-clinton',
        source: ChangeSource.EMAIL,
        sourceId: 'email-id-123',
        correlationId: 'outlookEmail:email-id-123',
        documentIds: [],
        subject: 'Change in Panel count for Project 1500 CLINTON',
        sender: 'rahul@client.com',
      })
    );
  });
});
