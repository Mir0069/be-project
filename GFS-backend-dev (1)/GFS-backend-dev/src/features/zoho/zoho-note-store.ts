import { ZohoLead } from '@db/models/zoho-lead.model';

import type { CrmContextDelta, CrmContextSnapshotRecord, ICrmContextSnapshotStore } from './crm-context.port';
import { latestChangedNote } from './changed-note';

/**
 * Hard ceiling on retained versions. Every version carries the full note set, so
 * an uncapped array would grow the lead document until it hit Mongo's 16MB limit,
 * at which point ALL writes to that lead fail and the Zoho sync stops working.
 * A few hundred edits to one lead is already far beyond anything realistic, so
 * this only ever trims a runaway. Oldest versions are dropped first.
 */
const MAX_HISTORY_VERSIONS = 200;

const toDate = (value: string | null): Date | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms);
};

/**
 * Persists a CRM snapshot onto the Zoho lead, which is where Zoho data already
 * lives and is already indexed by `projectId` for the AI to read.
 *
 *  - `notes` holds the CURRENT set, replaced each time. The field was modelled
 *    long ago but never written, so notes only ever existed live in Zoho.
 *  - `noteHistory` keeps EVERY past state, appended.
 *
 * Both happen in one atomic update, so the current notes and their history can
 * never disagree. The filter makes the write idempotent: a snapshot whose hash
 * is already recorded matches nothing and is a no-op, which matters because a
 * publish that fails before the hash is stored will offer the same snapshot again.
 */
/** Identity of a note set, so an EDIT to existing text counts as a change. */
const notesFingerprint = (notes: Array<{ noteId?: string | null; content?: string | null; modifiedTime?: Date | null }>): string =>
  JSON.stringify((notes ?? []).map((n) => [n?.noteId ?? '', n?.content ?? '', n?.modifiedTime ? new Date(n.modifiedTime).getTime() : 0]));

export class ZohoNoteStore implements ICrmContextSnapshotStore {
  public async save(record: CrmContextSnapshotRecord): Promise<CrmContextDelta> {
    // When the description last actually changed, on Zoho's clock. Read the
    // previous version first: if the text is unchanged we carry its stamp
    // forward, so the value always dates the edit and not the sync that
    // happened to notice it. A note being added never moves Modified_Time, so
    // pairing it with changed text is what makes it the description's own date.
    const lead = await ZohoLead.findOne({ zohoLeadId: record.zohoLeadId })
      .select('modifiedTime noteHistory')
      .lean<{
        modifiedTime?: Date | null;
        noteHistory?: Array<{
          description?: string | null;
          descriptionChangedAt?: Date | null;
          notes?: Array<{ noteId?: string | null; content?: string | null; modifiedTime?: Date | null }>;
        }>;
      } | null>();
    const previous = lead?.noteHistory?.at(-1);
    const descriptionChangedAt =
      !previous || (previous.description ?? null) !== (record.description ?? null)
        ? (lead?.modifiedTime ?? record.capturedAt)
        : (previous.descriptionChangedAt ?? null);

    const notes = record.notes.map((n, index) => ({
      // Zoho always sends an id; the fallback only keeps the sub-document valid
      // if it ever stops, since noteId is required.
      noteId: n.noteId ?? `unknown-${index}`,
      content: n.content,
      author: n.author,
      authorEmail: n.authorEmail,
      createdTime: toDate(n.createdAt),
      modifiedTime: toDate(n.modifiedAt),
    }));

    const notesChanged = !previous || notesFingerprint(previous.notes ?? []) !== notesFingerprint(notes);
    const delta: CrmContextDelta = {
      isFirst: !previous,
      descriptionChanged: !previous || (previous.description ?? null) !== (record.description ?? null),
      notesChanged,
      changedNote: notesChanged ? latestChangedNote(previous?.notes, record.notes) : null,
    };

    await ZohoLead.updateOne(
      { zohoLeadId: record.zohoLeadId, 'noteHistory.hash': { $ne: record.hash } },
      {
        $set: { notes },
        $push: {
          noteHistory: {
            $each: [
              {
                hash: record.hash,
                description: record.description,
                descriptionChangedAt,
                notes,
                capturedAt: record.capturedAt,
              },
            ],
            $slice: -MAX_HISTORY_VERSIONS,
          },
        },
      },
    );

    return delta;
  }
}
