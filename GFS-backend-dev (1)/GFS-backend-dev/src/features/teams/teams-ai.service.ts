import { createHash } from 'node:crypto';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type {
  ITeamsAiJobRepository,
  IDomainTeamsAiJob,
} from '@repositories/interfaces/i-teams-ai-job.repository';
import type { ITeamsMeetingRepository } from '@repositories/interfaces/i-teams-meeting.repository';
import type { ITeamsMonitoredChannelRepository } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type { ITeamsAiJobResultItem } from '@db/models/teams-ai-job.model';
import { ChangeSource } from '@db/models/pending-change-approval.model';
import type { PendingApprovalService } from '@features/proposal/pending-approval.service';

import { describeError } from './teams.errors';
import {
  TEAMS_AI_CORRELATION_PREFIX,
  type TeamsAiResultPayload,
  type TeamsAiResultItem,
  type TeamsAiSummary,
} from './teams-ai.types';

export interface ProcessAiResultOutcome {
  jobId: string;
  chatSummaryApplied: boolean;
  meetingSummariesApplied: number;
  approvalsRaised: number;
}

/**
 * The slice of the pending-approval service this handler needs. Narrowed so the
 * Teams side does not depend on the whole thing, and so tests can fake it.
 */
type SummaryApprovalRaiser = Pick<PendingApprovalService, 'createPendingApproval' | 'isSourceProcessed'>;

/**
 * Handles the AI's callback (POST /teams/ai-result): matches the echoed
 * correlationId back to its TeamsAiJob and fans each result to the right place —
 * `chat` → the channel's accumulated chat summary, `meeting` → that meeting's
 * summary — then marks the job COMPLETED.
 */
export class TeamsAiService {
  private readonly aiJobRepository: ITeamsAiJobRepository;
  private readonly meetingRepository: ITeamsMeetingRepository;
  private readonly monitoredChannelRepository: ITeamsMonitoredChannelRepository;
  // Optional: without it this handler behaves exactly as before, storing
  // summaries and raising nothing.
  private readonly approvals?: SummaryApprovalRaiser;

  public constructor(
    aiJobRepository: ITeamsAiJobRepository,
    meetingRepository: ITeamsMeetingRepository,
    monitoredChannelRepository: ITeamsMonitoredChannelRepository,
    approvals?: SummaryApprovalRaiser,
  ) {
    this.aiJobRepository = aiJobRepository;
    this.meetingRepository = meetingRepository;
    this.monitoredChannelRepository = monitoredChannelRepository;
    this.approvals = approvals;
  }

  public async processAiResult(payload: TeamsAiResultPayload): Promise<ProcessAiResultOutcome> {
    const job = await this.resolveJob(payload.correlationId);

    const now = new Date();
    let chatSummaryApplied = false;
    let meetingSummariesApplied = 0;
    let approvalsRaised = 0;

    for (const result of payload.results ?? []) {
      // Skip an empty summary so a trivial delta batch (e.g. just "hi"/"how are
      // you") doesn't clobber a good existing chat/meeting summary. The AI still
      // gets audited in job.results below.
      if (this.isEmptyResult(result)) {
        console.warn(
          `[TeamsAi] empty ${result.target} summary for job ${job.id}; keeping existing summary`,
        );
        continue;
      }
      const summary = this.toSummary(result, now);
      if (result.target === 'chat') {
        if (job.monitoredChannelDbId) {
          await this.monitoredChannelRepository.setChatSummary(job.monitoredChannelDbId, summary);
          chatSummaryApplied = true;
          approvalsRaised += await this.raiseChatSummaryApproval(job, summary);
        } else {
          console.warn(
            `[TeamsAi] chat result for job ${job.id} but the job has no monitoredChannelDbId`,
          );
        }
      } else if (result.target === 'meeting') {
        if (!result.meetingId) {
          console.warn(`[TeamsAi] meeting result for job ${job.id} missing meetingId; skipping`);
          continue;
        }
        const updated = await this.meetingRepository.setAiSummary(result.meetingId, summary);
        if (updated) {
          meetingSummariesApplied += 1;
          approvalsRaised += await this.raiseMeetingSummaryApproval(updated, summary);
        } else {
          console.warn(`[TeamsAi] meeting ${result.meetingId} not found for job ${job.id}`);
        }
      }
    }

    try {
      await this.aiJobRepository.complete(job.id, {
        readinessState: payload.readinessState ?? null,
        results: this.toStoredResults(payload.results ?? []),
      });
    } catch (err) {
      console.error(`[TeamsAi] failed to mark job ${job.id} complete: ${describeError(err)}`);
    }

    return { jobId: job.id, chatSummaryApplied, meetingSummariesApplied, approvalsRaised };
  }

  /**
   * A new chat summary is the reviewable unit, not each message.
   *
   * The estimator reads what the AI understood and decides whether it changes the
   * proposal; approving publishes BEGIN_EXTRACTION through the existing pending
   * approval flow. This is why chat messages themselves raise nothing: a channel
   * produces dozens of "ok"/"thanks" a day, and one summary per sync is the
   * signal. An empty summary never reaches here (see isEmptyResult), so a trivial
   * batch produces no approval at all.
   */
  private async raiseChatSummaryApproval(
    job: IDomainTeamsAiJob,
    summary: TeamsAiSummary,
  ): Promise<number> {
    if (!this.approvals || !job.monitoredChannelDbId) return 0;

    const channel = await this.monitoredChannelRepository.findById(job.monitoredChannelDbId);
    // A shared channel feeds several projects, and each has its own proposal to
    // reconsider, so each gets its own approval.
    if (!channel || channel.projectIds.length === 0) return 0;

    let raised = 0;
    for (const projectId of channel.projectIds) {
      raised += await this.raiseApproval({
        projectId,
        // Keyed by the summary CONTENT, not the job: a channel is re-summarised on
        // every sync, and an unchanged summary must not raise a second approval.
        sourceId: `teamsSummary:chat:${projectId}:${this.fingerprint(summary)}`,
        subject: `Teams chat summary: ${channel.channelName}`,
        summary,
      });
    }
    return raised;
  }

  /** Same, for one meeting's summary. Meetings carry their own project link. */
  private async raiseMeetingSummaryApproval(
    meeting: { id: string; subject?: string | null; projectId?: string | null },
    summary: TeamsAiSummary,
  ): Promise<number> {
    if (!this.approvals || !meeting.projectId) return 0;

    return this.raiseApproval({
      projectId: meeting.projectId,
      // Same reason, and it matters more here: a meeting is re-summarised when a
      // transcript arrives late, and that retry must not duplicate the approval.
      sourceId: `teamsSummary:meeting:${meeting.id}:${this.fingerprint(summary)}`,
      subject: `Teams meeting summary: ${meeting.subject || 'Untitled meeting'}`,
      summary,
    });
  }

  /**
   * Park one pending approval. Never throws: the AI callback must still store the
   * summary and complete its job even if the approval cannot be created.
   */
  private async raiseApproval(input: {
    projectId: string;
    sourceId: string;
    subject: string;
    summary: TeamsAiSummary;
  }): Promise<number> {
    if (!this.approvals) return 0;

    try {
      if (await this.approvals.isSourceProcessed(input.sourceId, ChangeSource.TEAMS)) return 0;

      await this.approvals.createPendingApproval({
        projectId: input.projectId,
        source: ChangeSource.TEAMS,
        sourceId: input.sourceId,
        correlationId: input.sourceId,
        // A summary is text: approving it re-reads the context and sends no documents.
        documentIds: [],
        documentNames: [],
        // A summary is prose, so there is nothing to diff field by field.
        newExtractedData: {},
        subject: input.subject,
        sender: 'Teams',
        aiReasoning: this.toReasoning(input.summary),
        // The AI's own confidence in the summary, rather than a default.
        ...(input.summary.confidence !== null ? { aiConfidence: input.summary.confidence } : {}),
      });
      return 1;
    } catch (err) {
      console.error(`[TeamsAi] failed to raise approval ${input.sourceId}: ${describeError(err)}`);
      return 0;
    }
  }

  /** Short hash of what the AI actually said, used to dedup identical summaries. */
  private fingerprint(summary: TeamsAiSummary): string {
    return createHash('sha256')
      .update(JSON.stringify([summary.summary, summary.keyPoints, summary.requirements]))
      .digest('hex')
      .slice(0, 16);
  }

  /** What the estimator reads in the Pending Approvals panel. */
  private toReasoning(summary: TeamsAiSummary): string {
    const parts = [summary.summary.trim()].filter(Boolean);
    if (summary.requirements.length > 0) {
      parts.push(`Requirements mentioned: ${summary.requirements.join('; ')}`);
    }
    return parts.join(' ');
  }

  private async resolveJob(correlationId: string): Promise<IDomainTeamsAiJob> {
    const parts = (correlationId ?? '').split(':');
    if (parts[0] !== TEAMS_AI_CORRELATION_PREFIX || !parts[1]) {
      throw new AppError('Invalid correlationId', StatusCodes.BAD_REQUEST, true, {
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
    const job = await this.aiJobRepository.findById(parts[1]);
    if (!job) {
      throw new AppError('Teams AI job not found', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.NOT_FOUND,
      });
    }
    return job;
  }

  private isEmptyResult(result: TeamsAiResultItem): boolean {
    return (
      !result.summary?.trim() &&
      (result.keyPoints?.length ?? 0) === 0 &&
      (result.requirements?.length ?? 0) === 0
    );
  }

  private toSummary(result: TeamsAiResultItem, now: Date): TeamsAiSummary {
    return {
      summary: result.summary ?? '',
      keyPoints: result.keyPoints ?? [],
      requirements: result.requirements ?? [],
      confidence: result.confidence ?? null,
      updatedAt: now,
    };
  }

  private toStoredResults(results: TeamsAiResultItem[]): ITeamsAiJobResultItem[] {
    return results.map((r) => ({
      target: r.target,
      meetingId: r.meetingId ?? null,
      summary: r.summary ?? '',
      keyPoints: r.keyPoints ?? [],
      requirements: r.requirements ?? [],
      confidence: r.confidence ?? null,
    }));
  }
}
