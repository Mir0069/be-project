import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';

import { IGNORED_STATUSES } from './zoho-sync.service';
import type { ZohoService } from './zoho.service';

/**
 * The Zoho Lead Status a project's lead moves to once its proposal has been
 * generated and approved.
 *
 * Zoho's Lead_Status is a picklist: the API rejects anything that is not an exact
 * match for an existing option, so this string is copied verbatim from the Zoho
 * dropdown and must never be reworded or re-cased. `src/scripts/zoho-lead-status-check.ts`
 * verifies it still matches the live picklist.
 */
export const QUOTED_NEEDS_FOLLOW_UP = 'Quoted need to follow up';

// This service only needs Zoho's generic read/write helpers. Typing the dependency
// as this narrow slice keeps it trivial to unit-test with a small fake.
export type ZohoApi = Pick<ZohoService, 'fetchFromZoho' | 'updateInZoho'>;

export interface LeadStatusResult {
  updated: boolean;
  status?: string;
  reason?:
    | 'project-not-found'
    | 'no-zoho-lead'
    | 'already-set'
    | 'terminal-status'
    | 'lead-read-failed';
}

/** What the proposal page may offer for this project's lead. */
export type LeadApprovalState = 'AVAILABLE' | 'ALREADY_MARKED' | 'CLOSED' | 'NO_LEAD';

export interface LeadApproval {
  state: LeadApprovalState;
  lead_status: string | null;
  /** True only when the call that produced this actually moved the lead. */
  changed: boolean;
}

const normalise = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * Derived from our locally synced mirror, never a live Zoho read, so opening the
 * proposal page never depends on Zoho being reachable. A stale mirror is safe:
 * markQuotedNeedsFollowUp re-reads Zoho before it writes and no-ops if the lead
 * is already there.
 */
export const deriveLeadApproval = (
  project: Pick<IDomainProject, 'zohoLeadId' | 'leadStatus'> | null | undefined,
): LeadApproval => {
  if (!project?.zohoLeadId) return { state: 'NO_LEAD', lead_status: null, changed: false };

  const current = normalise(project.leadStatus);
  if (current === normalise(QUOTED_NEEDS_FOLLOW_UP)) {
    return { state: 'ALREADY_MARKED', lead_status: QUOTED_NEEDS_FOLLOW_UP, changed: false };
  }
  if (IGNORED_STATUSES.has(current)) {
    return { state: 'CLOSED', lead_status: project.leadStatus ?? null, changed: false };
  }
  return { state: 'AVAILABLE', lead_status: project.leadStatus ?? null, changed: false };
};

export class ZohoLeadStatusService {
  public constructor(
    private readonly zoho: ZohoApi,
    private readonly projectRepository: IProjectRepository,
  ) {}

  /**
   * Move the project's Zoho lead to "Quoted need to follow up".
   *
   * Called once per project when the proposal is generated and approved. Safe to
   * call again: it reads the lead's current status first and no-ops when the lead
   * is already there, which is why this needs no idempotency column on the project.
   *
   * It also refuses to move a lead backwards. If the lead has already reached a
   * terminal status (sold, completed, dead, ...), a late proposal event must not
   * drag it back into the quoting stage.
   */
  public async markQuotedNeedsFollowUp(projectId: string): Promise<LeadStatusResult> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) return { updated: false, reason: 'project-not-found' };
    if (!project.zohoLeadId) return { updated: false, reason: 'no-zoho-lead' };

    const currentStatus = await this.fetchLeadStatus(project.zohoLeadId);
    // Reading failed: skip rather than write blind, so we can't clobber a status
    // we were never able to see.
    if (currentStatus === undefined) return { updated: false, reason: 'lead-read-failed' };

    const current = normalise(currentStatus);
    if (current === normalise(QUOTED_NEEDS_FOLLOW_UP)) {
      // Someone set it in Zoho directly; heal our mirror so the UI agrees.
      await this.mirrorLeadStatus(projectId, project.leadStatus, QUOTED_NEEDS_FOLLOW_UP);
      return { updated: false, reason: 'already-set', status: QUOTED_NEEDS_FOLLOW_UP };
    }
    if (IGNORED_STATUSES.has(current)) {
      await this.mirrorLeadStatus(projectId, project.leadStatus, currentStatus ?? null);
      return { updated: false, reason: 'terminal-status', status: currentStatus ?? undefined };
    }

    // Only these two keys: a Zoho update writes every field it is given, so
    // sending anything else risks clobbering unrelated data on the lead.
    await this.zoho.updateInZoho(`/crm/v2/Leads/${project.zohoLeadId}`, {
      data: [{ id: project.zohoLeadId, Lead_Status: QUOTED_NEEDS_FOLLOW_UP }],
    });

    await this.mirrorLeadStatus(projectId, project.leadStatus, QUOTED_NEEDS_FOLLOW_UP);
    return { updated: true, status: QUOTED_NEEDS_FOLLOW_UP };
  }

  /**
   * Keep `project.leadStatus` in step with Zoho. Without it the mirror stays stale
   * until the next sync and the UI keeps offering an action already taken.
   *
   * Never throws: if Zoho accepted the change, the caller must still be told it
   * succeeded. The next sync repairs the mirror anyway.
   */
  private async mirrorLeadStatus(
    projectId: string,
    from: string | null | undefined,
    to: string | null,
  ): Promise<void> {
    if (!to || normalise(to) === normalise(from)) return;
    try {
      await this.projectRepository.updateById(projectId, { leadStatus: to });
    } catch (err) {
      console.error(
        `[zoho] failed to mirror lead status onto project ${projectId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * The lead's current Lead_Status. Returns `null` when the lead has no status set,
   * and `undefined` when the lookup itself failed, so the caller can tell "no status"
   * apart from "could not read".
   */
  private async fetchLeadStatus(zohoLeadId: string): Promise<string | null | undefined> {
    try {
      const resp = await this.zoho.fetchFromZoho<{ data?: Array<Record<string, unknown>> }>(
        `/crm/v2/Leads/${zohoLeadId}`,
        { fields: 'Lead_Status' },
      );
      const status = resp?.data?.[0]?.['Lead_Status'];
      return typeof status === 'string' ? status : null;
    } catch {
      return undefined;
    }
  }
}
