// =============================================================================
// PROPOSAL — APPROVE ACTION THAT MARKS THE ZOHO LEAD
// =============================================================================
// The Zoho write itself is covered by zoho-lead-status.service.test.ts. These
// tests cover only the seam: permissions, the draft precondition, and how the
// service result becomes what the page renders.

import { ProposalService } from '../../../../src/features/proposal/proposal.service';
import { DocumentModel } from '../../../../src/db/models/document.model';

jest.mock('../../../../src/db/models/document.model', () => ({
  DocumentModel: { findOne: jest.fn(), find: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  DocumentTypeTag: { QUOTE: 'quote' },
}));

const findOneMock = DocumentModel.findOne as unknown as jest.Mock;
const findMock = DocumentModel.find as unknown as jest.Mock;

const setLatestDocument = (doc: any) =>
  findOneMock.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(doc),
  });

const setDraftList = (docs: any[]) =>
  findMock.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(docs),
  });

const TARGET = 'Quoted need to follow up';
const projectId = '507f1f77bcf86cd799439011';
const estimatorId = '507f1f77bcf86cd799439012';
const otherId = '507f1f77bcf86cd799439013';

const build = (opts?: {
  leadStatus?: string | null;
  zohoLeadId?: string | null;
  result?: any;
  managerApproved?: boolean;
  outputActioned?: boolean;
}) => {
  const project = {
    id: projectId,
    assignedEstimators: [estimatorId],
    zohoLeadId: opts?.zohoLeadId === undefined ? 'lead-1' : opts.zohoLeadId,
    leadStatus: opts?.leadStatus === undefined ? 'Need to Quote' : opts.leadStatus,
  };
  const markQuotedNeedsFollowUp = jest
    .fn()
    .mockResolvedValue(opts?.result ?? { updated: true, status: TARGET });
  const projectRepo = { findById: jest.fn().mockResolvedValue(project), updateById: jest.fn() };
  const stage6Proposal = {
    cells: {},
    status: 'READY_FOR_PROPOSAL_EXCEL',
    ...(opts?.outputActioned === false ? {} : { output_action_at: new Date() }),
  };
  const proposalRepo = {
    getCurrentSchema: jest.fn().mockResolvedValue({
      stage_6_proposal: stage6Proposal,
      stage_7: {
        status: opts?.managerApproved === false ? 'PENDING' : 'APPROVED',
        cost_overrides: {},
      },
      pipeline_status: {
        stage_5_status: 'APPROVED',
        stage_7_status: opts?.managerApproved === false ? 'PENDING' : 'APPROVED',
      },
    }),
    appendVersion: jest.fn().mockResolvedValue({}),
  };

  const service = new ProposalService(
    proposalRepo as any,
    projectRepo as any,
    {} as any,
    {} as any,
    { markQuotedNeedsFollowUp } as any,
  );
  return { service, markQuotedNeedsFollowUp, projectRepo };
};

beforeEach(() => {
  jest.clearAllMocks();
  setLatestDocument({ _id: 'doc-1', originalName: 'proposal.xlsx', createdAt: new Date() });
  setDraftList([]);
});

describe('ProposalService — approveProposalLead permissions', () => {
  it('refuses an estimator who is not assigned to the project', async () => {
    const { service, markQuotedNeedsFollowUp } = build();
    await expect(service.approveProposalLead(projectId, otherId, 'ESTIMATOR')).rejects.toThrow(
      /not authorized/i,
    );
    expect(markQuotedNeedsFollowUp).not.toHaveBeenCalled();
  });

  it('allows the assigned estimator', async () => {
    const { service, markQuotedNeedsFollowUp } = build();
    await service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR');
    expect(markQuotedNeedsFollowUp).toHaveBeenCalledWith(projectId);
  });

  it.each(['SALES_MANAGER', 'SUPER_ADMIN', 'SYSTEM_ADMIN'])(
    'allows %s without an estimator assignment',
    async (role) => {
      const { service, markQuotedNeedsFollowUp } = build();
      await service.approveProposalLead(projectId, otherId, role);
      expect(markQuotedNeedsFollowUp).toHaveBeenCalledTimes(1);
    },
  );
});

describe('ProposalService — approveProposalLead preconditions', () => {
  it('refuses to send before manager approval', async () => {
    const { service, markQuotedNeedsFollowUp } = build({ managerApproved: false });
    await expect(service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).rejects.toThrow(
      /approv/i,
    );
    expect(markQuotedNeedsFollowUp).not.toHaveBeenCalled();
  });

  it('refuses to send before the final output is opened or downloaded', async () => {
    const { service, markQuotedNeedsFollowUp } = build({ outputActioned: false });
    await expect(service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).rejects.toThrow(
      /final output/i,
    );
    expect(markQuotedNeedsFollowUp).not.toHaveBeenCalled();
  });

  // Telling the CRM a customer was quoted with no quote in existence sends sales
  // chasing someone who never received anything.
  it('refuses to approve before any proposal draft exists', async () => {
    setLatestDocument(null);
    const { service, markQuotedNeedsFollowUp } = build();
    await expect(service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).rejects.toThrow(
      /Generate a proposal draft/i,
    );
    expect(markQuotedNeedsFollowUp).not.toHaveBeenCalled();
  });
});

describe('ProposalService — approveProposalLead outcomes', () => {
  it('reports the lead as marked and changed after moving it', async () => {
    const { service } = build();
    expect(await service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).toEqual({
      state: 'ALREADY_MARKED',
      lead_status: TARGET,
      changed: true,
    });
  });

  // The contract behind "never offer the button a second time".
  it('reports changed false when the lead was already at the status', async () => {
    const { service } = build({ result: { updated: false, reason: 'already-set', status: TARGET } });
    expect(await service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).toEqual({
      state: 'ALREADY_MARKED',
      lead_status: TARGET,
      changed: false,
    });
  });

  it('reports CLOSED without claiming to have changed anything', async () => {
    const { service } = build({
      result: { updated: false, reason: 'terminal-status', status: 'Sold' },
    });
    expect(await service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).toEqual({
      state: 'CLOSED',
      lead_status: 'Sold',
      changed: false,
    });
  });

  it('reports NO_LEAD as a normal result rather than an error', async () => {
    const { service } = build({
      zohoLeadId: null,
      result: { updated: false, reason: 'no-zoho-lead' },
    });
    const result = await service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR');
    expect(result.state).toBe('NO_LEAD');
  });

  it('fails loudly when Zoho could not be read', async () => {
    const { service } = build({ result: { updated: false, reason: 'lead-read-failed' } });
    await expect(service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR')).rejects.toThrow(
      /Nothing was changed/i,
    );
  });

  it('does not leak the Zoho endpoint into the error a user sees', async () => {
    const { service, markQuotedNeedsFollowUp } = build();
    markQuotedNeedsFollowUp.mockRejectedValueOnce(
      new Error('Zoho update failed for /crm/v2/Leads/7344067000096547074'),
    );
    await expect(
      service.approveProposalLead(projectId, estimatorId, 'ESTIMATOR'),
    ).rejects.toThrow(expect.objectContaining({ message: expect.not.stringContaining('/crm/v2/') }));
  });
});

describe('ProposalService — getProposal exposes the approval state', () => {
  // Pins the core decision: opening the page must never depend on Zoho.
  it('derives the state from the local mirror without calling Zoho', async () => {
    const { service, markQuotedNeedsFollowUp } = build({ leadStatus: TARGET });
    const result = await service.getProposal(projectId, estimatorId, 'ESTIMATOR');
    expect(result.lead_approval).toEqual({
      state: 'ALREADY_MARKED',
      lead_status: TARGET,
      changed: false,
    });
    expect(markQuotedNeedsFollowUp).not.toHaveBeenCalled();
  });

  it('offers approval when the lead has not been quoted yet', async () => {
    const { service } = build({ leadStatus: 'Need to Quote' });
    const result = await service.getProposal(projectId, estimatorId, 'ESTIMATOR');
    expect(result.lead_approval.state).toBe('AVAILABLE');
  });

  it('still returns the existing proposal payload unchanged', async () => {
    const { service } = build();
    setDraftList([{ _id: 'doc-1' }]);
    const result = await service.getProposal(projectId, estimatorId, 'ESTIMATOR');
    expect(result.stage_6_proposal).toMatchObject({ cells: {} });
    expect(result.latest_document).toMatchObject({ _id: 'doc-1' });
    expect(result.documents).toHaveLength(1);
  });
});
