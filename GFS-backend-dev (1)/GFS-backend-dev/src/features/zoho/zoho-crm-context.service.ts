import { createHash } from 'node:crypto';

import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

import type {
  CrmContextDelta,
  CrmContextNote,
  CrmContextPayload,
  CrmContextStoredNote,
  ICrmContextApprovalRaiser,
  ICrmContextQueuePublisher,
  ICrmContextSnapshotStore,
  IProjectCrmContextPublisher,
} from './crm-context.port';
import type { ZohoNote, ZohoService } from './zoho.service';

// This service only needs the notes reader off ZohoService. Typing the dependency
// as that narrow slice keeps it trivial to unit-test with a small fake.
export type ZohoNotesApi = Pick<ZohoService, 'fetchLeadNotes'>;

export interface CrmContextResult {
  published: boolean;
  reason?: 'project-not-found' | 'no-zoho-lead' | 'unchanged' | 'empty';
  notes?: number;
  hash?: string;
}


const MAX_NOTE_CHARS = 8000;
const MAX_DESCRIPTION_CHARS = 20000;

// Matches ChangeSource.ZOHO. Kept as a literal so this feature does not have to
// import the pending-approval model just to name its own source.
const ZOHO_CHANGE_SOURCE = 'ZOHO';

const clamp = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}...[truncated]`;

/** Zoho returns offsets like `+05:30`; the contract is UTC `Z`. */
const toUtcIso = (value: string | null): string | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class ZohoCrmContextService implements IProjectCrmContextPublisher {
  public constructor(
    private readonly zoho: ZohoNotesApi,
    private readonly projectRepository: IProjectRepository,
    private readonly queue: ICrmContextQueuePublisher,
    private readonly now: () => Date = () => new Date(),
    // Optional so existing callers and unit tests keep working: without them the
    // service behaves exactly as before, publishing only.
    private readonly snapshots?: ICrmContextSnapshotStore,
    private readonly approvals?: ICrmContextApprovalRaiser,
  ) {}

  /**
   * Publish the project's Zoho description + notes to the AI as a full snapshot.
   *
   * Safe to call on every Zoho sync and every time the Notes tab is opened: the
   * snapshot is hashed and compared with the last one published for the project,
   * so unchanged content costs one Zoho read and no message. That hash is the
   * only reason a stored column is needed — unlike the lead status, "what did we
   * last send the AI" has no external source of truth to read back.
   *
   * Pass `notes` when the caller already has them (the Notes tab just fetched
   * them) to skip the extra Zoho round-trip.
   */
  public async publishForProject(projectId: string, notes?: ZohoNote[]): Promise<CrmContextResult> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) return { published: false, reason: 'project-not-found' };
    if (!project.zohoLeadId) return { published: false, reason: 'no-zoho-lead' };

    const description = blankToNull(project.description);
    const rawNotes = notes ?? (await this.zoho.fetchLeadNotes(project.zohoLeadId));
    const storedNotes = ZohoCrmContextService.toStoredNotes(rawNotes);
    const payloadNotes = ZohoCrmContextService.toPayloadNotes(storedNotes);

    // Nothing to say. Publishing an empty snapshot would only tell the AI to
    // forget context it never had.
    if (!description && payloadNotes.length === 0) return { published: false, reason: 'empty' };

    const body = { description: description ? clamp(description, MAX_DESCRIPTION_CHARS) : null, notes: payloadNotes };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    if (hash === project.crmContextHash) {
      return { published: false, reason: 'unchanged', hash, notes: payloadNotes.length };
    }

    const message: CrmContextPayload = {
      trigger: 'PROJECT_CRM_CONTEXT',
      projectId,
      emittedAt: this.now().toISOString(),
      payload: body,
    };

    // Store BEFORE publishing. The AI reads these notes out of Mongo when the
    // extraction it triggers reaches it, so a message that overtakes the write
    // would have it reading the previous snapshot.
    const stored = await this.store(projectId, project.zohoLeadId, hash, body.description, storedNotes);

    // Publish first, record second. A failed publish must leave the hash alone
    // so the next trigger retries instead of believing the AI already has it.
    await this.queue.publish(message, `crm-context:${projectId}:${hash}`);
    await this.projectRepository.updateById(projectId, {
      crmContextHash: hash,
      crmContextSentAt: this.now(),
    });

    // Only ask for a re-extraction once the notes behind it are safely stored.
    // Approving an approval whose notes were never written would re-run the
    // pipeline against the previous snapshot and look like the AI ignored them.
    if (stored) {
      await this.raiseApproval(projectId, hash, body.description, payloadNotes, stored);
    }

    return { published: true, hash, notes: payloadNotes.length };
  }

  /**
   * Write the snapshot. Returns HOW it differs from the previous one, or null if
   * it did not land: a storage failure must not abort the publish (the AI still
   * gets the context on the queue), but it does suppress the approval, since a
   * re-extraction would read stale notes.
   */
  private async store(
    projectId: string,
    zohoLeadId: string,
    hash: string,
    description: string | null,
    notes: CrmContextStoredNote[],
  ): Promise<CrmContextDelta | null> {
    if (!this.snapshots) return null;
    try {
      return await this.snapshots.save({
        projectId,
        zohoLeadId,
        hash,
        description,
        notes,
        capturedAt: this.now(),
      });
    } catch (err) {
      console.error('[zoho-crm-context] failed to store note snapshot:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Park a human-in-the-loop approval for the changed CRM text, exactly as mail
   * and Teams do. Approving it publishes BEGIN_EXTRACTION through the existing
   * pipeline, which is what actually re-runs the AI.
   *
   * Deliberately never throws: Zoho context is a side effect of a sync, and a
   * failure here must not fail the sync.
   */
  private async raiseApproval(
    projectId: string,
    hash: string,
    description: string | null,
    notes: CrmContextNote[],
    delta: CrmContextDelta,
  ): Promise<void> {
    if (!this.approvals) return;

    try {
      // The hash identifies this exact text, so the same edit can never raise
      // two approvals even if several triggers fire for it.
      if (await this.approvals.isSourceProcessed(hash, ZOHO_CHANGE_SOURCE)) return;

      // Describe what ACTUALLY changed. Quoting the newest note whenever one
      // exists showed the estimator a stale note as the reason for a
      // description edit — on 379 13th Street it read "igu / series 3000" while
      // the description that triggered it said "no igu / series 2000", which is
      // the opposite instruction.
      // The note this change is about: an edit to an older note is not the newest one.
      const latest = delta.changedNote ?? notes.at(-1);
      const noteLine = latest
        ? `Latest note by ${latest.author ?? 'unknown'}: "${clamp(latest.content, 300)}"`
        : null;
      const descriptionLine = description ? `Description: "${clamp(description, 300)}"` : null;

      const parts: string[] = [];
      if (delta.descriptionChanged && descriptionLine) parts.push(descriptionLine);
      if (delta.notesChanged && noteLine) parts.push(noteLine);
      // A first snapshot has nothing to diff against, so show whatever is there.
      if (parts.length === 0) {
        if (delta.isFirst) { if (descriptionLine) parts.push(descriptionLine); if (noteLine) parts.push(noteLine); }
        else parts.push(noteLine ?? descriptionLine ?? 'no readable text');
      }
      const reasoning = `Zoho was updated. ${parts.join(' ')}`;

      await this.approvals.createPendingApproval({
        projectId,
        source: ZOHO_CHANGE_SOURCE,
        sourceId: hash,
        correlationId: `zohoCrmContext:${projectId}:${hash}`,
        // A note is text: approving it re-reads the context and sends no documents.
        documentIds: [],
        documentNames: [],
        // Notes are prose, so there is nothing to diff field by field. The
        // estimator reads the reasoning and decides.
        newExtractedData: {},
        subject: 'Zoho notes or description updated',
        sender: latest?.author ?? 'Zoho',
        aiReasoning: reasoning,
      });
    } catch (err) {
      console.error('[zoho-crm-context] failed to raise pending approval:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Same as `publishForProject`, addressed by Zoho lead id. Used by the Notes tab,
   * which knows the lead but not the project, and which hands over the notes it
   * has just fetched so this costs no extra Zoho call.
   */
  public async publishForLead(zohoLeadId: string, notes?: ZohoNote[]): Promise<CrmContextResult> {
    const project = await this.projectRepository.findByZohoLeadId(zohoLeadId);
    if (!project) return { published: false, reason: 'project-not-found' };
    return this.publishForProject(project.id, notes);
  }

  /**
   * Drop contentless notes, normalise timestamps to UTC, and sort oldest first so
   * the most recent instruction reads last. A note whose timestamp Zoho omitted
   * sorts to the front rather than being dropped: its text is still worth sending.
   *
   * Keeps Zoho's note id, which only the stored copy uses.
   */
  private static toStoredNotes(notes: ZohoNote[]): CrmContextStoredNote[] {
    return notes
      .map((n) => {
        const content = blankToNull(n.content);
        if (!content) return null;
        return {
          noteId: n.id,
          content: clamp(content, MAX_NOTE_CHARS),
          author: blankToNull(n.author),
          authorEmail: blankToNull(n.authorEmail),
          createdAt: toUtcIso(n.createdTime),
          modifiedAt: toUtcIso(n.modifiedTime),
        };
      })
      .filter((n): n is CrmContextStoredNote => n !== null)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  /**
   * The wire shape: the stored notes minus the note id. Kept out of the payload
   * so the published contract (and therefore the hash) does not change.
   */
  private static toPayloadNotes(notes: CrmContextStoredNote[]): CrmContextNote[] {
    return notes.map(({ noteId: _noteId, ...note }) => note);
  }
}
