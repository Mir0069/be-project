import { AppError } from '@shared/errors/app.error';
import { UserRole } from '@db/models/user.model';
import type { TeamsProjectMemberReason } from '@db/models/teams-project-member.model';
import type { IAuthUser } from '@features/auth/auth.types';
import type { IDomainProject } from '@repositories/interfaces/i-project.repository';
import type { IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  IEnsureTeamsProjectMemberFields,
  ITeamsProjectMemberRecord,
  ITeamsProjectMemberRepository,
} from '@repositories/interfaces/i-teams-project-member.repository';

import type { ITeamsGraphClient } from './teams.graph-client';
import type { GraphList } from './teams.types';
import type { IProjectTeamsMembership, SyncProjectMembersRequest } from './teams-membership.port';

// Attempts before a row is parked as FAILED and a sales manager is asked to add the person.
const MAX_ATTEMPTS = 5;
// Rows handled per drain pass; the rest continue on the next poller tick.
const DRAIN_BATCH_SIZE = 50;
const GUEST_INVITE_REDIRECT_URL = 'https://teams.microsoft.com';
// Client errors that retrying cannot fix (bad email, missing permission, deleted team).
const PERMANENT_STATUS_CODES = new Set([400, 403, 404]);
const THROTTLED_STATUS_CODE = 429;

const statusCodeOf = (err: unknown): number | undefined => (err as AppError)?.statusCode;

const graphMessageOf = (err: unknown): string => {
  const details = (err as AppError)?.details as { error?: { message?: string } } | undefined;
  return details?.error?.message ?? (err instanceof Error ? err.message : String(err));
};

// Graph reports an existing membership as an error; for us it means the job is already done.
const isAlreadyMember = (err: unknown): boolean => /already exist/i.test(graphMessageOf(err));

export interface IMembershipProjectReader {
  findById(id: string): Promise<IDomainProject | null>;
  listActive(): Promise<IDomainProject[]>;
}

export interface IMembershipUserReader {
  findById(id: string): Promise<IAuthUser | null>;
  findAll(): Promise<IAuthUser[]>;
}

export interface IMembershipChannelReader {
  listActive(): Promise<IDomainMonitoredChannel[]>;
  listByProjectIds(projectIds: string[]): Promise<IDomainMonitoredChannel[]>;
}

export interface ITeamsMemberNotifier {
  notifyTeamsMemberNotAdded(input: {
    projectId: string;
    referenceNumber?: string | null;
    projectName: string | null;
    memberName: string;
    memberEmail: string;
    reason: string;
  }): Promise<void>;
}

export interface TeamsMembershipConfig {
  enabled: boolean;
  graphBaseUrl: string;
}

export interface MembershipDrainResult {
  processed: number;
  added: number;
  skipped: number;
  failed: number;
}

interface MicrosoftAccount {
  id: string;
  isGuest: boolean;
  invited: boolean;
}

const emptyDrain = (): MembershipDrainResult => ({ processed: 0, added: 0, skipped: 0, failed: 0 });

// Adds assigned estimators, the assigning Sales Manager and every Head of Division to each
// project's Teams team, in the background with retries. Never removes anyone.
export class TeamsMembershipService implements IProjectTeamsMembership {
  private draining = false;
  private rerunRequested = false;

  public constructor(
    private readonly graphClient: ITeamsGraphClient,
    private readonly memberRepo: ITeamsProjectMemberRepository,
    private readonly channelRepo: IMembershipChannelReader,
    private readonly projectRepo: IMembershipProjectReader,
    private readonly userRepo: IMembershipUserReader,
    private readonly config: TeamsMembershipConfig,
    private readonly notifier?: ITeamsMemberNotifier,
  ) {}

  // ---- Port: record who should be in the team, then kick a background drain ----
  public async syncProject(input: SyncProjectMembersRequest): Promise<void> {
    if (!this.config.enabled) return;
    try {
      if (input.assignedBy) await this.recordAssigner(input.projectId, input.assignedBy);
      const project = await this.projectRepo.findById(input.projectId);
      if (project?.isActive) {
        const channels = await this.channelRepo.listByProjectIds([project.id]);
        await this.reconcile([project], channels);
      }
      void this.drainPending().catch((err) => {
        console.error('[TeamsMembership] immediate drain failed:', this.messageOf(err));
      });
    } catch (err) {
      console.error(`[TeamsMembership] sync failed for project ${input.projectId}:`, this.messageOf(err));
    }
  }

  // Catches everything the triggers can't: existing projects, teams linked later and new Heads of Division.
  public async sweep(): Promise<number> {
    if (!this.config.enabled) return 0;
    const channels = await this.channelRepo.listActive();
    const linkedProjectIds = new Set(channels.flatMap((channel) => channel.projectIds));
    if (linkedProjectIds.size === 0) return 0;

    const projects = (await this.projectRepo.listActive()).filter((project) => linkedProjectIds.has(project.id));
    return this.reconcile(projects, channels);
  }

  public async drainPending(): Promise<MembershipDrainResult> {
    if (!this.config.enabled) return emptyDrain();
    // One drain at a time: the kick and the poller share this instance.
    if (this.draining) {
      this.rerunRequested = true;
      return emptyDrain();
    }
    this.draining = true;
    try {
      let result = emptyDrain();
      do {
        this.rerunRequested = false;
        result = await this.drainOnce();
      } while (this.rerunRequested);
      return result;
    } finally {
      this.draining = false;
    }
  }

  private async recordAssigner(projectId: string, userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user?.isActive || user.role !== UserRole.SALES_MANAGER) return;
    await this.memberRepo.ensureMany([{ projectId, userId, teamId: null, reason: 'ASSIGNER' }]);
  }

  private async reconcile(projects: IDomainProject[], channels: IDomainMonitoredChannel[]): Promise<number> {
    if (projects.length === 0) return 0;
    const users = await this.userRepo.findAll();
    const activeUserIds = new Set(users.filter((user) => user.isActive).map((user) => user.id));
    const headsOfDivision = users.filter((user) => user.isActive && user.role === UserRole.HEAD_OF_DIVISION);
    const assigners = await this.memberRepo.listAssigners(projects.map((project) => project.id));

    const rows: IEnsureTeamsProjectMemberFields[] = [];
    for (const project of projects) {
      const teamIds = [
        ...new Set(
          channels
            .filter((channel) => channel.isActive && channel.projectIds.includes(project.id))
            .map((channel) => channel.teamId),
        ),
      ];
      if (teamIds.length === 0) continue;

      // First reason wins, so someone who is both estimator and Head of Division is added once.
      const wanted = new Map<string, TeamsProjectMemberReason>();
      const want = (userId: string, reason: TeamsProjectMemberReason): void => {
        if (activeUserIds.has(userId) && !wanted.has(userId)) wanted.set(userId, reason);
      };
      for (const estimator of project.assignedEstimators ?? []) want(String(estimator.id), 'ESTIMATOR');
      for (const assigner of assigners) {
        if (assigner.projectId === project.id) want(assigner.userId, 'ASSIGNER');
      }
      for (const head of headsOfDivision) want(head.id, 'HEAD_OF_DIVISION');

      for (const teamId of teamIds) {
        for (const [userId, reason] of wanted) rows.push({ projectId: project.id, userId, teamId, reason });
      }
    }

    return rows.length > 0 ? this.memberRepo.ensureMany(rows) : 0;
  }

  private async drainOnce(): Promise<MembershipDrainResult> {
    const rows = await this.memberRepo.listRunnable(DRAIN_BATCH_SIZE);
    const accounts = new Map<string, MicrosoftAccount>();
    const result: MembershipDrainResult = { ...emptyDrain(), processed: rows.length };

    for (const row of rows) {
      try {
        const outcome = await this.processRow(row, accounts);
        result[outcome] += 1;
      } catch (err) {
        // Throttled: stop this pass untouched and let the next tick pick the rows up again.
        if (statusCodeOf(err) === THROTTLED_STATUS_CODE) break;
        const failed = await this.recordFailure(row, err);
        if (failed) result.failed += 1;
      }
    }
    return result;
  }

  private async processRow(
    row: ITeamsProjectMemberRecord,
    accounts: Map<string, MicrosoftAccount>,
  ): Promise<'added' | 'skipped'> {
    const [user, project] = await Promise.all([
      this.userRepo.findById(row.userId),
      this.projectRepo.findById(row.projectId),
    ]);
    if (!user?.isActive || !project?.isActive || !row.teamId) {
      await this.memberRepo.update(row.id, { status: 'SKIPPED', lastError: 'User or project is no longer active' });
      return 'skipped';
    }

    const account = await this.resolveAccount(user.email, accounts);
    await this.addToTeam(row.teamId, account);
    await this.memberRepo.update(row.id, {
      status: 'ADDED',
      aadUserId: account.id,
      invited: account.invited,
      lastError: null,
    });
    return 'added';
  }

  private async resolveAccount(email: string, accounts: Map<string, MicrosoftAccount>): Promise<MicrosoftAccount> {
    const key = email.trim().toLowerCase();
    const cached = accounts.get(key);
    if (cached) return cached;
    const account = (await this.findAccount(key)) ?? (await this.inviteGuest(key));
    accounts.set(key, account);
    return account;
  }

  private async findAccount(email: string): Promise<MicrosoftAccount | null> {
    const literal = email.replace(/'/g, "''");
    const response = await this.graphClient.get<GraphList<{ id?: string; userType?: string | null }>>('/users', {
      $filter: `userPrincipalName eq '${literal}' or mail eq '${literal}'`,
      $select: 'id,userType',
    });
    const match = response.value?.find((user) => user.id);
    return match?.id ? { id: match.id, isGuest: match.userType === 'Guest', invited: false } : null;
  }

  private async inviteGuest(email: string): Promise<MicrosoftAccount> {
    try {
      const response = await this.graphClient.post<{ invitedUser?: { id?: string } }>('/invitations', {
        invitedUserEmailAddress: email,
        inviteRedirectUrl: GUEST_INVITE_REDIRECT_URL,
        sendInvitationMessage: true,
      });
      const id = response.data?.invitedUser?.id;
      if (!id) throw new AppError(`Guest invitation for ${email} returned no user id`, 502);
      return { id, isGuest: true, invited: true };
    } catch (err) {
      if (statusCodeOf(err) === 403) {
        throw new AppError(
          'No Microsoft account was found and guest invitations are not permitted (User.Invite.All).',
          403,
        );
      }
      throw err;
    }
  }

  private async addToTeam(teamId: string, account: MicrosoftAccount): Promise<void> {
    const base = this.config.graphBaseUrl;
    try {
      await this.graphClient.post(`/teams/${encodeURIComponent(teamId)}/members`, {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: account.isGuest ? ['guest'] : [],
        'user@odata.bind': `${base}/users('${account.id}')`,
      });
    } catch (err) {
      if (isAlreadyMember(err)) return;
      // Without TeamMember.ReadWrite.All the Teams API refuses; the team's group accepts the same member.
      if (statusCodeOf(err) !== 400 && statusCodeOf(err) !== 403) throw err;
      await this.addToGroup(teamId, account.id);
    }
  }

  private async addToGroup(teamId: string, userId: string): Promise<void> {
    try {
      await this.graphClient.post(`/groups/${encodeURIComponent(teamId)}/members/$ref`, {
        '@odata.id': `${this.config.graphBaseUrl}/directoryObjects/${userId}`,
      });
    } catch (err) {
      if (isAlreadyMember(err)) return;
      throw err;
    }
  }

  // Returns true when the row is now FAILED for good.
  private async recordFailure(row: ITeamsProjectMemberRecord, err: unknown): Promise<boolean> {
    const attempts = row.attempts + 1;
    const message = graphMessageOf(err);
    const status = statusCodeOf(err);
    const permanent = attempts >= MAX_ATTEMPTS || (status !== undefined && PERMANENT_STATUS_CODES.has(status));

    await this.memberRepo.update(row.id, {
      attempts,
      lastError: message,
      status: permanent ? 'FAILED' : 'PENDING',
    });
    console.error(
      `[TeamsMembership] row ${row.id} attempt ${attempts} ${permanent ? 'failed' : 'will retry'}: ${message}`,
    );

    if (permanent && !row.notifiedAt) await this.notifyFailure(row, message);
    return permanent;
  }

  private async notifyFailure(row: ITeamsProjectMemberRecord, reason: string): Promise<void> {
    if (!this.notifier) return;
    try {
      const [user, project] = await Promise.all([
        this.userRepo.findById(row.userId),
        this.projectRepo.findById(row.projectId),
      ]);
      if (!user || !project) return;
      await this.notifier.notifyTeamsMemberNotAdded({
        projectId: project.id,
        referenceNumber: project.referenceNumber,
        projectName: project.projectName ?? null,
        memberName: `${user.firstName} ${user.lastName}`.trim() || user.email,
        memberEmail: user.email,
        reason,
      });
      await this.memberRepo.update(row.id, { notifiedAt: new Date() });
    } catch (err) {
      console.error(`[TeamsMembership] failure notification for row ${row.id} failed:`, this.messageOf(err));
    }
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
