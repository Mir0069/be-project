import mongoose from 'mongoose';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { PendingApprovalService } from '../../../../src/features/proposal/pending-approval.service';
import { ApprovalStatus, ChangeSource } from '../../../../src/db/models/pending-change-approval.model';

jest.mock('../../../../src/features/proposal/queues/stage-trigger.publisher', () => {
  const { jest: j } = require('@jest/globals');
  return {
    StageTriggerPublisher: j.fn().mockImplementation(() => ({
      publish: j.fn().mockResolvedValue(undefined),
      publishExtraction: j.fn().mockResolvedValue(undefined),
    })),
  };
});

const PROJECT_ID = '507f1f77bcf86cd799439011';

const doc = (id: string, originalName: string, extra: Record<string, unknown> = {}) => ({
  _id: new mongoose.Types.ObjectId(id),
  originalName,
  storageKey: `documents/${originalName}`,
  documentType: 'other',
  ...extra,
});

describe('Stage 0 document scope and approved instruction', () => {
  let projectRepo: any;
  let service: ProposalService;
  let find: jest.Mock;
  let modelSpy: jest.SpyInstance;

  const stubDocuments = (rows: any[]) => {
    find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) });
    // Only documents are stubbed; the context readers see no other data.
    modelSpy = jest.spyOn(mongoose, 'model').mockImplementation(((name: string) => (name === 'Document' ? { find } : {})) as any);
  };
  const published = () => (service as any).triggerPublisher.publishExtraction.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    projectRepo = { updateById: jest.fn().mockResolvedValue(undefined) };
    service = new ProposalService(
      { ensureProposalExists: jest.fn().mockResolvedValue(undefined) } as any,
      projectRepo,
      {} as any,
      { createSignedDownloadUrl: jest.fn().mockResolvedValue('https://sas.url') } as any,
    );
  });
  afterEach(() => modelSpy?.mockRestore());

  it('sends no documents for an approval that lists none, even when uncached files exist', async () => {
    stubDocuments([doc('507f1f77bcf86cd799439021', 'pending-email.pdf')]);

    await service.triggerStage0Extraction(PROJECT_ID, [], { correlationId: 'zohoCrmContext:p:h', origin: 'ZOHO' }, { documentScope: 'listed' });

    expect(find).not.toHaveBeenCalled();
    expect(published().payload.documents).toEqual([]);
  });

  it('never falls back to every document when the approval lists files that are gone', async () => {
    stubDocuments([]);

    await service.triggerStage0Extraction(PROJECT_ID, ['507f1f77bcf86cd799439022'], { correlationId: 'email-1', origin: 'EMAIL' }, { documentScope: 'listed' });

    expect(find).toHaveBeenCalledTimes(1);
    expect(published().payload.documents).toEqual([]);
  });

  it('keeps the old fallback to every active document for a manual re-run', async () => {
    stubDocuments([doc('507f1f77bcf86cd799439023', 'plan.pdf')]);

    await service.triggerStage0Extraction(PROJECT_ID, [], { correlationId: 'manual-1', origin: 'MANUAL' });

    expect(published().payload.documents.map((d: any) => d.originalName)).toEqual(['plan.pdf']);
  });

  it('never sends generated proposals or spreadsheets to the AI', async () => {
    stubDocuments([
      doc('507f1f77bcf86cd799439024', 'Glass Flooring Systems Proposal #1082.xlsx', { documentType: 'quote' }),
      doc('507f1f77bcf86cd799439025', 'Proposal #1082.pdf', { documentType: 'quote' }),
      doc('507f1f77bcf86cd799439026', 'customer takeoff.xlsx'),
      doc('507f1f77bcf86cd799439027', 'drawings.pdf'),
    ]);

    await service.triggerStage0Extraction(PROJECT_ID, [], { correlationId: 'manual-2' });

    expect(published().payload.documents.map((d: any) => d.originalName)).toEqual(['drawings.pdf']);
  });

  it('records the approved note text before publishing, and tells the AI where the change came from', async () => {
    stubDocuments([]);

    await service.triggerStage0Extraction(
      PROJECT_ID,
      [],
      { correlationId: 'zohoCrmContext:p:h', summary: 'Zoho was updated. Latest note: use series 3000', origin: 'ZOHO' },
      { documentScope: 'listed' },
    );

    const saved = projectRepo.updateById.mock.calls.find(([, fields]: any[]) => 'activeRetrigger' in fields)[1];
    expect(saved.activeRetrigger).toMatchObject({
      correlationId: 'zohoCrmContext:p:h',
      source: 'ZOHO',
      instruction: 'Zoho was updated. Latest note: use series 3000',
    });
    const saveOrder = projectRepo.updateById.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan((service as any).triggerPublisher.publishExtraction.mock.invocationCallOrder[0]);
    expect(published().payload.context.triggerSource).toBe('ZOHO');
  });

  it('clears the approved instruction for a document-driven run', async () => {
    stubDocuments([doc('507f1f77bcf86cd799439028', 'new-drawing.pdf')]);

    await service.triggerStage0Extraction(PROJECT_ID, ['507f1f77bcf86cd799439028'], { correlationId: 'dropbox-1', origin: 'DROPBOX' });

    expect(projectRepo.updateById).toHaveBeenCalledWith(PROJECT_ID, { activeRetrigger: null });
  });
});

describe('PendingApprovalService.approveChange', () => {
  it('passes the approval source and asks for its own documents only', async () => {
    const approval = {
      _id: 'appr-1',
      projectId: PROJECT_ID,
      status: ApprovalStatus.PENDING,
      source: ChangeSource.ZOHO,
      documentIds: [],
      documentNames: [],
      correlationId: 'zohoCrmContext:p:h',
      reasoning: 'Zoho was updated.',
      aiExtractedData: {},
    };
    const repo = {
      findById: jest.fn().mockResolvedValue(approval),
      updateStatus: jest.fn().mockResolvedValue(approval),
      updateProcessingTimestamps: jest.fn().mockResolvedValue(undefined),
    };
    const trigger = { triggerStage0Extraction: jest.fn().mockResolvedValue(undefined) };
    const approvals = new PendingApprovalService(repo as any, {} as any, trigger);

    await approvals.approveChange('appr-1', 'user-1');

    expect(trigger.triggerStage0Extraction).toHaveBeenCalledWith(
      PROJECT_ID,
      [],
      expect.objectContaining({ origin: 'ZOHO', correlationId: 'zohoCrmContext:p:h', summary: 'Zoho was updated.' }),
      { documentScope: 'listed' },
    );
  });
});
