import { ZohoCrmContextService } from '@features/zoho/zoho-crm-context.service';
import type { CrmContextPayload } from '@features/zoho/crm-context.port';
import type { ZohoNote } from '@features/zoho/zoho.service';
import type { IProjectRepository, IDomainProject } from '@repositories/interfaces/i-project.repository';

const NOW = new Date('2026-08-10T09:14:22.118Z');

const makeProject = (o: Partial<IDomainProject> = {}): IDomainProject => ({
  id: 'proj-1',
  referenceNumber: 'GFS-2026-1007',
  projectName: '103 Robin St',
  customerName: 'Jane Doe',
  status: 'SETUP_PENDING' as IDomainProject['status'],
  projectType: 'NEW_ESTIMATE' as IDomainProject['projectType'],
  creationSource: 'ZOHO_FIRST' as IDomainProject['creationSource'],
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
  description: 'Client wants 2 glass floor panels.',
  receivedDate: null,
  address: null,
  assignedEstimators: [],
  lastZohoSyncedAt: null,
  crmContextHash: null,
  crmContextSentAt: null,
  estimatedCost: null,
  totalSqFt: null,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const makeNote = (o: Partial<ZohoNote> = {}): ZohoNote => ({
  id: 'note-1',
  title: 'Site visit',
  content: 'Measured opening at 2400 x 1200.',
  author: 'Mike R.',
  authorEmail: 'mike@gfs.com',
  createdTime: '2026-08-02T10:11:00+05:30',
  // Zoho sets Modified_Time to Created_Time until someone edits the note.
  modifiedTime: '2026-08-02T10:11:00+05:30',
  ...o,
});

const buildDeps = (
  opts: {
    project?: IDomainProject | null;
    notes?: ZohoNote[];
    saveFails?: boolean;
    /** What the snapshot store reports as changed. Defaults to both, which is
     *  what a first snapshot looks like. */
    delta?: { notesChanged: boolean; descriptionChanged: boolean; isFirst: boolean };
    alreadyProcessed?: boolean;
    approvalFails?: boolean;
  } = {},
) => {
  const fetchLeadNotes = jest.fn().mockResolvedValue(opts.notes ?? [makeNote()]);
  const publish = jest.fn().mockResolvedValue(undefined);
  const project = opts.project === undefined ? makeProject() : opts.project;
  const projectRepository = {
    findById: jest.fn().mockResolvedValue(project),
    findByZohoLeadId: jest.fn().mockResolvedValue(project),
    updateById: jest.fn().mockResolvedValue(project),
  } as unknown as jest.Mocked<IProjectRepository>;

  const save = opts.saveFails
    ? jest.fn().mockRejectedValue(new Error('mongo down'))
    : jest.fn().mockResolvedValue(opts.delta ?? { notesChanged: true, descriptionChanged: true, isFirst: true });
  const isSourceProcessed = jest.fn().mockResolvedValue(Boolean(opts.alreadyProcessed));
  const createPendingApproval = opts.approvalFails
    ? jest.fn().mockRejectedValue(new Error('approval blew up'))
    : jest.fn().mockResolvedValue({});

  const svc = new ZohoCrmContextService(
    { fetchLeadNotes },
    projectRepository,
    { publish },
    () => NOW,
    { save },
    { isSourceProcessed, createPendingApproval },
  );
  return { svc, fetchLeadNotes, publish, projectRepository, save, isSourceProcessed, createPendingApproval };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const savedRecord = (save: jest.Mock): any => (save.mock.calls[0] as [any])[0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const approvalInput = (create: jest.Mock): any => (create.mock.calls[0] as [any])[0];

const messageOf = (publish: jest.Mock): CrmContextPayload =>
  (publish.mock.calls[0] as [CrmContextPayload, string])[0];

const dedupKeyOf = (publish: jest.Mock): string =>
  (publish.mock.calls[0] as [CrmContextPayload, string])[1];

describe('ZohoCrmContextService — publishForProject', () => {
  describe('guards — nothing is published', () => {
    it('skips when the project does not exist', async () => {
      const { svc, publish } = buildDeps({ project: null });
      await expect(svc.publishForProject('missing')).resolves.toEqual({
        published: false,
        reason: 'project-not-found',
      });
      expect(publish).not.toHaveBeenCalled();
    });

    it('skips a project with no Zoho lead (mail-first / manual)', async () => {
      const { svc, publish, fetchLeadNotes } = buildDeps({ project: makeProject({ zohoLeadId: null }) });
      await expect(svc.publishForProject('proj-1')).resolves.toEqual({
        published: false,
        reason: 'no-zoho-lead',
      });
      expect(fetchLeadNotes).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('skips when there is neither a description nor a note', async () => {
      const { svc, publish } = buildDeps({ project: makeProject({ description: null }), notes: [] });
      await expect(svc.publishForProject('proj-1')).resolves.toEqual({
        published: false,
        reason: 'empty',
      });
      expect(publish).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only description as empty', async () => {
      const { svc, publish } = buildDeps({ project: makeProject({ description: '   ' }), notes: [] });
      await expect(svc.publishForProject('proj-1')).resolves.toEqual({
        published: false,
        reason: 'empty',
      });
      expect(publish).not.toHaveBeenCalled();
    });

    it('skips when the snapshot hash matches what was last published', async () => {
      const first = buildDeps();
      const sent = await first.svc.publishForProject('proj-1');
      expect(sent.published).toBe(true);

      // Same content, but the project now carries the hash from that publish.
      const again = buildDeps({ project: makeProject({ crmContextHash: sent.hash }) });
      await expect(again.svc.publishForProject('proj-1')).resolves.toMatchObject({
        published: false,
        reason: 'unchanged',
      });
      expect(again.publish).not.toHaveBeenCalled();
    });

    it('publishes again once a note is added to an already-published project', async () => {
      const first = buildDeps();
      const sent = await first.svc.publishForProject('proj-1');

      const changed = buildDeps({
        project: makeProject({ crmContextHash: sent.hash }),
        notes: [makeNote(), makeNote({ id: 'note-2', content: 'Budget confirmed.', createdTime: '2026-08-08T11:20:00+00:00' })],
      });
      await expect(changed.svc.publishForProject('proj-1')).resolves.toMatchObject({ published: true });
      expect(changed.publish).toHaveBeenCalledTimes(1);
    });

    it('publishes again when a note is edited back to the same text, because the edit time moved', async () => {
      const first = buildDeps();
      const sent = await first.svc.publishForProject('proj-1');

      const edited = buildDeps({
        project: makeProject({ crmContextHash: sent.hash }),
        notes: [makeNote({ modifiedTime: '2026-08-14T23:17:06+05:30' })],
      });
      await expect(edited.svc.publishForProject('proj-1')).resolves.toMatchObject({ published: true });
      expect(edited.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('payload shape', () => {
    it('sends trigger, projectId, emittedAt and the description + notes body', async () => {
      const { svc, publish } = buildDeps();
      await svc.publishForProject('proj-1');

      expect(messageOf(publish)).toEqual({
        trigger: 'PROJECT_CRM_CONTEXT',
        projectId: 'proj-1',
        emittedAt: '2026-08-10T09:14:22.118Z',
        payload: {
          description: 'Client wants 2 glass floor panels.',
          notes: [
            {
              content: 'Measured opening at 2400 x 1200.',
              author: 'Mike R.',
              authorEmail: 'mike@gfs.com',
              createdAt: '2026-08-02T04:41:00.000Z',
              modifiedAt: '2026-08-02T04:41:00.000Z',
            },
          ],
        },
      });
    });

    it('dates an edit: modifiedAt is the note\'s own Modified_Time, not its creation time', async () => {
      const { svc, publish } = buildDeps({
        notes: [
          makeNote({
            createdTime: '2026-08-02T10:11:00+05:30',
            modifiedTime: '2026-08-14T23:17:06+05:30',
          }),
        ],
      });
      await svc.publishForProject('proj-1');

      const note = messageOf(publish).payload.notes[0];
      expect(note?.createdAt).toBe('2026-08-02T04:41:00.000Z');
      expect(note?.modifiedAt).toBe('2026-08-14T17:47:06.000Z');
    });

    it('normalises Zoho offset timestamps to UTC', async () => {
      const { svc, publish } = buildDeps({ notes: [makeNote({ createdTime: '2026-08-02T10:11:00+05:30' })] });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.notes[0]?.createdAt).toBe('2026-08-02T04:41:00.000Z');
    });

    it('orders notes oldest first regardless of the order Zoho returned', async () => {
      const { svc, publish } = buildDeps({
        notes: [
          makeNote({ id: 'b', content: 'newer', createdTime: '2026-08-08T11:20:00Z' }),
          makeNote({ id: 'a', content: 'older', createdTime: '2026-08-02T04:41:00Z' }),
        ],
      });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.notes.map((n) => n.content)).toEqual(['older', 'newer']);
    });

    it('keeps a note whose timestamp Zoho omitted, sorted to the front', async () => {
      const { svc, publish } = buildDeps({
        notes: [
          makeNote({ id: 'b', content: 'timed', createdTime: '2026-08-08T11:20:00Z' }),
          makeNote({ id: 'a', content: 'untimed', createdTime: null }),
        ],
      });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.notes).toEqual([
        expect.objectContaining({ content: 'untimed', createdAt: null }),
        expect.objectContaining({ content: 'timed' }),
      ]);
    });

    it('drops notes with no content and keeps the rest', async () => {
      const { svc, publish } = buildDeps({
        notes: [makeNote({ id: 'a', content: null }), makeNote({ id: 'b', content: '  ' }), makeNote({ id: 'c' })],
      });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.notes).toHaveLength(1);
    });

    it('sends a null description rather than an empty string', async () => {
      const { svc, publish } = buildDeps({ project: makeProject({ description: '' }) });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.description).toBeNull();
    });

    it('sends an empty notes array rather than omitting the key', async () => {
      const { svc, publish } = buildDeps({ notes: [] });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.notes).toEqual([]);
    });

    it('sends null for a missing author and author email', async () => {
      const { svc, publish } = buildDeps({ notes: [makeNote({ author: null, authorEmail: null })] });
      await svc.publishForProject('proj-1');
      expect(messageOf(publish).payload.notes[0]).toMatchObject({ author: null, authorEmail: null });
    });

    it('truncates a note that would blow the Service Bus message limit', async () => {
      const { svc, publish } = buildDeps({ notes: [makeNote({ content: 'x'.repeat(9000) })] });
      await svc.publishForProject('proj-1');
      const sent = messageOf(publish).payload.notes[0]?.content ?? '';
      expect(sent).toHaveLength(8000 + '...[truncated]'.length);
      expect(sent.endsWith('...[truncated]')).toBe(true);
    });
  });

  describe('storing the notes for the AI to read', () => {
    it('stores the snapshot BEFORE publishing, so extraction cannot read stale notes', async () => {
      const { svc, save, publish } = buildDeps();
      await svc.publishForProject('proj-1');

      expect(save).toHaveBeenCalledTimes(1);
      const saveOrder = save.mock.invocationCallOrder[0]!;
      const publishOrder = publish.mock.invocationCallOrder[0]!;
      expect(saveOrder).toBeLessThan(publishOrder);
    });

    it('stores the note id, which the published payload deliberately omits', async () => {
      const { svc, save, publish } = buildDeps({ notes: [makeNote({ id: 'note-42' })] });
      await svc.publishForProject('proj-1');

      expect(savedRecord(save).notes[0]).toMatchObject({ noteId: 'note-42' });
      expect(messageOf(publish).payload.notes[0]).not.toHaveProperty('noteId');
    });

    it('stores the same hash, lead and timestamps that were published', async () => {
      const { svc, save } = buildDeps();
      const result = await svc.publishForProject('proj-1');

      expect(savedRecord(save)).toMatchObject({
        projectId: 'proj-1',
        zohoLeadId: 'lead-1',
        hash: result.hash,
        description: 'Client wants 2 glass floor panels.',
        capturedAt: NOW,
      });
      expect(savedRecord(save).notes[0]).toMatchObject({
        createdAt: '2026-08-02T04:41:00.000Z',
        modifiedAt: '2026-08-02T04:41:00.000Z',
      });
    });

    it('stores nothing when the snapshot is unchanged', async () => {
      const first = buildDeps();
      const sent = await first.svc.publishForProject('proj-1');

      const again = buildDeps({ project: makeProject({ crmContextHash: sent.hash }) });
      await again.svc.publishForProject('proj-1');
      expect(again.save).not.toHaveBeenCalled();
    });

    it('still publishes when storing fails, but raises no approval on stale notes', async () => {
      const { svc, publish, createPendingApproval } = buildDeps({ saveFails: true });

      await expect(svc.publishForProject('proj-1')).resolves.toMatchObject({ published: true });
      expect(publish).toHaveBeenCalledTimes(1);
      expect(createPendingApproval).not.toHaveBeenCalled();
    });
  });

  describe('raising the human approval that drives a retrigger', () => {
    it('parks a ZOHO pending approval instead of retriggering on its own', async () => {
      const { svc, createPendingApproval } = buildDeps();
      const result = await svc.publishForProject('proj-1');

      expect(approvalInput(createPendingApproval)).toMatchObject({
        projectId: 'proj-1',
        source: 'ZOHO',
        sourceId: result.hash,
        correlationId: `zohoCrmContext:proj-1:${result.hash}`,
        // Empty means "re-read every active document" when the estimator approves.
        documentIds: [],
        newExtractedData: {},
      });
    });

    it('puts the latest note in the reasoning when the notes are what changed', async () => {
      const { svc, createPendingApproval } = buildDeps({
        delta: { notesChanged: true, descriptionChanged: false, isFirst: false },
        notes: [
          makeNote({ id: 'a', content: 'customer needs 5 panels', createdTime: '2026-08-02T04:41:00Z' }),
          makeNote({ id: 'b', content: 'customer needs 7 panels', createdTime: '2026-08-08T11:20:00Z', author: 'Mike R.' }),
        ],
      });
      await svc.publishForProject('proj-1');

      const { aiReasoning } = approvalInput(createPendingApproval);
      expect(aiReasoning).toContain('customer needs 7 panels');
      expect(aiReasoning).toContain('Mike R.');
    });

    // 379 13th Street, 2026-08-27: the lead had ONE note saying "igu / series
    // 3000" that had not changed in hours, while the description was edited to
    // "no igu / series 2000". The card quoted the note, so the estimator was
    // shown the OPPOSITE instruction as the reason for the change.
    it('quotes the description, not a stale note, when only the description changed', async () => {
      const { svc, createPendingApproval } = buildDeps({
        delta: { notesChanged: false, descriptionChanged: true, isFirst: false },
        notes: [makeNote({ id: 'stale', content: 'customer needs glass with igu with series 3000 frame type' })],
      });
      await svc.publishForProject('proj-1');

      const { aiReasoning } = approvalInput(createPendingApproval);
      expect(aiReasoning).toContain('Client wants 2 glass floor panels.');
      expect(aiReasoning).not.toContain('series 3000');
    });

    it('mentions both when the description and the notes changed together', async () => {
      const { svc, createPendingApproval } = buildDeps({
        delta: { notesChanged: true, descriptionChanged: true, isFirst: false },
        notes: [makeNote({ id: 'n1', content: 'now 7 panels', author: 'Mike R.' })],
      });
      await svc.publishForProject('proj-1');

      const { aiReasoning } = approvalInput(createPendingApproval);
      expect(aiReasoning).toContain('Client wants 2 glass floor panels.');
      expect(aiReasoning).toContain('now 7 panels');
    });

    it('falls back to the description when the change was not a note', async () => {
      const { svc, createPendingApproval } = buildDeps({ notes: [] });
      await svc.publishForProject('proj-1');

      expect(approvalInput(createPendingApproval).aiReasoning).toContain('Client wants 2 glass floor panels.');
    });

    it('does not raise a second approval for a snapshot already handled', async () => {
      const { svc, createPendingApproval } = buildDeps({ alreadyProcessed: true });
      await svc.publishForProject('proj-1');
      expect(createPendingApproval).not.toHaveBeenCalled();
    });

    it('never lets an approval failure break the Zoho sync', async () => {
      const { svc, projectRepository } = buildDeps({ approvalFails: true });

      await expect(svc.publishForProject('proj-1')).resolves.toMatchObject({ published: true });
      expect(projectRepository.updateById).toHaveBeenCalled();
    });
  });

  describe('publish and bookkeeping', () => {
    it('uses the content hash as the dedup key so a re-send is swallowed by the queue', async () => {
      const { svc, publish } = buildDeps();
      const result = await svc.publishForProject('proj-1');
      expect(dedupKeyOf(publish)).toBe(`crm-context:proj-1:${result.hash}`);
    });

    it('records the hash and sent time on the project after a successful publish', async () => {
      const { svc, projectRepository } = buildDeps();
      const result = await svc.publishForProject('proj-1');
      expect(projectRepository.updateById).toHaveBeenCalledWith('proj-1', {
        crmContextHash: result.hash,
        crmContextSentAt: NOW,
      });
    });

    it('leaves the hash untouched when publishing fails, so the next trigger retries', async () => {
      const { svc, publish, projectRepository } = buildDeps();
      publish.mockRejectedValueOnce(new Error('service bus down'));
      await expect(svc.publishForProject('proj-1')).rejects.toThrow('service bus down');
      expect(projectRepository.updateById).not.toHaveBeenCalled();
    });

    it('reads notes from Zoho when the caller supplies none', async () => {
      const { svc, fetchLeadNotes } = buildDeps();
      await svc.publishForProject('proj-1');
      expect(fetchLeadNotes).toHaveBeenCalledWith('lead-1');
    });

    it('uses caller-supplied notes without calling Zoho again', async () => {
      const { svc, fetchLeadNotes, publish } = buildDeps();
      await svc.publishForProject('proj-1', [makeNote({ content: 'handed in' })]);
      expect(fetchLeadNotes).not.toHaveBeenCalled();
      expect(messageOf(publish).payload.notes[0]?.content).toBe('handed in');
    });
  });
});

describe('ZohoCrmContextService — publishForLead', () => {
  it('resolves the project from the lead id and publishes for it', async () => {
    const { svc, publish, projectRepository } = buildDeps();
    await expect(svc.publishForLead('lead-1', [makeNote()])).resolves.toMatchObject({ published: true });
    expect(projectRepository.findByZohoLeadId).toHaveBeenCalledWith('lead-1');
    expect(messageOf(publish).projectId).toBe('proj-1');
  });

  it('does nothing for a lead with no linked project', async () => {
    const { svc, publish } = buildDeps({ project: null });
    await expect(svc.publishForLead('lead-999')).resolves.toEqual({
      published: false,
      reason: 'project-not-found',
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
