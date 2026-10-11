import { buildTeamsNames, resolveProjectDisplayName } from '@features/teams/teams-provisioning.util';

describe('buildTeamsNames', () => {
  it('builds "GFS - {name}" team and "{name} discussion" channel', () => {
    const { teamName, channelName } = buildTeamsNames('182 Robinson St');
    expect(teamName).toBe('GFS - 182 Robinson St');
    expect(channelName).toBe('182 Robinson St discussion');
  });

  it('trims surrounding whitespace on the project name', () => {
    const { teamName, channelName } = buildTeamsNames('  Maple Ave  ');
    expect(teamName).toBe('GFS - Maple Ave');
    expect(channelName).toBe('Maple Ave discussion');
  });

  it('falls back to "Untitled Project" for a blank name', () => {
    const { teamName, channelName } = buildTeamsNames('   ');
    expect(teamName).toBe('GFS - Untitled Project');
    expect(channelName).toBe('Untitled Project discussion');
  });

  it('truncates the channel name to Graph\'s 50-char limit', () => {
    const longName = 'A'.repeat(80);
    const { channelName } = buildTeamsNames(longName);
    expect(channelName.length).toBeLessThanOrEqual(50);
    expect(channelName.endsWith(' discussion')).toBe(true);
  });
});

describe('resolveProjectDisplayName', () => {
  it('prefers the project name shown in the UI', () => {
    expect(resolveProjectDisplayName({ projectName: '182 Robinson St', jobAddress: '7 Maple Ave' })).toBe(
      '182 Robinson St',
    );
  });

  it('falls back to the job address when the name is blank', () => {
    expect(resolveProjectDisplayName({ projectName: '   ', jobAddress: '7 Maple Ave' })).toBe('7 Maple Ave');
  });

  it('falls back to "Untitled Project" when both are empty', () => {
    expect(resolveProjectDisplayName({ projectName: '', jobAddress: null })).toBe('Untitled Project');
  });
});
