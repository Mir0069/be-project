import { AppError } from '@shared/errors/app.error';
import type { ITeamsMonitoredChannelRepository } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  ITeamsProvisionJob,
  ITeamsProvisionOutboxRepository,
} from '@repositories/interfaces/i-teams-provision-outbox.repository';
import type { TeamsProvisionStatus } from '@db/models/teams-provision-outbox.model';
import { ProjectCreationSource } from '@db/models/project.model';
import type {
  IProjectTeamsProvisioner,
  ProvisionTeamsRequest,
} from '@features/zoho/teams-provisioner.port';

import type { ITeamsGraphClient } from './teams.graph-client';
import { buildTeamsNames, resolveProjectDisplayName } from './teams-provisioning.util';
import type { IProjectTeamsDiscovery } from './teams-provision.types';
import type { IProjectTeamsMembership } from './teams-membership.port';

// Attempts before a job is parked as FAILED for manual review.
const MAX_ATTEMPTS = 5;
// Discovery is only a lookup, so it gives up sooner and parks for a human
// rather than failing the job outright.
const DISCOVERY_MAX_ATTEMPTS = 3;
// Bounded wait for Microsoft's async team-provisioning op within one drain pass
// (18 x 5s = 90s). It normally succeeds in <40s, so the immediate kick usually
// finishes the whole flow in one pass; a slow op just resumes on the next tick.
const OPERATION_POLL_ATTEMPTS = 18;
const OPERATION_POLL_DELAY_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const statusCodeOf = (err: unknown): number | undefined => (err as AppError)?.statusCode;

// NotificationService satisfies this structurally (its extra optional
// referenceNumber keeps it assignable). Kept minimal so provisioning doesn't
// depend on the whole notifications feature.
export interface ITeamsWorkspaceNotifier {
  notifyTeamsWorkspaceCreated(input: {
    projectId: string;
    referenceNumber?: string | null;
    projectName: string;
    teamName: string;
    channelName: string;
  }): Promise<void>;
  // Optional so existing fakes and the notification service stay assignable.
  notifyTeamsWorkspaceNeedsDecision?(input: {
    projectId: string;
    projectName: string;
    candidateCount: number;
  }): Promise<void>;
}

// Narrow read seam over IProjectRepository. The drain re-reads the project so
// the team name reflects the CURRENT name (a parked job can sit for days) and
// so it can branch on how the project was created.
export interface IProvisionProjectReader {
  findById(id: string): Promise<{
    referenceNumber?: string | null;
    projectName: string;
    jobAddress: string | null;
    creationSource: ProjectCreationSource;
  } | null>;
}

export interface TeamsProvisioningConfig {
  autoProvisionEnabled: boolean;
  ownerGuid: string;
  ownerUpn: string;
  graphBaseUrl: string;
}

export interface DrainResult {
  processed: number;
  provisioned: number;
  parked: number;
  failed: number;
}

const emptyDrain = (): DrainResult => ({ processed: 0, provisioned: 0, parked: 0, failed: 0 });

/**
 * Provisions a project's Teams workspace, app-only. Mail-first projects get a
 * private Team + Threads channel created immediately; Zoho-first projects are
 * first matched against existing teams/channels and park for a human decision.
 * Jobs are resumable (teamId/channelId checkpoints) and idempotent (skipped if
 * the project already has a monitored channel), so retries never duplicate.
 */
export class TeamsProvisioningService implements IProjectTeamsProvisioner {
  private draining = false;
  private rerunRequested = false;

  public constructor(
    private readonly graphClient: ITeamsGraphClient,
    private readonly monitoredChannelRepo: ITeamsMonitoredChannelRepository,
    private readonly outboxRepo: ITeamsProvisionOutboxRepository,
    private readonly projectRepo: IProvisionProjectReader,
    private readonly config: TeamsProvisioningConfig,
    private readonly notifier?: ITeamsWorkspaceNotifier,
    private readonly discovery?: IProjectTeamsDiscovery,
    private readonly membership?: IProjectTeamsMembership,
  ) {}

  // ---- Port: enqueue + immediate (non-awaited) kick ----------------------
  public async provisionForProject(input: ProvisionTeamsRequest): Promise<void> {
    if (!this.config.autoProvisionEnabled) return;
    if (!this.hasOwner()) {
      console.warn(
        '[TeamsProvision] TEAMS_AUTO_PROVISION_ENABLED is on but no TEAMS_OWNER_GUID/UPN is set; skipping.',
      );
      return;
    }
    try {
      const { teamName, channelName } = buildTeamsNames(input.projectName);
      await this.outboxRepo.enqueue({
        projectId: input.projectId,
        projectName: input.projectName,
        teamName,
        channelName,
      });
      // Fire-and-forget so project creation returns instantly.
      void this.drainPending().catch((err) => {
        console.error('[TeamsProvision] immediate drain failed:', this.messageOf(err));
      });
    } catch (err) {
      // Never let provisioning break project creation.
      console.error('[TeamsProvision] enqueue failed:', this.messageOf(err));
    }
  }

  // ---- Drain (immediate kick + poller) -----------------------------------
  public async drainPending(): Promise<DrainResult> {
    if (!this.config.autoProvisionEnabled) return emptyDrain();
    // In-memory guard: one drain at a time (the kick and the poller share this
    // instance), so two drains can never create a duplicate team for one job.
    if (this.draining) {
      this.rerunRequested = true;
      return emptyDrain();
    }
    this.draining = true;
    try {
      let result: DrainResult = emptyDrain();
      do {
        this.rerunRequested = false;
        result = await this.drainOnce();
      } while (this.rerunRequested); // a kick during the pass triggers one more
      return result;
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<DrainResult> {
    const runnable = await this.outboxRepo.listRunnable();
    let provisioned = 0;
    let parked = 0;
    let failed = 0;

    for (const job of runnable) {
      try {
        const outcome = await this.processJob(job);
        if (outcome === 'provisioned') provisioned += 1;
        if (outcome === 'parked') parked += 1;
      } catch (err) {
        const attempts = job.attempts + 1;
        const status: TeamsProvisionStatus = attempts >= MAX_ATTEMPTS ? 'FAILED' : job.status;
        if (status === 'FAILED') failed += 1;
        await this.outboxRepo.update(job.id, {
          attempts,
          lastError: this.messageOf(err),
          status,
        });
        console.error(
          `[TeamsProvision] job ${job.id} attempt ${attempts} failed (${status}): ${this.messageOf(err)}`,
        );
      }
    }

    await this.sweepAwaitingDecision();
    return { processed: runnable.length, provisioned, parked, failed };
  }

  // Closes jobs parked while someone connected the channel by hand.
  private async sweepAwaitingDecision(): Promise<void> {
    const parked = await this.outboxRepo.listAwaitingDecision();
    if (parked.length === 0) return;

    const channels = await this.monitoredChannelRepo.listByProjectIds(parked.map((j) => j.projectId));
    const linked = new Set(channels.flatMap((c) => c.projectIds));

    for (const job of parked) {
      if (!linked.has(job.projectId)) continue;
      await this.outboxRepo.update(job.id, { status: 'DONE', lastError: null });
    }
  }

  private async processJob(
    job: ITeamsProvisionJob,
  ): Promise<'provisioned' | 'parked' | 'skipped' | 'retry'> {
    // Idempotency: the project already has a channel (manual connect or a prior
    // successful provision) — nothing to do.
    const existing = await this.monitoredChannelRepo.listByProjectId(job.projectId);
    if (existing.length > 0) {
      await this.outboxRepo.update(job.id, { status: 'DONE', lastError: null });
      return 'skipped';
    }

    const project = await this.projectRepo.findById(job.projectId);
    if (!project) {
      // Permanent: no amount of retrying brings a deleted project back.
      await this.outboxRepo.update(job.id, { status: 'FAILED', lastError: 'Project not found' });
      return 'skipped';
    }
    const displayName = resolveProjectDisplayName(project);

    if (job.status === 'PENDING') {
      if (project.creationSource !== ProjectCreationSource.MAIL_FIRST) {
        return this.parkForDecision(job, displayName);
      }
      // Mail-first has no prior conversation to find, so it creates directly.
      await this.outboxRepo.update(job.id, { status: 'CREATING', mode: 'CREATE' });
      // Keep the in-memory job in step: the drain's catch writes job.status
      // back, and a stale PENDING there would undo an approved decision.
      job.status = 'CREATING';
    }

    await this.createWorkspace(job, displayName, project.referenceNumber);
    return 'provisioned';
  }

  // Discovery failures are handled here, not by the drain's catch: a lookup
  // that keeps failing should still park for a human, because a FAILED job is
  // never surfaced and the project would silently get no workspace.
  private async parkForDecision(job: ITeamsProvisionJob, displayName: string): Promise<'parked' | 'retry'> {
    let candidates: ITeamsProvisionJob['candidates'] = [];
    let discoveryError: string | null = null;

    try {
      if (this.discovery) candidates = await this.discovery.findCandidates(displayName);
    } catch (err) {
      discoveryError = this.messageOf(err);
      const attempts = job.attempts + 1;
      if (attempts < DISCOVERY_MAX_ATTEMPTS) {
        await this.outboxRepo.update(job.id, { attempts, lastError: discoveryError });
        console.error(`[TeamsProvision] discovery attempt ${attempts} failed: ${discoveryError}`);
        return 'retry';
      }
    }

    await this.outboxRepo.update(job.id, {
      status: 'AWAITING_DECISION',
      mode: 'DISCOVER',
      candidates,
      projectName: displayName,
      discoveredAt: new Date(),
      discoveryError,
      lastError: null,
    });

    await this.notifier?.notifyTeamsWorkspaceNeedsDecision?.({
      projectId: job.projectId,
      projectName: displayName,
      candidateCount: candidates.length,
    });
    return 'parked';
  }

  private async createWorkspace(
    job: ITeamsProvisionJob,
    displayName: string,
    referenceNumber?: string | null,
  ): Promise<void> {
    const ownerGuid = await this.resolveOwnerGuid();

    // Step 1 — create the team. On resume the names already persisted are kept:
    // the real team carries them, so re-deriving would desync us from Graph.
    let teamId = job.teamId;
    let operationId = job.operationId;
    let { teamName, channelName } = job;
    if (!teamId) {
      ({ teamName, channelName } = buildTeamsNames(displayName));
      const created = await this.createTeam({ teamName, channelName, projectName: displayName }, ownerGuid);
      teamId = created.teamId;
      operationId = created.operationId;
      await this.outboxRepo.update(job.id, {
        teamId,
        operationId,
        teamName,
        channelName,
        projectName: displayName,
      });
    }

    // Step 2 — wait for Microsoft to finish provisioning.
    await this.waitForProvisioning(teamId, operationId);

    // Step 3 — the primary channel is the renamed default (== our channel).
    let channelId = job.channelId;
    if (!channelId) {
      channelId = await this.getPrimaryChannelId(teamId);
      await this.outboxRepo.update(job.id, { channelId });
    }

    // Step 4 — Threads layout (tolerate a missing ChannelSettings permission).
    await this.setThreadsLayout(teamId, channelId);

    // Step 5 — persist the link; this ALSO auto-monitors the channel so its
    // messages/meetings ingest for free.
    await this.monitoredChannelRepo.upsert({
      teamId,
      teamName,
      channelId,
      channelName,
      projectIds: [job.projectId],
    });

    // Step 5b — add the project's estimators, assigner and Heads of Division (non-blocking).
    await this.membership?.syncProject({ projectId: job.projectId });

    // Step 6 — notify (best-effort; the service swallows its own errors).
    await this.notifier?.notifyTeamsWorkspaceCreated({
      projectId: job.projectId,
      ...(referenceNumber ? { referenceNumber } : {}),
      projectName: displayName,
      teamName,
      channelName,
    });

    await this.outboxRepo.update(job.id, { status: 'DONE', lastError: null });
  }

  private async createTeam(
    names: { teamName: string; channelName: string; projectName: string },
    ownerGuid: string,
  ): Promise<{ teamId: string; operationId: string | null }> {
    const base = this.config.graphBaseUrl;
    const body = {
      'template@odata.bind': `${base}/teamsTemplates('standard')`,
      displayName: names.teamName,
      description: `Auto-created workspace for ${names.projectName}.`,
      visibility: 'private',
      // Renames the default General channel → no stray "General".
      firstChannelName: names.channelName,
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `${base}/users('${ownerGuid}')`,
        },
      ],
    };
    const res = await this.graphClient.post<unknown>('/teams', body);
    const contentLocation = res.headers['content-location'] ?? '';
    const location = res.headers['location'] ?? '';
    const teamId = contentLocation.match(/teams[('/]+([^')/]+)/i)?.[1];
    const operationId = location.match(/operations[('/]+([^')/]+)/i)?.[1] ?? null;
    if (!teamId) {
      throw new AppError(`Team created but no id in Content-Location: "${contentLocation}"`, 502);
    }
    return { teamId, operationId };
  }

  private async waitForProvisioning(teamId: string, operationId: string | null): Promise<void> {
    for (let attempt = 0; attempt < OPERATION_POLL_ATTEMPTS; attempt += 1) {
      if (await this.isProvisioned(teamId, operationId)) return;
      await sleep(OPERATION_POLL_DELAY_MS);
    }
    // Not done yet — throw so the job stays PENDING and the next drain resumes.
    throw new AppError(`Team ${teamId} still provisioning`, 503);
  }

  private async isProvisioned(teamId: string, operationId: string | null): Promise<boolean> {
    try {
      if (operationId) {
        const op = await this.graphClient.get<{ status?: string }>(
          `/teams/${teamId}/operations/${operationId}`,
        );
        if (op.status === 'succeeded') return true;
        if (op.status === 'failed') throw new AppError('Teams provisioning operation failed', 502);
        return false; // notStarted / running / inProgress
      }
      // No operation id — probe the primary channel instead.
      await this.graphClient.get(`/teams/${teamId}/primaryChannel`, { $select: 'id' });
      return true;
    } catch (err) {
      if (statusCodeOf(err) === 404) return false; // not queryable yet
      throw err;
    }
  }

  private async getPrimaryChannelId(teamId: string): Promise<string> {
    const channel = await this.graphClient.get<{ id?: string }>(
      `/teams/${teamId}/primaryChannel`,
      { $select: 'id,displayName' },
    );
    if (!channel.id) throw new AppError(`Team ${teamId} primaryChannel returned no id`, 502);
    return channel.id;
  }

  private async setThreadsLayout(teamId: string, channelId: string): Promise<void> {
    try {
      await this.graphClient.patch(`/teams/${teamId}/channels/${encodeURIComponent(channelId)}`, {
        layoutType: 'chat',
      });
    } catch (err) {
      if (statusCodeOf(err) === 403) {
        console.warn(
          '[TeamsProvision] PATCH layoutType 403 (needs ChannelSettings.ReadWrite.All); channel stays on Posts layout.',
        );
        return;
      }
      throw err;
    }
  }

  private async resolveOwnerGuid(): Promise<string> {
    // A GUID passes straight through resolveUserId; a UPN is resolved + cached.
    return this.graphClient.resolveUserId(this.config.ownerGuid || this.config.ownerUpn);
  }

  private hasOwner(): boolean {
    return Boolean(this.config.ownerGuid || this.config.ownerUpn);
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
