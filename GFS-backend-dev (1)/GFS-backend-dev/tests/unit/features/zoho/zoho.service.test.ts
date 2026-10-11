import axios from 'axios';

import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import type { IZohoTokenRepository } from '@repositories/interfaces/i-zoho-token.repository';
import { ZohoService } from '@features/zoho/zoho.service';
import type { ZohoStoredToken } from '@features/zoho/zoho.types';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeValidToken = (overrides: Partial<ZohoStoredToken> = {}): ZohoStoredToken => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  apiDomain: 'https://www.zohoapis.in',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  scope: 'ZohoCRM.modules.ALL',
  ...overrides,
});

let zohoService: ZohoService;
let mockTokenRepo: jest.Mocked<IZohoTokenRepository>;

beforeEach(() => {
  mockTokenRepo = {
    findByAccountKey: jest.fn(),
    upsertToken: jest.fn(),
  };
  zohoService = new ZohoService(mockTokenRepo);
});

describe('ZohoService — buildAuthorizeUrl', () => {
  it('builds an authorize URL with the right params', () => {
    const url = zohoService.buildAuthorizeUrl('xyz-state');

    expect(url).toContain('/oauth/v2/auth');
    expect(url).toContain('response_type=code');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('state=xyz-state');
    expect(url).toContain(`client_id=${encodeURIComponent(env.zoho.clientId)}`);
  });

  it('omits state param when not provided', () => {
    const url = zohoService.buildAuthorizeUrl();
    expect(url).not.toContain('state=');
  });
});

describe('ZohoService — exchangeCodeForToken', () => {
  it('returns tokens on success', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        api_domain: 'https://www.zohoapis.in',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });

    const result = await zohoService.exchangeCodeForToken('auth-code');

    expect(result.access_token).toBe('access-1');
    expect(result.refresh_token).toBe('refresh-1');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/oauth/v2/token'),
      expect.stringContaining('grant_type=authorization_code'),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
  });

  it('uses accountsServer override when provided', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'a',
        refresh_token: 'r',
        api_domain: 'https://www.zohoapis.com',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });

    await zohoService.exchangeCodeForToken('code', 'https://accounts.zoho.com');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://accounts.zoho.com/oauth/v2/token',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('throws AppError when refresh_token is missing', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'a', api_domain: 'x', token_type: 'Bearer', expires_in: 3600 },
    });

    await expect(zohoService.exchangeCodeForToken('code')).rejects.toBeInstanceOf(AppError);
  });

  it('wraps axios errors as AppError', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: 'invalid_code' }, status: 400 },
      message: 'Request failed',
    });

    await expect(zohoService.exchangeCodeForToken('bad-code')).rejects.toBeInstanceOf(AppError);
  });
});

describe('ZohoService — refreshAccessToken', () => {
  it('calls token endpoint with refresh_token grant', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'new-access',
        api_domain: 'https://www.zohoapis.in',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });

    const result = await zohoService.refreshAccessToken('old-refresh');

    expect(result.access_token).toBe('new-access');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/oauth/v2/token'),
      expect.stringContaining('grant_type=refresh_token'),
      expect.any(Object),
    );
    expect(mockedAxios.post.mock.calls[0]?.[1]).toContain('refresh_token=old-refresh');
  });

  it('wraps refresh errors as AppError', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 401 }, message: 'unauth' });
    await expect(zohoService.refreshAccessToken('bad')).rejects.toBeInstanceOf(AppError);
  });
});

describe('ZohoService — getValidAccessToken', () => {
  it('throws UNAUTHORIZED when nothing is stored', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(null);

    await expect(zohoService.getValidAccessToken()).rejects.toBeInstanceOf(AppError);
  });

  it('returns the stored token when not expired', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(makeValidToken({ accessToken: 'still-good' }));

    const result = await zohoService.getValidAccessToken();

    expect(result.accessToken).toBe('still-good');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refreshes and persists when token is expired', async () => {
    const past = new Date(Date.now() - 60 * 1000);
    mockTokenRepo.findByAccountKey.mockResolvedValue(
      makeValidToken({ accessToken: 'expired', refreshToken: 'refresh-keep', expiresAt: past }),
    );

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'fresh-access',
        api_domain: 'https://www.zohoapis.in',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });

    mockTokenRepo.upsertToken.mockResolvedValue(
      makeValidToken({
        accessToken: 'fresh-access',
        refreshToken: 'refresh-keep',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      }),
    );

    const result = await zohoService.getValidAccessToken();

    expect(result.accessToken).toBe('fresh-access');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockTokenRepo.upsertToken).toHaveBeenCalledTimes(1);
  });
});

describe('ZohoService — fetchFromZoho', () => {
  it('passes the bearer token and returns response data', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(makeValidToken());

    const get = jest.fn().mockResolvedValue({ data: { data: [{ id: '1', Name: 'Acme' }] } });
    mockedAxios.create.mockReturnValueOnce({ get } as never);

    const result = await zohoService.fetchFromZoho<{ data: Array<{ id: string }> }>(
      '/crm/v2/Leads',
      { page: '1' },
    );

    expect(result.data[0]?.id).toBe('1');
    // buildClient uses the sandbox domain when ZOHO_USE_SANDBOX is on, else the
    // token's own apiDomain — assert whichever the current env selects.
    expect(mockedAxios.create).toHaveBeenCalledWith({
      baseURL: env.zoho.useSandbox ? env.zoho.apiDomain : 'https://www.zohoapis.in',
      headers: { Authorization: 'Zoho-oauthtoken access' },
    });
    expect(get).toHaveBeenCalledWith('/crm/v2/Leads', { params: { page: '1' } });
  });

  it('wraps zoho errors as AppError preserving status', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(makeValidToken());

    const get = jest.fn().mockRejectedValue({
      response: { status: 404, data: { code: 'INVALID_MODULE' } },
      message: 'Not found',
    });
    mockedAxios.create.mockReturnValueOnce({ get } as never);

    await expect(zohoService.fetchFromZoho('/crm/v2/Bogus')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('ZohoService — insertIntoZoho', () => {
  it('POSTs the payload and returns response data', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(makeValidToken());

    const post = jest.fn().mockResolvedValue({
      data: {
        data: [{ code: 'SUCCESS', details: { id: '999000000111111' }, status: 'success' }],
      },
    });
    mockedAxios.create.mockReturnValueOnce({ post } as never);

    const payload = {
      data: [{ Last_Name: 'Doe', First_Name: 'John', Email: 'john@example.com' }],
      trigger: ['workflow'],
    };

    const result = await zohoService.insertIntoZoho<{ data: Array<{ status: string }> }>(
      '/crm/v2/Leads',
      payload,
    );

    expect(result.data[0]?.status).toBe('success');
    expect(post).toHaveBeenCalledWith('/crm/v2/Leads', payload);
  });

  it('wraps zoho insert errors as AppError', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(makeValidToken());

    const post = jest.fn().mockRejectedValue({
      response: { status: 400, data: { code: 'INVALID_DATA' } },
      message: 'Bad payload',
    });
    mockedAxios.create.mockReturnValueOnce({ post } as never);

    await expect(
      zohoService.insertIntoZoho('/crm/v2/Leads', { data: [{}] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses to insert when no token is stored', async () => {
    mockTokenRepo.findByAccountKey.mockResolvedValue(null);

    await expect(
      zohoService.insertIntoZoho('/crm/v2/Leads', { data: [{ Last_Name: 'X' }] }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
