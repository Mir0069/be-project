import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import type { ITeamsMonitoredChannelRepository } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type { IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  ITeamsProvisionJob,
  ITeamsProvisionOutboxRepository,
} from '@repositories/interfaces/i-teams-provision-outbox.repository';

import { buildTeamsNames, resolveProjectDisplayName } from './teams-provisioning.util';
import type { IProvisionProjectReader } from './teams-provisioning.service';
import type {
  ConnectCandidateInput,
  ProvisionCandidateView,
  ProvisionState,
  ProvisionStateView,
} from './teams-provision.types';
import type { AddMonitoredChannelInput } from './teams.service';

// Connecting a candidate must behave exactly like a manual connect (403/409
// semantics, subscription, initial backfill), so we delegate rather than
// reimplement. TeamsService satisfies this structurally.
export interface IChannelConnector {
  addMonitoredChannel(input: AddMonitoredChannelInput): Promise<IDomainMonitoredChannel>;
}

export interface IProvisionDrainKicker {
  drainPending(): Promise<unknown>;
}

export interface ProvisionDecisionConfig {
  autoProvisionEnabled: boolean;
  hasOwner: boolean;
}

/** Read + decide half of provisioning. The drain half lives in TeamsProvisioningService. */
export class TeamsProvisionDecisionService {
  public constructor(
    private readonly outboxRepo: ITeamsProvisionOutboxRepository,
    private readonly connector: IChannelConnector,
    private readonly kicker: IProvisionDrainKicker,
    private readonly projectRepo: IProvisionProjectReader,
    private readonly monitoredChannelRepo: ITeamsMonitoredChannelRepository,
    private readonly config: ProvisionDecisionConfig,
  ) {}

  public async getForProject(projectId: string): Promise<ProvisionStateView> {
    const [channels, job] = await Promise.all([
      this.monitoredChannelRepo.listByProjectId(projectId),
      this.outboxRepo.findByProjectId(projectId),
    ]);

    const connected = channels.find((c) => c.isActive);
    if (connected) {
      return this.view('CONNECTED', [], connected.teamName, connected.channelName, null);
    }
    if (!job || job.status === 'DONE') return this.view('NONE', [], null, null, null);

    if (job.status === 'AWAITING_DECISION') {
      const suggested = await this.suggestedNames(job);
      const candidates = await this.annotate(job.candidates);
      return this.view('AWAITING_DECISION', candidates, suggested.teamName, suggested.channelName, job.discoveryError);
    }

    const state: ProvisionState = job.status === 'PENDING' ? 'DISCOVERING' : job.status;
    return this.view(state, [], job.teamName, job.channelName, job.lastError);
  }

  public async connectCandidate(
    projectId: string,
    input: ConnectCandidateInput,
  ): Promise<{ channel: IDomainMonitoredChannel; state: ProvisionStateView }> {
    const job = await this.requireAwaitingJob(projectId);

    // Errors (including the 409 "already linked elsewhere") propagate untouched
    // so the client sees the same contract as a manual connect.
    const channel = await this.connector.addMonitoredChannel({ ...input, projectId });

    await this.outboxRepo.updateIfStatus(job.id, 'AWAITING_DECISION', {
      status: 'DONE',
      decision: 'CONNECT',
      decidedAt: new Date(),
      teamId: input.teamId,
      teamName: input.teamName,
      channelId: input.channelId,
      channelName: input.channelName,
      lastError: null,
    });

    return { channel, state: await this.getForProject(projectId) };
  }

  public async approveCreate(projectId: string): Promise<ProvisionStateView> {
    // Resolve the project decision first so a missing decision consistently
    // returns 404, even when workspace creation is disabled in this environment.
    const job = await this.requireAwaitingJob(projectId);
    if (!this.config.autoProvisionEnabled || !this.config.hasOwner) {
      throw new AppError(
        'Teams workspace creation is not configured on this environment',
        StatusCodes.SERVICE_UNAVAILABLE,
      );
    }

    const moved = await this.outboxRepo.updateIfStatus(job.id, 'AWAITING_DECISION', {
      status: 'CREATING',
      mode: 'CREATE',
      decision: 'CREATE',
      decidedAt: new Date(),
      attempts: 0,
      lastError: null,
    });
    if (!moved) throw new AppError('This project was already decided', StatusCodes.CONFLICT);

    // Creation takes up to ~90s of Graph polling, so the request returns now
    // and the drain finishes in the background.
    void this.kicker.drainPending().catch((err) => {
      console.error('[TeamsProvision] kick after approve failed:', err instanceof Error ? err.message : err);
    });

    return this.getForProject(projectId);
  }

  private async requireAwaitingJob(projectId: string): Promise<ITeamsProvisionJob> {
    const job = await this.outboxRepo.findByProjectId(projectId);
    if (!job) throw new AppError('No Teams workspace decision is pending for this project', StatusCodes.NOT_FOUND);
    if (job.status !== 'AWAITING_DECISION') {
      throw new AppError(`This project's Teams workspace is already ${job.status}`, StatusCodes.CONFLICT);
    }
    return job;
  }

  // Flags candidates already linked elsewhere so the UI can warn before the
  // connect returns 409. Bounded by the candidate cap, so at most 3 reads.
  private async annotate(
    candidates: ITeamsProvisionJob['candidates'],
  ): Promise<ProvisionCandidateView[]> {
    return Promise.all(
      candidates.map(async (candidate) => {
        const existing = await this.monitoredChannelRepo.findByChannel(candidate.teamId, candidate.channelId);
        return {
          ...candidate,
          reason: candidate.reason as ProvisionCandidateView['reason'],
          linkedProjectIds: existing?.projectIds ?? [],
        };
      }),
    );
  }

  private async suggestedNames(job: ITeamsProvisionJob): Promise<{ teamName: string; channelName: string }> {
    const project = await this.projectRepo.findById(job.projectId);
    return buildTeamsNames(project ? resolveProjectDisplayName(project) : job.projectName);
  }

  private view(
    state: ProvisionState,
    candidates: ProvisionCandidateView[],
    teamName: string | null,
    channelName: string | null,
    error: string | null,
  ): ProvisionStateView {
    return { state, candidates, teamName, channelName, error };
  }
}
