// =============================================================================
// PROPOSAL DOCUMENT — CELLS + PERSISTENCE
// =============================================================================

import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { DocumentModel } from '../../../../src/db/models/document.model';

jest.mock('../../../../src/db/models/document.model', () => ({
  DocumentModel: {
    findOne: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  DocumentTypeTag: {
    QUOTE: 'quote',
  },
}));

const findOneMock = DocumentModel.findOne as unknown as jest.Mock;
const findMock = DocumentModel.find as unknown as jest.Mock;

const setLatestDocument = (doc: any) => {
  findOneMock.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(doc),
  });
};

const setDraftList = (docs: any[]) => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(docs),
  };
  findMock.mockReturnValue(chain);
};

const projectId = '507f1f77bcf86cd799439011';
const estimatorId = '507f1f77bcf86cd799439012';

const buildProposalRepo = () => ({
  ensureProposalExists: jest.fn(),
  getCurrentSchema: jest.fn(),
  appendVersion: jest.fn(),
});

const buildProjectRepo = () => ({
  findById: jest.fn().mockResolvedValue({ assignedEstimators: [estimatorId] }),
  updateById: jest.fn().mockResolvedValue({ status: 'READY_FOR_ESTIMATOR' }),
});

const buildBlobStorage = () => ({
  put: jest.fn().mockResolvedValue({
    storageKey: 'projects/test/proposals/file.xlsx',
    blobUrl: 'https://blob/file.xlsx',
  }),
  createSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed-url'),
  download: jest.fn(),
});

const buildService = (proposalRepo: any, projectRepo: any, blobStorage: any) =>
  new ProposalService(proposalRepo, projectRepo, { recalculate: jest.fn() } as any, blobStorage);

describe('ProposalService — proposal document cells', () => {
  let proposalRepo: any;
  let blobStorage: ReturnType<typeof buildBlobStorage>;
  let service: ProposalService;

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = buildProposalRepo();
    proposalRepo.getCurrentSchema.mockResolvedValue({ pipeline_status: { stage_7_status: 'APPROVED' } });
    blobStorage = buildBlobStorage();
    service = buildService(proposalRepo, buildProjectRepo(), blobStorage);
  });

  it('updateProposalCells merges cells and versions with ESTIMATOR source', async () => {
    const schema = createEmptySchema();
    schema.stage_6_proposal = {
      target_sheet: 'Proposal',
      cells: { B16: 'existing' },
      status: 'READY_FOR_PROPOSAL_EXCEL',
    };
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);

    const result = await service.updateProposalCells(projectId, estimatorId, {
      cells: { B17: 'step 1' },
    });

    expect(result.status).toBe('ACCEPTED');
    expect(result.target_sheet).toBe('Proposal');

    const versionArgs = proposalRepo.appendVersion.mock.calls[0][0];
    expect(versionArgs.source).toBe('ESTIMATOR');
    expect(versionArgs.versionKey).toBe('stage_6_proposal');
    expect(versionArgs.nextSchema.stage_6_proposal.cells).toEqual({
      B16: 'existing',
      B17: 'step 1',
    });
  });

  it('getProposal returns stage_6_proposal, latest document and drafts list', async () => {
    const schema = createEmptySchema();
    schema.stage_6_proposal = {
      target_sheet: 'Proposal',
      cells: { B16: 'intro' },
      status: 'READY_FOR_PROPOSAL_EXCEL',
    };
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    setLatestDocument({ _id: 'doc-1', originalName: 'proposal.xlsx' });
    setDraftList([{ _id: 'doc-2' }, { _id: 'doc-1' }]);

    const result = await service.getProposal(projectId, estimatorId);

    expect(result.stage_6_proposal?.cells).toEqual({ B16: 'intro' });
    expect(result.latest_document).toEqual({ _id: 'doc-1', originalName: 'proposal.xlsx' });
    expect(result.documents).toHaveLength(2);
  });

  it('projects generated documents into quotation history without changing proposal state', async () => {
    const schema = createEmptySchema();
    schema.stage_6_proposal = {
      target_sheet: 'Proposal',
      cells: {},
      status: 'READY_FOR_PROPOSAL_EXCEL',
      output_action_at: new Date('2026-09-24T10:05:00.000Z'),
      sent_at: new Date('2026-09-24T10:10:00.000Z'),
    };
    schema.stage_7 = {
      status: 'APPROVED',
      cost_overrides: {},
      approval: { approvedAt: new Date('2026-09-24T10:00:00.000Z') },
    } as any;
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    const latest = {
      _id: 'doc-latest',
      originalName: 'Proposal #20260924A.xlsx',
      uploadedAt: new Date('2026-09-24T09:55:00.000Z'),
      uploadedBy: estimatorId,
      metadata: { quoteNumber: '20260924A', finalPrice: 7826.29 },
    };
    setLatestDocument(latest);
    setDraftList([latest, {
      _id: 'doc-old', originalName: 'Proposal #20260924.xlsx', uploadedAt: new Date('2026-09-23T09:55:00.000Z'), uploadedBy: estimatorId,
    }]);

    const result = await service.getProposal(projectId, estimatorId);

    expect(result.quotation_history).toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: 'doc-latest', quoteNumber: '20260924A', amount: 7826.29, status: 'SENT', isCurrent: true }),
      expect.objectContaining({ documentId: 'doc-old', status: 'SUPERSEDED', isCurrent: false }),
    ]));
    expect(proposalRepo.appendVersion).not.toHaveBeenCalled();
  });

  it('getProposalDocumentFile streams the stored workbook for a draft', async () => {
    setLatestDocument({
      _id: 'doc-9',
      storageKey: 'key9',
      originalName: 'old.xlsx',
    });
    blobStorage.download.mockResolvedValue({
      stream: (async function* () {
        yield Buffer.from('abc');
      })(),
    });

    const { buffer, fileName } = await service.getProposalDocumentFile(
      projectId,
      estimatorId,
      undefined,
      'doc-9'
    );

    expect(fileName).toBe('old.xlsx');
    expect(buffer.toString()).toBe('abc');
  });

  it('getProposalDocumentFile throws when the document is missing', async () => {
    setLatestDocument(null);

    await expect(
      service.getProposalDocumentFile(projectId, estimatorId, undefined, 'missing')
    ).rejects.toThrow('Proposal document not found');
  });

  it('getLatestProposalDownload throws when no document exists', async () => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_7_status = 'APPROVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    setLatestDocument(null);

    await expect(service.getLatestProposalDownload(projectId, estimatorId)).rejects.toThrow(
      'No generated proposal found'
    );
  });

  it('getLatestProposalDownload returns signed URL when document exists', async () => {
    const schema = createEmptySchema();
    schema.pipeline_status.stage_7_status = 'APPROVED';
    proposalRepo.getCurrentSchema.mockResolvedValue(schema);
    const doc = { _id: 'doc-1', storageKey: 'key', originalName: 'proposal.xlsx', createdAt: new Date() };
    setLatestDocument(doc);

    const result = await service.getLatestProposalDownload(projectId, estimatorId);

    expect(result.document).toEqual(doc);
    expect(result.download_url).toBe('https://signed-url');
  });
});
