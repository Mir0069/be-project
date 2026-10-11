export enum PipelineTrigger {
  START_RULES_ENGINE      = 'START_RULES_ENGINE',       // fired once, after extraction completes
  STAGE_1_APPROVED_START_2 = 'STAGE_1_APPROVED_START_2',
  STAGE_2_APPROVED_START_3 = 'STAGE_2_APPROVED_START_3',
  STAGE_3_APPROVED_START_4 = 'STAGE_3_APPROVED_START_4',
  STAGE_4_APPROVED_START_5 = 'STAGE_4_APPROVED_START_5',
  STAGE_5_APPROVED_START_6 = "STAGE_5_APPROVED_START_6", // triggers AI Stage 6 for Excel
}

export interface PipelineTriggerPayload {
  readonly trigger: PipelineTrigger;
  readonly projectId: string;
  readonly targetStage: 1 | 2 | 3 | 4 | 5 | 6 | 'EXCEL';
  readonly triggeredAt: string;   // ISO timestamp
  readonly triggeredBy: 'SYSTEM' | 'ESTIMATOR';  // SYSTEM for extraction, ESTIMATOR for approvals
  readonly idempotencyKey: string;
}

export interface ExtractionTriggerPayload {
  readonly trigger: 'BEGIN_EXTRACTION';
  readonly jobType: 'PROJECT_EXTRACTION';
  readonly projectId: string;
  readonly correlationId: string;
  readonly payload: {
    readonly subject: string;
    readonly sender: string;
    readonly documents: Array<{
      documentId: string;
      originalName: string;
      blobUrl: string; // FRESH 60-minute SAS URL
    }>;
    // Everything written about the project that is not a document. A re-trigger
    // is usually caused by text changing (a Zoho note, a Teams summary, a new
    // mail), so without this the AI only ever sees the unchanged drawings.
    // Capped and truncated at source to stay inside the 256 KB Service Bus limit.
    readonly context?: {
      // The lead's own description, which the estimator edits in Zoho and which
      // carries scope changes that never appear as a note.
      // What the estimator just approved, in the AI's own words: the Teams
      // summary, the mail reasoning, the detected Zoho change. This is the
      // single most direct statement of WHY the re-trigger fired.
      readonly changeSummary?: string | null;
      readonly zohoDescription?: string | null;
      // When that description last actually changed, on Zoho's own clock, so it
      // can be ordered against a note's own timestamp. Null when the description
      // is not part of this change, or when it has not moved since before we
      // started recording it.
      readonly zohoDescriptionAt?: Date | null;
      // AI summaries already produced for this project's Teams channels and
      // meetings, so the extraction can see the distilled discussion, not just
      // the raw message log.
      readonly teamsChatSummaries?: string[];
      readonly teamsMeetingSummaries?: Array<{ subject?: string | null; summary: string }>;
      readonly zohoNotes: Array<{ content: string; author?: string | null; at?: Date | null }>;
      // No raw Teams message log: the summaries above ARE those messages,
      // distilled by the AI, so sending both pays twice for the same content.
      readonly emails: Array<{
        subject?: string | null;
        from?: string | null;
        body: string;
        at?: Date | null;
      }>;
    };
  };
}
