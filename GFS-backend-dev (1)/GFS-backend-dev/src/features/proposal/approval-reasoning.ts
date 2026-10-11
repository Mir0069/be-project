import { ChangeSource } from '@db/models/pending-change-approval.model';

/**
 * A Zoho approval's text is the note or description itself, often a meeting
 * transcript, not reasoning. Shown as Stage 1 reasoning it filled AI Insight
 * with transcript lines and timestamps.
 */
const RAW_TEXT_SOURCES: readonly ChangeSource[] = [ChangeSource.ZOHO];

interface ApprovalFinder {
  findOne(filter: Record<string, unknown>): {
    sort(order: Record<string, 1 | -1>): { lean(): { exec(): Promise<unknown> } };
  };
}

/** Reasoning of the project's newest approval that carries reasoning, if any. */
export async function latestApprovalReasoning(approvals: ApprovalFinder, projectId: string): Promise<string | undefined> {
  const approval = (await approvals
    .findOne({ projectId, source: { $nin: RAW_TEXT_SOURCES } })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as { reasoning?: string } | null;
  return approval?.reasoning || undefined;
}
