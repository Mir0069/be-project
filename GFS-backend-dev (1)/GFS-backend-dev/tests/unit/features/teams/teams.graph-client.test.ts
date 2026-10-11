import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { TeamsTokenService } from '@features/teams/teams-token.service';


describe('TeamsGraphClient — resolveUserId (#9 meeting lookup by user GUID)', () => {
  const GUID = '52e28627-d697-4f2f-8190-6f178e6a66cc';

  const makeClient = (): TeamsGraphClient =>
    new TeamsGraphClient({} as TeamsTokenService, 'https://graph.microsoft.com/v1.0');

  it('passes a bare GUID straight through without querying /users', async () => {
    const client = makeClient();
    const getSpy = jest.spyOn(client, 'get');

    await expect(client.resolveUserId(GUID)).resolves.toBe(GUID);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('resolves a UPN/email to its object-id via /users?$select=id', async () => {
    const client = makeClient();
    const getSpy = jest.spyOn(client, 'get').mockResolvedValue({ id: GUID } as never);

    await expect(client.resolveUserId('gfs2@amberflux.in')).resolves.toBe(GUID);
    expect(getSpy).toHaveBeenCalledWith('/users/gfs2%40amberflux.in', { $select: 'id' });
  });

  it('caches the lookup — a repeated UPN does not re-query /users', async () => {
    const client = makeClient();
    const getSpy = jest.spyOn(client, 'get').mockResolvedValue({ id: GUID } as never);

    await client.resolveUserId('gfs2@amberflux.in');
    await client.resolveUserId('gfs2@amberflux.in');

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the given identifier when /users returns no id', async () => {
    const client = makeClient();
    jest.spyOn(client, 'get').mockResolvedValue({} as never);

    await expect(client.resolveUserId('ghost@amberflux.in')).resolves.toBe('ghost@amberflux.in');
  });
});


