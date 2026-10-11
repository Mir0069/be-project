// =============================================================================
// TEAMS MEMBERSHIP — WHO GETS ADDED TO A PROJECT'S MICROSOFT TEAMS TEAM
// =============================================================================
// Everything here runs against in-memory fakes: no database, no Microsoft Graph.

import { AppError } from '@shared/errors/app.error';
import { AuthProvider, UserRole } from '@db/models/user.model';
import type { IAuthUser } from '@features/auth/auth.types';
import {
  TeamsMembershipService,
  type IMembershipChannelReader,
  type IMembershipProjectReader,
  type IMembershipUserReader,
  type ITeamsMemberNotifier,
} from '@features/teams/teams-membership.service';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';
import type { IDomainProject } from '@repositories/interfaces/i-project.repository';
import type { IDomainMonitoredChannel } from '@repositories/interfaces/i-teams-monitored-channel.repository';
import type {
  IEnsureTeamsProjectMemberFields,
  ITeamsProjectMemberRecord,
  ITeamsProjectMemberRepository,
  ITeamsProjectMemberUpdate,
} from '@repositories/interfaces/i-teams-project-member.repository';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

class InMemoryMemberRepository implements ITeamsProjectMemberRepository {
  public rows: ITeamsProjectMemberRecord[] = [];

  public async ensureMany(rows: IEnsureTeamsProjectMemberFields[]): Promise<number> {
    let created = 0;
    for (const row of rows) {
      const exists = this.rows.some(
        (r) => r.projectId === row.projectId && r.userId === row.userId && r.teamId === row.teamId,
      );
      if (exists) continue;
      this.rows.push({
        id: `row-${this.rows.length + 1}`,
        ...row,
        status: row.teamId ? 'PENDING' : 'WAITING_FOR_TEAM',
        attempts: 0,
        lastError: null,
        aadUserId: null,
        invited: false,
        notifiedAt: null,
        createdAt: new Date(Date.now() + this.rows.length),
      });
      created += 1;
    }
    return created;
  }

  public async listRunnable(limit: number): Promise<ITeamsProjectMemberRecord[]> {
    return this.rows.filter((r) => r.status === 'PENDING' && r.teamId).slice(0, limit).map((r) => ({ ...r }));
  }

  public async listAssigners(projectIds: string[]) {
    return this.rows
      .filter((r) => r.reason === 'ASSIGNER' && projectIds.includes(r.projectId))
      .map((r) => ({ projectId: r.projectId, userId: r.userId }));
  }

  public async update(id: string, patch: ITeamsProjectMemberUpdate): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
  }

  public find(userId: string, teamId: string | null = 'team-1'): ITeamsProjectMemberRecord | undefined {
    return this.rows.find((r) => r.userId === userId && r.teamId === teamId);
  }
}

const user = (id: string, role: UserRole, overrides: Partial<IAuthUser> = {}): IAuthUser => ({
  id,
  email: `${id}@gfs.test`,
  authProvider: AuthProvider.LOCAL,
  role,
  firstName: id,
  lastName: 'User',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const project = (id: string, estimatorIds: string[], overrides: Partial<IDomainProject> = {}): IDomainProject =>
  ({
    id,
    referenceNumber: `GFS-2026-${id}`,
    projectName: `Project ${id}`,
    isActive: true,
    assignedEstimators: estimatorIds.map((estimatorId) => ({
      id: estimatorId,
      name: estimatorId,
      email: `${estimatorId}@gfs.test`,
    })),
    ...overrides,
  }) as IDomainProject;

const channel = (teamId: string, projectIds: string[], overrides: Partial<IDomainMonitoredChannel> = {}): IDomainMonitoredChannel => ({
  id: `ch-${teamId}`,
  teamId,
  teamName: `Team ${teamId}`,
  channelId: `chan-${teamId}`,
  channelName: 'discussion',
  projectIds,
  deltaLink: null,
  isActive: true,
  aiChatSummary: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const graphError = (status: number, message = 'Graph failed'): AppError =>
  new AppError(`Microsoft Graph request failed`, status, true, { details: { error: { message } } });

let users: IAuthUser[];
let projects: IDomainProject[];
let channels: IDomainMonitoredChannel[];
let memberRepo: InMemoryMemberRepository;
let graphClient: jest.Mocked<ITeamsGraphClient>;
let notifier: jest.Mocked<ITeamsMemberNotifier>;
let enabled: boolean;

// Microsoft accounts known to the fake tenant, keyed by email.
let tenantAccounts: Record<string, { id: string; userType: string }>;

const buildService = (): TeamsMembershipService => {
  const projectRepo: IMembershipProjectReader = {
    findById: async (id) => projects.find((p) => p.id === id) ?? null,
    listActive: async () => projects.filter((p) => p.isActive),
  };
  const userRepo: IMembershipUserReader = {
    findById: async (id) => users.find((u) => u.id === id) ?? null,
    findAll: async () => [...users],
  };
  const channelRepo: IMembershipChannelReader = {
    listActive: async () => channels.filter((c) => c.isActive),
    listByProjectIds: async (ids) => channels.filter((c) => c.isActive && c.projectIds.some((p) => ids.includes(p))),
  };
  return new TeamsMembershipService(
    graphClient,
    memberRepo,
    channelRepo,
    projectRepo,
    userRepo,
    { enabled, graphBaseUrl: GRAPH_BASE },
    notifier,
  );
};

// Lets the fire-and-forget drain kicked by syncProject finish.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const postsTo = (pathPrefix: string) =>
  graphClient.post.mock.calls.filter(([path]) => String(path).startsWith(pathPrefix));

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  enabled = true;
  users = [
    user('est-1', UserRole.ESTIMATOR),
    user('est-2', UserRole.ESTIMATOR),
    user('sm-1', UserRole.SALES_MANAGER),
    user('admin-1', UserRole.SYSTEM_ADMIN),
    user('hod-1', UserRole.HEAD_OF_DIVISION),
  ];
  projects = [project('p1', ['est-1', 'est-2'])];
  channels = [channel('team-1', ['p1'])];
  memberRepo = new InMemoryMemberRepository();
  tenantAccounts = Object.fromEntries(
    users.map((u) => [u.email, { id: `aad-${u.id}`, userType: 'Member' }]),
  );

  graphClient = {
    get: jest.fn().mockImplementation(async (path: string, params?: Record<string, string>) => {
      if (path !== '/users') throw new Error(`unexpected GET ${path}`);
      const email = /mail eq '([^']+)'/.exec(params?.['$filter'] ?? '')?.[1]?.replace(/''/g, "'") ?? '';
      const account = tenantAccounts[email];
      return { value: account ? [account] : [] };
    }),
    post: jest.fn().mockImplementation(async (path: string) => {
      if (path === '/invitations') return { status: 201, data: { invitedUser: { id: 'aad-guest' } }, headers: {} };
      return { status: 201, data: {}, headers: {} };
    }),
    delete: jest.fn(),
  } as unknown as jest.Mocked<ITeamsGraphClient>;

  notifier = { notifyTeamsMemberNotAdded: jest.fn().mockResolvedValue(undefined) };
});

describe('TeamsMembershipService — who is added', () => {
  it('adds every assigned estimator, the assigning sales manager and every head of division', async () => {
    await buildService().syncProject({ projectId: 'p1', assignedBy: 'sm-1' });
    await settle();

    expect(memberRepo.rows.filter((r) => r.teamId === 'team-1').map((r) => [r.userId, r.reason, r.status])).toEqual([
      ['est-1', 'ESTIMATOR', 'ADDED'],
      ['est-2', 'ESTIMATOR', 'ADDED'],
      ['sm-1', 'ASSIGNER', 'ADDED'],
      ['hod-1', 'HEAD_OF_DIVISION', 'ADDED'],
    ]);
    expect(postsTo('/teams/team-1/members')).toHaveLength(4);
    expect(graphClient.post).toHaveBeenCalledWith('/teams/team-1/members', {
      '@odata.type': '#microsoft.graph.aadUserConversationMember',
      roles: [],
      'user@odata.bind': `${GRAPH_BASE}/users('aad-est-1')`,
    });
  });

  it('does not add a system admin who assigns', async () => {
    await buildService().syncProject({ projectId: 'p1', assignedBy: 'admin-1' });
    await settle();

    expect(memberRepo.rows.some((r) => r.userId === 'admin-1')).toBe(false);
  });

  it('does not record an inactive sales manager as assigner', async () => {
    users = users.map((u) => (u.id === 'sm-1' ? { ...u, isActive: false } : u));
    await buildService().syncProject({ projectId: 'p1', assignedBy: 'sm-1' });
    await settle();

    expect(memberRepo.rows.some((r) => r.userId === 'sm-1')).toBe(false);
  });

  it('adds a head of division who assigns once, as head of division', async () => {
    await buildService().syncProject({ projectId: 'p1', assignedBy: 'hod-1' });
    await settle();

    expect(memberRepo.rows.filter((r) => r.userId === 'hod-1').map((r) => r.reason)).toEqual(['HEAD_OF_DIVISION']);
  });

  it('adds someone who is both estimator and head of division only once', async () => {
    projects = [project('p1', ['hod-1'])];
    await buildService().syncProject({ projectId: 'p1' });
    await settle();

    expect(memberRepo.rows.filter((r) => r.userId === 'hod-1')).toHaveLength(1);
    expect(postsTo('/teams/team-1/members')).toHaveLength(1);
  });

  it('skips inactive users', async () => {
    users = users.map((u) => (u.id === 'est-2' ? { ...u, isActive: false } : u));
    await buildService().syncProject({ projectId: 'p1' });
    await settle();

    expect(memberRepo.rows.some((r) => r.userId === 'est-2')).toBe(false);
  });

  it('adds everyone to every team linked to the project', async () => {
    channels = [channel('team-1', ['p1']), channel('team-2', ['p1'])];
    projects = [project('p1', ['est-1'])];
    await buildService().syncProject({ projectId: 'p1' });
    await settle();

    expect(memberRepo.rows.map((r) => `${r.userId}@${r.teamId}`).sort()).toEqual([
      'est-1@team-1',
      'est-1@team-2',
      'hod-1@team-1',
      'hod-1@team-2',
    ]);
    // The Microsoft account lookup is cached within one pass.
    const lookups = graphClient.get.mock.calls.filter(([, params]) => params?.['$filter']?.includes('est-1@gfs.test'));
    expect(lookups).toHaveLength(1);
  });

  it('does nothing at all when the feature is switched off', async () => {
    enabled = false;
    const service = buildService();
    await service.syncProject({ projectId: 'p1', assignedBy: 'sm-1' });
    await service.sweep();
    await service.drainPending();

    expect(memberRepo.rows).toEqual([]);
    expect(graphClient.get).not.toHaveBeenCalled();
    expect(graphClient.post).not.toHaveBeenCalled();
  });
});

describe('TeamsMembershipService — projects without a team yet', () => {
  it('remembers the assigning sales manager and adds everyone once a team is linked', async () => {
    channels = [];
    const service = buildService();
    await service.syncProject({ projectId: 'p1', assignedBy: 'sm-1' });
    await settle();

    expect(memberRepo.rows.map((r) => [r.userId, r.teamId, r.status])).toEqual([['sm-1', null, 'WAITING_FOR_TEAM']]);
    expect(graphClient.post).not.toHaveBeenCalled();

    channels = [channel('team-9', ['p1'])];
    await service.sweep();
    await service.drainPending();

    expect(memberRepo.rows.filter((r) => r.teamId === 'team-9').map((r) => [r.userId, r.status])).toEqual([
      ['est-1', 'ADDED'],
      ['est-2', 'ADDED'],
      ['sm-1', 'ADDED'],
      ['hod-1', 'ADDED'],
    ]);
  });
});

describe('TeamsMembershipService — sweep (existing projects and new heads of division)', () => {
  it('backfills every active project that has a team and never duplicates on the next sweep', async () => {
    projects = [
      project('p1', ['est-1']),
      project('p2', ['est-2']),
      project('p3', ['est-1']),
      project('p4', ['est-1'], { isActive: false }),
    ];
    channels = [channel('team-1', ['p1']), channel('team-2', ['p2']), channel('team-4', ['p4'])];
    const service = buildService();

    expect(await service.sweep()).toBe(4);
    expect(await service.sweep()).toBe(0);
    expect(memberRepo.rows.map((r) => `${r.projectId}:${r.userId}`).sort()).toEqual([
      'p1:est-1',
      'p1:hod-1',
      'p2:est-2',
      'p2:hod-1',
    ]);
  });

  it('adds a newly created head of division to all project teams on the next sweep', async () => {
    projects = [project('p1', []), project('p2', [])];
    channels = [channel('team-1', ['p1']), channel('team-2', ['p2'])];
    const service = buildService();
    await service.sweep();

    users.push(user('hod-2', UserRole.HEAD_OF_DIVISION));
    tenantAccounts['hod-2@gfs.test'] = { id: 'aad-hod-2', userType: 'Member' };
    await service.sweep();
    await service.drainPending();

    expect(memberRepo.rows.filter((r) => r.userId === 'hod-2').map((r) => [r.teamId, r.status])).toEqual([
      ['team-1', 'ADDED'],
      ['team-2', 'ADDED'],
    ]);
  });

  it('never removes anyone when an estimator is unassigned', async () => {
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    projects = [project('p1', ['est-2'])];
    await service.sweep();
    await service.drainPending();

    expect(memberRepo.find('est-1')?.status).toBe('ADDED');
    expect(graphClient.delete).not.toHaveBeenCalled();
  });
});

describe('TeamsMembershipService — Microsoft Graph outcomes', () => {
  it('treats an existing membership as done', async () => {
    graphClient.post.mockRejectedValueOnce(graphError(409, 'Member already exists in the team'));
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    expect(memberRepo.find('est-1')?.status).toBe('ADDED');
  });

  it('falls back to the group API when the Teams API is not permitted', async () => {
    graphClient.post.mockImplementation(async (path: string) => {
      if (path.startsWith('/teams/')) throw graphError(403, 'Insufficient privileges');
      return { status: 204, data: {}, headers: {} };
    });
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    expect(graphClient.post).toHaveBeenCalledWith('/groups/team-1/members/$ref', {
      '@odata.id': `${GRAPH_BASE}/directoryObjects/aad-est-1`,
    });
    expect(memberRepo.find('est-1')?.status).toBe('ADDED');
  });

  it('treats "already exist" from the group fallback as done', async () => {
    graphClient.post.mockImplementation(async (path: string) => {
      if (path.startsWith('/teams/')) throw graphError(403);
      throw graphError(400, 'One or more added object references already exist for the following modified properties');
    });
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    expect(memberRepo.find('est-1')?.status).toBe('ADDED');
  });

  it('invites someone without a Microsoft account as a guest, then adds them', async () => {
    delete tenantAccounts['est-1@gfs.test'];
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    expect(graphClient.post).toHaveBeenCalledWith('/invitations', {
      invitedUserEmailAddress: 'est-1@gfs.test',
      inviteRedirectUrl: 'https://teams.microsoft.com',
      sendInvitationMessage: true,
    });
    expect(graphClient.post).toHaveBeenCalledWith('/teams/team-1/members', expect.objectContaining({
      roles: ['guest'],
      'user@odata.bind': `${GRAPH_BASE}/users('aad-guest')`,
    }));
    expect(memberRepo.find('est-1')).toMatchObject({ status: 'ADDED', invited: true, aadUserId: 'aad-guest' });
  });

  it('finds an existing guest by mail instead of inviting again', async () => {
    tenantAccounts['est-1@gfs.test'] = { id: 'aad-existing-guest', userType: 'Guest' };
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    expect(postsTo('/invitations')).toHaveLength(0);
    expect(memberRepo.find('est-1')).toMatchObject({ status: 'ADDED', invited: false, aadUserId: 'aad-existing-guest' });
  });

  it('escapes quotes in the email it looks up', async () => {
    users = [user('est-1', UserRole.ESTIMATOR, { email: "o'brien@gfs.test" })];
    tenantAccounts = { "o'brien@gfs.test": { id: 'aad-obrien', userType: 'Member' } };
    projects = [project('p1', ['est-1'])];
    const service = buildService();
    await service.sweep();
    await service.drainPending();

    expect(graphClient.get).toHaveBeenCalledWith('/users', {
      $filter: "userPrincipalName eq 'o''brien@gfs.test' or mail eq 'o''brien@gfs.test'",
      $select: 'id,userType',
    });
    expect(memberRepo.find('est-1')?.status).toBe('ADDED');
  });

  it('fails once and notifies the sales manager when guest invites are not permitted', async () => {
    delete tenantAccounts['est-1@gfs.test'];
    graphClient.post.mockImplementation(async (path: string) => {
      if (path === '/invitations') throw graphError(403, 'Insufficient privileges');
      return { status: 201, data: {}, headers: {} };
    });
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();
    const result = await service.drainPending();
    await service.drainPending();

    expect(result.failed).toBe(1);
    expect(memberRepo.find('est-1')).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(memberRepo.find('est-1')?.notifiedAt).toBeInstanceOf(Date);
    expect(notifier.notifyTeamsMemberNotAdded).toHaveBeenCalledTimes(1);
    expect(notifier.notifyTeamsMemberNotAdded).toHaveBeenCalledWith({
      projectId: 'p1',
      referenceNumber: 'GFS-2026-p1',
      projectName: 'Project p1',
      memberName: 'est-1 User',
      memberEmail: 'est-1@gfs.test',
      reason: 'No Microsoft account was found and guest invitations are not permitted (User.Invite.All).',
    });
  });

  it('retries transient errors and gives up with one notification after five attempts', async () => {
    graphClient.post.mockRejectedValue(graphError(503, 'Service unavailable'));
    projects = [project('p1', ['est-1'])];
    users = users.filter((u) => u.role !== UserRole.HEAD_OF_DIVISION);
    const service = buildService();
    await service.sweep();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await service.drainPending();
      expect(memberRepo.find('est-1')).toMatchObject({ status: 'PENDING', attempts: attempt });
    }
    await service.drainPending();

    expect(memberRepo.find('est-1')).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'Service unavailable' });
    expect(notifier.notifyTeamsMemberNotAdded).toHaveBeenCalledTimes(1);
  });

  it('stops the pass when Microsoft throttles, without spending an attempt', async () => {
    graphClient.post.mockRejectedValueOnce(graphError(429, 'Too many requests'));
    const service = buildService();
    await service.sweep();
    const result = await service.drainPending();

    expect(result.added).toBe(0);
    expect(memberRepo.rows.every((r) => r.status === 'PENDING' && r.attempts === 0)).toBe(true);
    expect(graphClient.post).toHaveBeenCalledTimes(1);

    await service.drainPending();
    expect(memberRepo.rows.every((r) => r.status === 'ADDED')).toBe(true);
  });

  it('skips a row whose user was deactivated before it was processed', async () => {
    projects = [project('p1', ['est-1'])];
    const service = buildService();
    await service.sweep();
    users = users.map((u) => (u.id === 'est-1' ? { ...u, isActive: false } : u));
    await service.drainPending();

    expect(memberRepo.find('est-1')?.status).toBe('SKIPPED');
    expect(graphClient.get.mock.calls.some(([, params]) => params?.['$filter']?.includes('est-1@'))).toBe(false);
  });
});

describe('TeamsMembershipService — never breaks the caller', () => {
  it('swallows repository failures in syncProject', async () => {
    memberRepo.ensureMany = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(buildService().syncProject({ projectId: 'p1', assignedBy: 'sm-1' })).resolves.toBeUndefined();
  });

  it('runs one drain at a time and reruns once when kicked during a pass', async () => {
    const service = buildService();
    await service.sweep();
    const listRunnable = jest.spyOn(memberRepo, 'listRunnable');

    const first = service.drainPending();
    const second = await service.drainPending();
    await first;

    expect(second).toEqual({ processed: 0, added: 0, skipped: 0, failed: 0 });
    expect(listRunnable).toHaveBeenCalledTimes(2);
    expect(memberRepo.rows.every((r) => r.status === 'ADDED')).toBe(true);
  });
});
