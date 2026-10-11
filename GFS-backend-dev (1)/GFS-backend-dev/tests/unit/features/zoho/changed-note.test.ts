import { latestChangedNote } from '../../../../src/features/zoho/changed-note';

const note = (noteId: string, content: string, modifiedAt: string) => ({ noteId, content, createdAt: '2026-09-01T00:00:00Z', modifiedAt });

describe('latestChangedNote', () => {
  const previous = [
    { noteId: 'n1', content: 'use series 2000', modifiedTime: new Date('2026-09-01T00:00:00Z') },
    { noteId: 'n2', content: 'panels 3x3', modifiedTime: new Date('2026-09-02T00:00:00Z') },
  ];

  it('returns a newly added note', () => {
    const current = [note('n1', 'use series 2000', '2026-09-01T00:00:00Z'), note('n2', 'panels 3x3', '2026-09-02T00:00:00Z'), note('n3', 'add IGU', '2026-09-03T00:00:00Z')];
    expect(latestChangedNote(previous, current)?.noteId).toBe('n3');
  });

  it('returns an edited older note instead of the newest one', () => {
    const current = [note('n1', 'use series 3000', '2026-09-05T00:00:00Z'), note('n2', 'panels 3x3', '2026-09-02T00:00:00Z')];
    expect(latestChangedNote(previous, current)?.content).toBe('use series 3000');
  });

  it('returns null when nothing changed and the newest note on a first snapshot', () => {
    const current = [note('n1', 'use series 2000', '2026-09-01T00:00:00Z'), note('n2', 'panels 3x3', '2026-09-02T00:00:00Z')];
    expect(latestChangedNote(previous, current)).toBeNull();
    expect(latestChangedNote(undefined, current)?.noteId).toBe('n2');
  });
});
