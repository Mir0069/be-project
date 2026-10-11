const KEY = 'TEAMS_AUTO_ADD_MEMBERS_ENABLED';

// Re-reads config from scratch so each case sees its own process.env value.
const loadFlag = (): boolean => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@config/index').env.teams.autoAddMembersEnabled as boolean;
};

describe('env.teams.autoAddMembersEnabled', () => {
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
    jest.resetModules();
  });

  it('is ON when the variable is not set, so no env change is needed to enable it', () => {
    delete process.env[KEY];
    expect(loadFlag()).toBe(true);
  });

  it('is OFF only for an explicit "false"', () => {
    process.env[KEY] = 'false';
    expect(loadFlag()).toBe(false);
  });

  it('ignores case when disabling', () => {
    process.env[KEY] = 'FALSE';
    expect(loadFlag()).toBe(false);
  });

  it('stays ON for an empty or unrecognised value', () => {
    process.env[KEY] = '';
    expect(loadFlag()).toBe(true);
    process.env[KEY] = 'yes';
    expect(loadFlag()).toBe(true);
  });
});
