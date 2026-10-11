import axios from 'axios';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import { TeamsTokenService, type TeamsAuthConfig } from '@features/teams/teams-token.service';
import type { ITeamsTokenRepository } from '@repositories/interfaces/i-teams-token.repository';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const config: TeamsAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  tenantId: 'tenant-id',
  authority: 'https://login.microsoftonline.com',
  scope: 'https://graph.microsoft.com/.default',
};

let repo: jest.Mocked<ITeamsTokenRepository>;
let service: TeamsTokenService;

beforeEach(() => {
  repo = { findToken: jest.fn(), upsertToken: jest.fn() };
  service = new TeamsTokenService(repo, config);
});

describe('TeamsTokenService — fetchToken', () => {
  it('requests a client-credentials token from the tenant token endpoint', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { token_type: 'Bearer', expires_in: 3600, access_token: 'graph-token' },
    });

    const result = await service.fetchToken();

    expect(result.access_token).toBe('graph-token');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
      expect.stringContaining('grant_type=client_credentials'),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(mockedAxios.post.mock.calls[0]?.[1]).toContain('scope=');
  });

  it('wraps transport errors as AppError', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 401, data: { error: 'invalid_client' } },
      message: 'Unauthorized',
    });

    await expect(service.fetchToken()).rejects.toBeInstanceOf(AppError);
  });

  it('throws TEAMS_NOT_CONFIGURED when credentials are missing', async () => {
    const unconfigured = new TeamsTokenService(repo, { ...config, clientId: '' });

    await expect(unconfigured.fetchToken()).rejects.toMatchObject({
      code: ErrorCode.TEAMS_NOT_CONFIGURED,
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe('TeamsTokenService — getValidAccessToken', () => {
  it('returns the cached token when it is still valid', async () => {
    repo.findToken.mockResolvedValue({
      accessToken: 'cached-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const token = await service.getValidAccessToken();

    expect(token).toBe('cached-token');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('fetches and caches a new token when none is stored', async () => {
    repo.findToken.mockResolvedValue(null);
    mockedAxios.post.mockResolvedValueOnce({
      data: { token_type: 'Bearer', expires_in: 3600, access_token: 'fresh-token' },
    });
    repo.upsertToken.mockImplementation(async (_key, fields) => fields);

    const token = await service.getValidAccessToken();

    expect(token).toBe('fresh-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(repo.upsertToken).toHaveBeenCalledTimes(1);
  });

  it('refetches when the cached token is within the safety window', async () => {
    repo.findToken.mockResolvedValue({
      accessToken: 'about-to-expire',
      expiresAt: new Date(Date.now() + 30 * 1000), // inside the 60s safety window
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: { token_type: 'Bearer', expires_in: 3600, access_token: 'renewed-token' },
    });
    repo.upsertToken.mockImplementation(async (_key, fields) => fields);

    const token = await service.getValidAccessToken();

    expect(token).toBe('renewed-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});

describe('TeamsTokenService — isConfigured', () => {
  it('reflects whether all three credentials are present', () => {
    expect(service.isConfigured()).toBe(true);
    expect(new TeamsTokenService(repo, { ...config, tenantId: '' }).isConfigured()).toBe(false);
  });
});
