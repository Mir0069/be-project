import { deriveLeadApproval, ZohoLeadStatusService } from '@features/zoho/zoho-lead-status.service';
import { IGNORED_STATUSES } from '@features/zoho/zoho-sync.service';
import type { IProjectRepository, IDomainProject } from '@repositories/interfaces/i-project.repository';

// Written as a literal on purpose. If the constant in the source is ever reworded
// or re-cased, that is a silent production break (Zoho picklists are exact-match),
// so these assertions must NOT import it.
const TARGET = 'Quoted need to follow up';

const makeProject = (o: Partial<IDomainProject> = {}): IDomainProject => ({
  id: 'proj-1',
  referenceNumber: 'GFS-1',
  projectName: '21 evergreen st',
  customerName: 'Krish',
  status: 'SETUP_PENDING' as IDomainProject['status'],
  projectType: 'NEW_ESTIMATE' as IDomainProject['projectType'],
  creationSource: 'MAIL_FIRST' as IDomainProject['creationSource'],
  identifierHash: null,
  zohoLeadId: 'lead-1',
  jobAddress: null,
  quoteNumber: null,
  leadStatus: null,
  blobStorageURL: null,
  dropboxFolderPath: null,
  customerEmail: null,
  customerPhone: null,
  company: null,
  customerWebsite: null,
  description: null,
  receivedDate: null,
  address: null,
  assignedEstimators: [],
  lastZohoSyncedAt: null,
  estimatedCost: null,
  totalSqFt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const buildDeps = (
  project: IDomainProject | null,
  opts?: { currentStatus?: string | null; readFails?: boolean },
) => {
  const updateInZoho = jest
    .fn()
    .mockResolvedValue({ data: [{ code: 'SUCCESS', details: { id: 'lead-1' } }] });
  const fetchFromZoho = jest.fn().mockImplementation(async (path: string) => {
    if (opts?.readFails) throw new Error('zoho down');
    if (path.startsWith('/crm/v2/Leads/')) {
      return { data: [{ Lead_Status: opts?.currentStatus ?? 'Need to Quote' }] };
    }
    return {};
  });
  const projectRepository = {
    findById: jest.fn().mockResolvedValue(project),
    updateById: jest.fn().mockResolvedValue(project),
  } as unknown as jest.Mocked<IProjectRepository>;
  const svc = new ZohoLeadStatusService({ fetchFromZoho, updateInZoho }, projectRepository);
  return { svc, updateInZoho, fetchFromZoho, projectRepository };
};

const bodyOf = (updateInZoho: jest.Mock) =>
  (updateInZoho.mock.calls[0] as [string, { data: Array<Record<string, unknown>> }])[1];

describe('ZohoLeadStatusService — markQuotedNeedsFollowUp', () => {
  describe('guards — never writes to Zoho', () => {
    it('skips when the project does not exist', async () => {
      const { svc, updateInZoho } = buildDeps(null);
      expect(await svc.markQuotedNeedsFollowUp('proj-1')).toEqual({
        updated: false,
        reason: 'project-not-found',
      });
      expect(updateInZoho).not.toHaveBeenCalled();
    });

    it('skips when the project has no linked Zoho lead', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject({ zohoLeadId: null }));
      expect(await svc.markQuotedNeedsFollowUp('proj-1')).toEqual({
        updated: false,
        reason: 'no-zoho-lead',
      });
      expect(updateInZoho).not.toHaveBeenCalled();
    });

    it('is idempotent: skips when the lead is already at the target status', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus: TARGET });
      expect(await svc.markQuotedNeedsFollowUp('proj-1')).toEqual({
        updated: false,
        reason: 'already-set',
        status: TARGET,
      });
      expect(updateInZoho).not.toHaveBeenCalled();
    });

    // A second proposal generation must not issue a redundant write just because
    // Zoho echoed the status back with different casing or padding.
    it.each([
      ['lowercased', 'quoted need to follow up'],
      ['uppercased', 'QUOTED NEED TO FOLLOW UP'],
      ['padded', '  Quoted need to follow up  '],
    ])('treats the target status as already-set when %s', async (_label, stored) => {
      const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus: stored });
      expect((await svc.markQuotedNeedsFollowUp('proj-1')).reason).toBe('already-set');
      expect(updateInZoho).not.toHaveBeenCalled();
    });

    // Driven off the shared set so adding a status there extends this automatically.
    it.each([...IGNORED_STATUSES])(
      'never regresses a lead that has moved on to "%s"',
      async (terminal) => {
        const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus: terminal });
        expect((await svc.markQuotedNeedsFollowUp('proj-1')).reason).toBe('terminal-status');
        expect(updateInZoho).not.toHaveBeenCalled();
      },
    );

    it('matches terminal statuses regardless of the casing Zoho returns', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus: 'SOLD' });
      expect((await svc.markQuotedNeedsFollowUp('proj-1')).reason).toBe('terminal-status');
      expect(updateInZoho).not.toHaveBeenCalled();
    });

    it('does not write blind when the lead status cannot be read', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject(), { readFails: true });
      expect(await svc.markQuotedNeedsFollowUp('proj-1')).toEqual({
        updated: false,
        reason: 'lead-read-failed',
      });
      expect(updateInZoho).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('moves a Need to Quote lead to the follow-up status', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus: 'Need to Quote' });

      expect(await svc.markQuotedNeedsFollowUp('proj-1')).toEqual({
        updated: true,
        status: TARGET,
      });

      expect(updateInZoho).toHaveBeenCalledTimes(1);
      const [path] = updateInZoho.mock.calls[0] as [string, unknown];
      expect(path).toBe('/crm/v2/Leads/lead-1');
      expect(bodyOf(updateInZoho)).toEqual({
        data: [{ id: 'lead-1', Lead_Status: TARGET }],
      });
    });

    it.each(['Open', 'Contacted Sent Info / Pricing Not Needed'])(
      'updates a lead sitting at the non-terminal status "%s"',
      async (currentStatus) => {
        const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus });
        expect((await svc.markQuotedNeedsFollowUp('proj-1')).updated).toBe(true);
        expect(updateInZoho).toHaveBeenCalledTimes(1);
      },
    );

    it('updates a lead whose status is empty', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject(), { currentStatus: null });
      expect((await svc.markQuotedNeedsFollowUp('proj-1')).updated).toBe(true);
      expect(updateInZoho).toHaveBeenCalledTimes(1);
    });

    // A Zoho update writes every field it is handed, so anything extra in this
    // payload would silently clobber real data on the lead.
    it('sends only the id and Lead_Status, never any other lead field', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject());
      await svc.markQuotedNeedsFollowUp('proj-1');
      const record = bodyOf(updateInZoho).data[0]!;
      expect(Object.keys(record).sort()).toEqual(['Lead_Status', 'id']);
    });

    it('reads the lead with a narrow field selection rather than the whole record', async () => {
      const { svc, fetchFromZoho } = buildDeps(makeProject());
      await svc.markQuotedNeedsFollowUp('proj-1');
      expect(fetchFromZoho).toHaveBeenCalledWith('/crm/v2/Leads/lead-1', {
        fields: 'Lead_Status',
      });
    });

    // The router's listener owns error handling; the service must not hide failures.
    it('surfaces a Zoho write failure to the caller', async () => {
      const { svc, updateInZoho } = buildDeps(makeProject());
      updateInZoho.mockRejectedValueOnce(new Error('Zoho update failed for /crm/v2/Leads/lead-1'));
      await expect(svc.markQuotedNeedsFollowUp('proj-1')).rejects.toThrow('Zoho update failed');
    });
  });
});

describe('ZohoLeadStatusService — local mirror write-through', () => {
  it('mirrors the new status onto the project after a successful Zoho write', async () => {
    const { svc, projectRepository } = buildDeps(makeProject({ leadStatus: 'Need to Quote' }));
    await svc.markQuotedNeedsFollowUp('proj-1');
    expect(projectRepository.updateById).toHaveBeenCalledTimes(1);
    expect(projectRepository.updateById).toHaveBeenCalledWith('proj-1', { leadStatus: TARGET });
  });

  // Someone moved the lead in Zoho by hand: no write is owed, but our copy is wrong.
  it('heals a stale mirror when the lead was already moved in Zoho', async () => {
    const { svc, projectRepository, updateInZoho } = buildDeps(
      makeProject({ leadStatus: 'Need to Quote' }),
      { currentStatus: TARGET },
    );
    const result = await svc.markQuotedNeedsFollowUp('proj-1');
    expect(result).toEqual({ updated: false, reason: 'already-set', status: TARGET });
    expect(updateInZoho).not.toHaveBeenCalled();
    expect(projectRepository.updateById).toHaveBeenCalledWith('proj-1', { leadStatus: TARGET });
  });

  it('does not touch the mirror when the Zoho write fails', async () => {
    const { svc, projectRepository, updateInZoho } = buildDeps(makeProject({ leadStatus: 'Need to Quote' }));
    updateInZoho.mockRejectedValueOnce(new Error('Zoho update failed'));
    await expect(svc.markQuotedNeedsFollowUp('proj-1')).rejects.toThrow('Zoho update failed');
    expect(projectRepository.updateById).not.toHaveBeenCalled();
  });

  it('does not rewrite a mirror that already matches', async () => {
    const { svc, projectRepository } = buildDeps(makeProject({ leadStatus: TARGET }), {
      currentStatus: TARGET,
    });
    await svc.markQuotedNeedsFollowUp('proj-1');
    expect(projectRepository.updateById).not.toHaveBeenCalled();
  });

  it('mirrors the real status when the lead has reached a terminal one', async () => {
    const { svc, projectRepository } = buildDeps(makeProject({ leadStatus: 'Need to Quote' }), {
      currentStatus: 'Sold',
    });
    const result = await svc.markQuotedNeedsFollowUp('proj-1');
    expect(result.reason).toBe('terminal-status');
    expect(projectRepository.updateById).toHaveBeenCalledWith('proj-1', { leadStatus: 'Sold' });
  });

  it('never writes the mirror when the lead status could not be read', async () => {
    const { svc, projectRepository } = buildDeps(makeProject(), { readFails: true });
    expect((await svc.markQuotedNeedsFollowUp('proj-1')).reason).toBe('lead-read-failed');
    expect(projectRepository.updateById).not.toHaveBeenCalled();
  });

  // Zoho is the source of truth; a failed local copy must not be reported as failure.
  it('still reports success when only the mirror write fails', async () => {
    const { svc, projectRepository } = buildDeps(makeProject({ leadStatus: 'Need to Quote' }));
    (projectRepository.updateById as jest.Mock).mockRejectedValueOnce(new Error('mongo down'));
    expect(await svc.markQuotedNeedsFollowUp('proj-1')).toEqual({ updated: true, status: TARGET });
  });
});

describe('deriveLeadApproval', () => {
  const derive = (leadStatus: string | null, zohoLeadId: string | null = 'lead-1') =>
    deriveLeadApproval({ zohoLeadId, leadStatus } as IDomainProject);

  it('offers approval for a lead that has not been quoted yet', () => {
    expect(derive('Need to Quote')).toEqual({
      state: 'AVAILABLE',
      lead_status: 'Need to Quote',
      changed: false,
    });
  });

  it('reports ALREADY_MARKED once the lead is at the target status', () => {
    expect(derive(TARGET)).toEqual({ state: 'ALREADY_MARKED', lead_status: TARGET, changed: false });
  });

  it.each(['quoted need to follow up', 'QUOTED NEED TO FOLLOW UP', '  Quoted need to follow up  '])(
    'matches the target regardless of how it is cased or padded: %s',
    (stored) => {
      expect(derive(stored).state).toBe('ALREADY_MARKED');
    },
  );

  // Data-driven: extending IGNORED_STATUSES extends this test automatically.
  it.each([...IGNORED_STATUSES])('reports CLOSED for the terminal status %s', (status) => {
    expect(derive(status).state).toBe('CLOSED');
  });

  it('names the real status when the lead is closed, so the UI can show it', () => {
    expect(derive('Sold')).toEqual({ state: 'CLOSED', lead_status: 'Sold', changed: false });
  });

  it('reports NO_LEAD when the project has no linked Zoho lead', () => {
    expect(derive('Need to Quote', null)).toEqual({
      state: 'NO_LEAD',
      lead_status: null,
      changed: false,
    });
  });

  it('reports NO_LEAD for a missing project rather than throwing', () => {
    expect(deriveLeadApproval(null).state).toBe('NO_LEAD');
  });
});
