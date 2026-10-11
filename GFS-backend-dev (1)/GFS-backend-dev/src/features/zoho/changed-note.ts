/**
 * Picks the note a Zoho change is about. Notes are stored oldest first, so the
 * last one is only right when a note was added: editing an older note leaves
 * the newest untouched, and quoting it would send the AI the wrong instruction.
 */

export interface NoteLike {
  noteId?: string | null;
  content?: string | null;
  // Stored notes carry Date stamps, payload notes carry ISO strings.
  modifiedTime?: Date | string | null;
  modifiedAt?: string | null;
  createdTime?: Date | string | null;
  createdAt?: string | null;
}

const stampOf = (note: NoteLike): number => {
  const raw = note.modifiedTime ?? note.modifiedAt ?? note.createdTime ?? note.createdAt ?? null;
  const ms = raw ? new Date(raw).getTime() : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

/** The most recently edited note that is new or changed since `previous`, or null when none changed. */
export function latestChangedNote<T extends NoteLike>(previous: readonly NoteLike[] | null | undefined, current: readonly T[]): T | null {
  const before = new Map<string, string>();
  for (const note of previous ?? []) {
    if (note.noteId) before.set(note.noteId, note.content ?? '');
  }

  let latest: T | null = null;
  for (const note of current) {
    const unchanged = note.noteId != null && before.has(note.noteId) && before.get(note.noteId) === (note.content ?? '');
    if (unchanged) continue;
    // Ties keep the later note, matching the oldest-first storage order.
    if (latest === null || stampOf(note) >= stampOf(latest)) latest = note;
  }
  return latest;
}
