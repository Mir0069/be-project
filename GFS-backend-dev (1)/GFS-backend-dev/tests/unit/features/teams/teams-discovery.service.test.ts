import { TeamsDiscoveryService, type ITeamsDirectory } from '@features/teams/teams-discovery.service';
import type { GraphChannel, GraphTeam } from '@features/teams/teams.types';

const team = (id: string, displayName: string): GraphTeam => ({ id, displayName });
const channel = (id: string, displayName: string): GraphChannel => ({ id, displayName });

const buildDirectory = (
  teams: GraphTeam[],
  channelsByTeam: Record<string, GraphChannel[]>,
): jest.Mocked<ITeamsDirectory> => ({
  listTeams: jest.fn().mockResolvedValue(teams),
  listChannels: jest.fn(async (teamId: string) => channelsByTeam[teamId] ?? [channel(`${teamId}-c`, 'General')]),
});

describe('TeamsDiscoveryService.findCandidates', () => {
  it('returns the matching team/channel pair, best first, capped at 3', () => {
    const teams = [
      team('t1', 'GFS - 21 Evergreen Terrace'),
      team('t2', '21 Evergreen Ter'),
      team('t3', 'Evergreen Terrace Works'),
      team('t4', '71 Evergreen Terrace'),
    ];
    const directory = buildDirectory(teams, {
      t1: [channel('c1', '21 Evergreen Terrace discussion')],
      t2: [channel('c2', '21 Evergreen Ter discussion')],
      t3: [channel('c3', 'Evergreen Terrace')],
      t4: [channel('c4', '71 Evergreen Terrace discussion')],
    });

    return new TeamsDiscoveryService(directory).findCandidates('21 Evergreen Terrace').then((candidates) => {
      expect(candidates.length).toBeLessThanOrEqual(3);
      expect(candidates.map((c) => c.channelId)).not.toContain('c4');
      expect(candidates.map((c) => c.score)).toEqual([...candidates.map((c) => c.score)].sort((a, b) => b - a));
      expect(candidates[0]!.reason).toBe('team-and-channel');
    });
  });

  it('finds a channel inside a generically named team', async () => {
    const directory = buildDirectory([team('t1', 'Sales'), team('t2', 'Marketing')], {
      t1: [channel('c1', 'General'), channel('c2', '10208 Van Thompson Rd')],
      t2: [channel('c3', 'General')],
    });

    const candidates = await new TeamsDiscoveryService(directory).findCandidates('10208 Van Thompson Road');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ teamId: 't1', channelId: 'c2', reason: 'channel-name' });
  });

  it('surfaces a matching team whose channels are all generic', async () => {
    const directory = buildDirectory([team('t1', '182 Robinson Street')], {
      t1: [channel('c1', 'General'), channel('c2', 'Random')],
    });

    const candidates = await new TeamsDiscoveryService(directory).findCandidates('182 Robinson St');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ channelId: 'c1', reason: 'team-name' });
  });

  it('returns nothing when no team or channel matches', async () => {
    const directory = buildDirectory([team('t1', 'Marketing')], { t1: [channel('c1', 'General')] });
    await expect(new TeamsDiscoveryService(directory).findCandidates('182 Robinson St')).resolves.toEqual([]);
  });

  it('returns nothing for a blank project name without calling Graph', async () => {
    const directory = buildDirectory([team('t1', 'Anything')], {});
    await expect(new TeamsDiscoveryService(directory).findCandidates('   ')).resolves.toEqual([]);
    expect(directory.listTeams).not.toHaveBeenCalled();
  });

  it('scans every team when the tenant is small', async () => {
    const teams = Array.from({ length: 10 }, (_, i) => team(`t${i}`, `Team ${i}`));
    const directory = buildDirectory(teams, {});

    await new TeamsDiscoveryService(directory).findCandidates('182 Robinson St');

    expect(directory.listTeams).toHaveBeenCalledTimes(1);
    expect(directory.listChannels).toHaveBeenCalledTimes(10);
  });

  it('caps the channel scan at 25 teams and keeps the best-scoring ones', async () => {
    const teams = Array.from({ length: 200 }, (_, i) => team(`t${i}`, `Unrelated Team ${i}`));
    teams.push(team('match', '182 Robinson Street'));
    const directory = buildDirectory(teams, { match: [channel('cm', '182 Robinson St discussion')] });

    const candidates = await new TeamsDiscoveryService(directory).findCandidates('182 Robinson St');

    expect(directory.listChannels).toHaveBeenCalledTimes(25);
    expect(directory.listChannels).toHaveBeenCalledWith('match');
    expect(candidates[0]!.channelId).toBe('cm');
  });

  it('caches the directory so a second discovery issues no new team listing', async () => {
    const directory = buildDirectory([team('t1', '182 Robinson Street')], {
      t1: [channel('c1', '182 Robinson St discussion')],
    });
    const service = new TeamsDiscoveryService(directory);

    await service.findCandidates('182 Robinson St');
    await service.findCandidates('182 Robinson St');

    expect(directory.listTeams).toHaveBeenCalledTimes(1);
    expect(directory.listChannels).toHaveBeenCalledTimes(1);
  });

  it('skips a team whose channels cannot be read', async () => {
    const directory = buildDirectory([team('bad', '182 Robinson Street'), team('good', '182 Robinson St Site')], {
      good: [channel('cg', '182 Robinson St discussion')],
    });
    directory.listChannels.mockImplementation(async (teamId: string) => {
      if (teamId === 'bad') throw new Error('403 Forbidden');
      return [channel('cg', '182 Robinson St discussion')];
    });

    const candidates = await new TeamsDiscoveryService(directory).findCandidates('182 Robinson St');

    expect(candidates.map((c) => c.teamId)).toEqual(['good']);
  });

  it('propagates a team-listing failure so the job can retry', async () => {
    const directory = buildDirectory([], {});
    directory.listTeams.mockRejectedValue(new Error('429 Too Many Requests'));

    await expect(new TeamsDiscoveryService(directory).findCandidates('182 Robinson St')).rejects.toThrow(
      '429 Too Many Requests',
    );
  });
});
