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

/**
 * A Zoho note that supersedes the description ("now 17x17" while the description
 * still says 30 panels) used to be sent alongside it, leaving the AI to arbitrate
 * between two contradicting requirements. These cover the delta that stops that:
 * only the side that actually changed is sent.
 */
describe('Zoho CRM context delta on re-trigger', () => {
  const projectId = '507f1f77bcf86cd799439011';
  const DESCRIPTION_EDITED_AT = new Date('2026-08-14T10:00:00.000Z');

  const note = (noteId: string, content: string, modified: string) => ({
    noteId,
    content,
    author: 'jamunesh sheta',
    createdTime: new Date(modified),
    modifiedTime: new Date(modified),
  });

  const V1_NOTES = [note('n1', 'customer need 10X10 panels', '2026-08-14T09:28:24.000Z')];
  const V2_NOTES = [...V1_NOTES, note('n2', "needed 17'X17' glass panel", '2026-08-14T18:54:03.000Z')];

  let proposalRepo: any;
  let projectRepo: any;
  let blobStorage: any;
  let service: ProposalService;

  /** Stubs every model collectProjectContext touches; only ZohoLead carries data. */
  const withLead = (lead: any) =>
    jest.spyOn(mongoose, 'model').mockImplementation((name: any) => {
      if (name === 'ZohoLead') {
        return { findOne: () => ({ select: () => ({ lean: jest.fn().mockResolvedValue(lead) }) }) } as any;
      }
      if (name === 'TeamsMonitoredChannel') {
        return { find: () => ({ select: () => ({ lean: jest.fn().mockResolvedValue([]) }) }) } as any;
      }
      if (name === 'OutlookEmail' || name === 'TeamsMeeting') {
        return {
          find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: jest.fn().mockResolvedValue([]) }) }) }) }),
        } as any;
      }
      return { find: () => ({ lean: jest.fn().mockResolvedValue([]) }) } as any;
    });

  const trigger = async (lead: any, correlationId: string) => {
    const spy = withLead(lead);
    try {
      await service.triggerStage0Extraction(projectId, [], { correlationId });
    } finally {
      spy.mockRestore();
    }
    return (service as any).triggerPublisher.publishExtraction.mock.calls[0][0].payload.context;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    proposalRepo = { ensureProposalExists: jest.fn().mockResolvedValue(undefined) };
    projectRepo = { updateById: jest.fn().mockResolvedValue(undefined), findById: jest.fn().mockResolvedValue(null) };
    blobStorage = { createSignedDownloadUrl: jest.fn().mockResolvedValue('https://sas.url') };
    service = new ProposalService(proposalRepo, projectRepo, {} as any, blobStorage);
  });

  it('sends the new note and NULLS an unchanged description', async () => {
    // The case that motivated this: the note supersedes the description, so
    // replaying the description would contradict the instruction just approved.
    const context = await trigger(
      {
        description: 'customer needs 30 glass panels',
        notes: V2_NOTES,
        noteHistory: [
          { hash: 'v1', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V1_NOTES },
          { hash: 'v2', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V2_NOTES },
        ],
      },
      `zohoCrmContext:${projectId}:v2`,
    );

    expect(context.zohoNotes).toHaveLength(1);
    expect(context.zohoNotes[0].content).toBe("needed 17'X17' glass panel");
    expect(context.zohoDescription).toBeNull();
    expect(context.zohoDescriptionAt).toBeNull();
  });

  it('sends the new description and NO notes when only the description changed', async () => {
    const context = await trigger(
      {
        description: 'customer needs 40 glass panels',
        notes: V2_NOTES,
        noteHistory: [
          { hash: 'v1', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V2_NOTES },
          { hash: 'v2', description: 'customer needs 40 glass panels', descriptionChangedAt: new Date('2026-08-15T11:00:00.000Z'), notes: V2_NOTES },
        ],
      },
      `zohoCrmContext:${projectId}:v2`,
    );

    expect(context.zohoNotes).toEqual([]);
    expect(context.zohoDescription).toBe('customer needs 40 glass panels');
    expect(context.zohoDescriptionAt).toEqual(new Date('2026-08-15T11:00:00.000Z'));
  });

  it('sends both when both changed in the same snapshot', async () => {
    const context = await trigger(
      {
        description: 'customer needs 40 glass panels',
        notes: V2_NOTES,
        noteHistory: [
          { hash: 'v1', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V1_NOTES },
          { hash: 'v2', description: 'customer needs 40 glass panels', descriptionChangedAt: new Date('2026-08-15T11:00:00.000Z'), notes: V2_NOTES },
        ],
      },
      `zohoCrmContext:${projectId}:v2`,
    );

    expect(context.zohoNotes[0].content).toBe("needed 17'X17' glass panel");
    expect(context.zohoDescription).toBe('customer needs 40 glass panels');
    expect(context.zohoDescriptionAt).toEqual(new Date('2026-08-15T11:00:00.000Z'));
  });

  it('sends both on the first snapshot, where there is nothing to diff against', async () => {
    const context = await trigger(
      {
        description: 'customer needs 30 glass panels',
        notes: V1_NOTES,
        noteHistory: [{ hash: 'v1', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V1_NOTES }],
      },
      `zohoCrmContext:${projectId}:v1`,
    );

    expect(context.zohoNotes[0].content).toBe('customer need 10X10 panels');
    expect(context.zohoDescription).toBe('customer needs 30 glass panels');
    expect(context.zohoDescriptionAt).toEqual(DESCRIPTION_EDITED_AT);
  });

  it('counts an EDIT to existing note text as a note change, not just an added note', async () => {
    const edited = [note('n1', 'customer need 10X10 panels CORRECTED', '2026-08-14T20:00:00.000Z')];
    const context = await trigger(
      {
        description: 'customer needs 30 glass panels',
        notes: edited,
        noteHistory: [
          { hash: 'v1', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V1_NOTES },
          { hash: 'v2', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: edited },
        ],
      },
      `zohoCrmContext:${projectId}:v2`,
    );

    expect(context.zohoNotes[0].content).toBe('customer need 10X10 panels CORRECTED');
    expect(context.zohoDescription).toBeNull();
  });

  it('sends the current state of both for a NON-Zoho trigger, which has no CRM delta', async () => {
    // A document, Teams or manual re-trigger is not a CRM event, so there is no
    // "what changed" to narrow to and the full current picture is correct.
    const context = await trigger(
      {
        description: 'customer needs 30 glass panels',
        notes: V2_NOTES,
        noteHistory: [
          { hash: 'v1', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V1_NOTES },
          { hash: 'v2', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V2_NOTES },
        ],
      },
      'docMove:507f1f77bcf86cd799439013',
    );

    expect(context.zohoNotes[0].content).toBe("needed 17'X17' glass panel");
    expect(context.zohoDescription).toBe('customer needs 30 glass panels');
    expect(context.zohoDescriptionAt).toEqual(DESCRIPTION_EDITED_AT);
  });

  it('never stamps a timestamp on a description that does not exist', async () => {
    // Found by replaying real history: a lead with no description was shipping
    // zohoDescriptionAt anyway, dating text that was never there.
    const context = await trigger(
      {
        description: null,
        notes: V2_NOTES,
        noteHistory: [{ hash: 'v1', description: null, notes: V2_NOTES, capturedAt: DESCRIPTION_EDITED_AT }],
      },
      `zohoCrmContext:${projectId}:v1`,
    );

    expect(context.zohoDescription).toBeNull();
    expect(context.zohoDescriptionAt).toBeNull();
  });

  it('falls back to the current state when the approved snapshot has aged out of history', async () => {
    // Safe direction: it can only ever send too much, never the wrong thing.
    const context = await trigger(
      {
        description: 'customer needs 30 glass panels',
        notes: V2_NOTES,
        noteHistory: [{ hash: 'v9', description: 'customer needs 30 glass panels', descriptionChangedAt: DESCRIPTION_EDITED_AT, notes: V2_NOTES }],
      },
      `zohoCrmContext:${projectId}:hash-long-since-trimmed`,
    );

    expect(context.zohoNotes[0].content).toBe("needed 17'X17' glass panel");
    expect(context.zohoDescription).toBe('customer needs 30 glass panels');
  });
});
