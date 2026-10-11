jest.mock('@config/index', () => ({
  env: { teams: { pollingEnabled: true, pollCatchupMs: 1000, pollIntervalMs: 60_000 } },
}));

import { startTeamsPoller } from '@features/teams/teams.poller';
import type { TeamsService } from '@features/teams/teams.service';
import type { TeamsProvisioningService } from '@features/teams/teams-provisioning.service';
import type { TeamsMembershipService } from '@features/teams/teams-membership.service';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe('startTeamsPoller — team membership', () => {
  let timer: NodeJS.Timeout | null = null;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });

  it('sweeps then drains membership after channel sync and provisioning', async () => {
    const calls: string[] = [];
    const teamsService = { syncAll: jest.fn(async () => { calls.push('sync'); return { channels: [], errors: [] }; }) };
    const provisioning = { drainPending: jest.fn(async () => { calls.push('provision'); }) };
    const membership = {
      sweep: jest.fn(async () => { calls.push('sweep'); return 0; }),
      drainPending: jest.fn(async () => { calls.push('drain'); }),
    };

    timer = startTeamsPoller(
      teamsService as unknown as TeamsService,
      provisioning as unknown as TeamsProvisioningService,
      membership as unknown as TeamsMembershipService,
    );
    await settle();

    expect(calls).toEqual(['sync', 'provision', 'sweep', 'drain']);
  });

  it('keeps polling when the membership sweep fails', async () => {
    const teamsService = { syncAll: jest.fn().mockResolvedValue({ channels: [], errors: [] }) };
    const membership = { sweep: jest.fn().mockRejectedValue(new Error('graph down')), drainPending: jest.fn() };

    timer = startTeamsPoller(
      teamsService as unknown as TeamsService,
      undefined,
      membership as unknown as TeamsMembershipService,
    );
    await settle();

    expect(membership.drainPending).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('membership sync failed'));
  });
});
