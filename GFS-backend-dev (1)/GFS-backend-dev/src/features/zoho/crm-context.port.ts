import type { ZohoNote } from './zoho.service';

/** One Zoho note as the AI receives it. */
export interface CrmContextNote {
  content: string;
  author: string | null;
  authorEmail: string | null;
  createdAt: string | null; // ISO-8601, UTC. Null only if Zoho sent no timestamp.
  // When the note was last edited, ISO-8601 UTC. Equal to createdAt for a note
  // nobody has touched since writing it, so `modifiedAt > createdAt` is what
  // marks an edit and dates it exactly.
  modifiedAt: string | null;
}


export interface CrmContextPayload {
  trigger: 'PROJECT_CRM_CONTEXT';
  projectId: string;
  emittedAt: string; // ISO-8601, UTC
  payload: {
    description: string | null;
    notes: CrmContextNote[];
  };
}

/** Publishes one CRM-context snapshot. Implemented by the Service Bus publisher. */
export interface ICrmContextQueuePublisher {
  publish(payload: CrmContextPayload, deduplicationKey: string): Promise<void>;
}

/**
 * A note as stored. Same shape the AI receives, plus Zoho's own note id, which
 * the payload deliberately omits but the stored copy needs so a note can be
 * followed across versions.
 */
export interface CrmContextStoredNote extends CrmContextNote {
  noteId: string | null;
}

/** One changed snapshot, as persisted for history and for the AI to read. */
export interface CrmContextSnapshotRecord {
  projectId: string;
  zohoLeadId: string;
  hash: string;
  description: string | null;
  notes: CrmContextStoredNote[];
  capturedAt: Date;
}

/**
 * How a snapshot differs from the one before it. Notes and the description are
 * sent to the AI as a delta rather than a full snapshot, so an unchanged
 * description is never replayed alongside a new note that contradicts it.
 */
export interface CrmContextDelta {
  notesChanged: boolean;
  descriptionChanged: boolean;
  /** No earlier snapshot exists, so everything is new and all of it is sent. */
  isFirst: boolean;
  /** The note this snapshot added or edited, when notes changed; not always the newest. */
  changedNote?: CrmContextStoredNote | null;
}

/**
 * Appends snapshots to the note history. Kept as a port so the service stays
 * unit-testable without Mongo. Implementations MUST be idempotent on
 * (projectId, hash): the same snapshot may be offered twice if a publish fails
 * before the hash is recorded.
 */
export interface ICrmContextSnapshotStore {
  /**
   * Persists the snapshot and reports how it differs from the previous one.
   * The delta is returned rather than recomputed by the caller because this is
   * the only place that already holds the previous version.
   */
  save(record: CrmContextSnapshotRecord): Promise<CrmContextDelta>;
}

/**
 * Raises the human-in-the-loop approval for a CRM change. Narrowed to the two
 * methods this feature needs so the Zoho side does not depend on the whole
 * pending-approval service.
 */
export interface ICrmContextApprovalRaiser {
  isSourceProcessed(sourceId: string, source: string): Promise<boolean>;
  createPendingApproval(input: {
    projectId: string;
    source: string;
    sourceId: string;
    correlationId: string;
    documentIds: string[];
    documentNames: string[];
    newExtractedData: unknown;
    subject?: string;
    sender?: string;
    aiReasoning?: string;
  }): Promise<unknown>;
}

/**
 * What the sync service and the controller call. Kept as a port so neither has to
 * know about queues, and so both can be unit-tested without one.
 */
export interface IProjectCrmContextPublisher {
  /** Publish the project's Zoho description + notes, if they changed since last time. */
  publishForProject(projectId: string, notes?: ZohoNote[]): Promise<unknown>;
  /** Same, addressed by Zoho lead id. No-op when no project is linked to the lead. */
  publishForLead(zohoLeadId: string, notes?: ZohoNote[]): Promise<unknown>;
}
