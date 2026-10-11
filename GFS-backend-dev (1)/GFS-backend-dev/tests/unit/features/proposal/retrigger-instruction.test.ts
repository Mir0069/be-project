import {
  ACTIVE_RETRIGGER_TTL_MS,
  buildActiveRetrigger,
  liveRetriggerInstruction,
} from '../../../../src/features/proposal/retrigger-instruction';

const NOW = new Date('2026-09-30T10:00:00Z');

describe('active retrigger instruction', () => {
  it('keeps the approved summary and the full Zoho note', () => {
    const active = buildActiveRetrigger(
      'ZOHO',
      'zohoCrmContext:p:h',
      { changeSummary: 'Zoho was updated. Latest note: "use series..."', zohoNotes: [{ content: 'use series 3000 with igu' }] },
      NOW,
    );
    expect(active).toEqual({
      correlationId: 'zohoCrmContext:p:h',
      source: 'ZOHO',
      instruction: 'Zoho was updated. Latest note: "use series..."\nuse series 3000 with igu',
      startedAt: NOW,
    });
  });

  it('uses only the summary for Teams and email approvals', () => {
    const teams = buildActiveRetrigger('TEAMS', 'teams-1', { changeSummary: 'Team agreed Series 3000', zohoNotes: [{ content: 'older note' }] }, NOW);
    expect(teams?.instruction).toBe('Team agreed Series 3000');
  });

  it('records nothing for document-driven or empty runs', () => {
    expect(buildActiveRetrigger('DROPBOX', 'd-1', { changeSummary: 'new drawing' }, NOW)).toBeNull();
    expect(buildActiveRetrigger('MANUAL', 'm-1', { changeSummary: 'Manual re-trigger' }, NOW)).toBeNull();
    expect(buildActiveRetrigger(undefined, 'x', { changeSummary: 'x' }, NOW)).toBeNull();
    expect(buildActiveRetrigger('ZOHO', 'z', { changeSummary: '  ', zohoNotes: [] }, NOW)).toBeNull();
  });

  it('stops covering AI results after the time limit', () => {
    const active = { correlationId: 'c', source: 'ZOHO', instruction: 'series 3000', startedAt: NOW };
    expect(liveRetriggerInstruction(active, new Date(NOW.getTime() + ACTIVE_RETRIGGER_TTL_MS))).toBe('series 3000');
    expect(liveRetriggerInstruction(active, new Date(NOW.getTime() + ACTIVE_RETRIGGER_TTL_MS + 1))).toBeNull();
    expect(liveRetriggerInstruction(null, NOW)).toBeNull();
  });
});
