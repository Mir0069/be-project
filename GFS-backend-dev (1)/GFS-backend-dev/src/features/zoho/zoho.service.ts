import axios, { AxiosError, type AxiosInstance } from 'axios';
import { StatusCodes } from 'http-status-codes';

import { env } from '@config/index';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type { IZohoTokenRepository } from '@repositories/interfaces/i-zoho-token.repository';

import type { ZohoStoredToken, ZohoTokenResponse } from './zoho.types';

const DEFAULT_ACCOUNT_KEY = 'default';
const EXPIRY_SAFETY_WINDOW_MS = 60 * 1000;

export interface ZohoNote {
  id: string | null;
  title: string | null;
  content: string | null;
  author: string | null;
  authorEmail: string | null;
  createdTime: string | null;
  // Zoho stamps this on the note itself and moves it when the note is edited,
  // so it is the only way to date a change to existing text: Created_Time stays
  // frozen at the original write.
  modifiedTime: string | null;
}

// Zoho caps a page at 200 records. Ten pages is far beyond any realistic lead,
// and stops a bad `more_records` from looping forever.
const NOTES_PAGE_SIZE = 200;
const NOTES_MAX_PAGES = 10;

const stripHtml = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length ? text : null;
};

export class ZohoService {
  private readonly tokenRepository: IZohoTokenRepository;
  /** Zoho login email -> user id. null records a lookup that found nobody. */
  private readonly userIdByEmail = new Map<string, string | null>();

  public constructor(tokenRepository: IZohoTokenRepository) {
    this.tokenRepository = tokenRepository;
  }

  public buildAuthorizeUrl(state?: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.zoho.clientId,
      scope: env.zoho.scopes,
      redirect_uri: env.zoho.redirectUri,
      access_type: 'offline',
      prompt: 'consent',
    });
    if (state) params.set('state', state);
    return `${env.zoho.accountsUrl}/oauth/v2/auth?${params.toString()}`;
  }

  public async exchangeCodeForToken(
    code: string,
    accountsServer?: string,
    redirectUri?: string,
  ): Promise<ZohoTokenResponse> {
    const accountsUrl = accountsServer ?? env.zoho.accountsUrl;
    const candidateUris = [
      redirectUri,
      env.zoho.redirectUri,
      'http://localhost:3000/api/v1/zoho/callback',
      'http://localhost:3000/zoho/callback',
      'http://localhost:3000/callback',
    ].filter((uri, idx, arr): uri is string => Boolean(uri) && arr.indexOf(uri) === idx);

    let lastError: any = null;

    for (const candidate of candidateUris) {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.zoho.clientId,
        client_secret: env.zoho.clientSecret,
        redirect_uri: candidate,
        code,
      });

      try {
        const response = await axios.post<ZohoTokenResponse>(
          `${accountsUrl}/oauth/v2/token`,
          params.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );

        if ((response.data as any)?.error) {
          lastError = new Error(String((response.data as any).error));
          continue;
        }

        if (!response.data.access_token || !response.data.refresh_token) {
          throw new AppError(
            'Zoho did not return a refresh token. Re-run the auth flow with prompt=consent.',
            StatusCodes.BAD_GATEWAY,
            true,
            { code: ErrorCode.SERVICE_UNAVAILABLE, details: response.data },
          );
        }

        return response.data;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError instanceof AppError) throw lastError;
    const axiosErr = lastError as AxiosError;
    throw new AppError(
      'Failed to exchange Zoho authorization code',
      StatusCodes.BAD_GATEWAY,
      true,
      { code: ErrorCode.SERVICE_UNAVAILABLE, details: axiosErr?.response?.data ?? axiosErr?.message },
    );
  }

  public async refreshAccessToken(
    refreshToken: string,
    accountsServer?: string,
  ): Promise<ZohoTokenResponse> {
    const accountsUrl = accountsServer ?? env.zoho.accountsUrl;
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.zoho.clientId,
      client_secret: env.zoho.clientSecret,
      refresh_token: refreshToken,
    });

    const urlsToTry = [accountsUrl, 'https://accounts.zoho.in', 'https://accounts.zoho.com'];
    let lastError: any = null;

    for (const url of Array.from(new Set(urlsToTry))) {
      try {
        const response = await axios.post<ZohoTokenResponse>(
          `${url}/oauth/v2/token`,
          params.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );
        if (response.data.access_token) {
          return response.data;
        }
      } catch (err) {
        lastError = err;
      }
    }

    const axiosErr = lastError as AxiosError;
    throw new AppError(
      'Failed to refresh Zoho access token',
      StatusCodes.BAD_GATEWAY,
      true,
      { code: ErrorCode.SERVICE_UNAVAILABLE, details: axiosErr?.response?.data ?? axiosErr?.message },
    );
  }

  public async persistToken(
    token: ZohoTokenResponse,
    accountKey = DEFAULT_ACCOUNT_KEY,
    existingRefreshToken?: string,
  ): Promise<ZohoStoredToken> {
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    const refreshToken = token.refresh_token ?? existingRefreshToken;

    if (!refreshToken) {
      throw new AppError(
        'No refresh token available to persist',
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    return this.tokenRepository.upsertToken(accountKey, {
      accessToken: token.access_token,
      refreshToken,
      apiDomain: token.api_domain ?? env.zoho.apiDomain,
      scope: token.scope,
      expiresAt,
    });
  }

  public async getValidAccessToken(accountKey = DEFAULT_ACCOUNT_KEY): Promise<ZohoStoredToken> {
    const stored = await this.tokenRepository.findByAccountKey(accountKey);

    if (!stored) {
      throw new AppError(
        'Zoho is not connected yet. Visit /zoho/auth to authorize.',
        StatusCodes.UNAUTHORIZED,
        true,
        { code: ErrorCode.UNAUTHORIZED },
      );
    }

    const isExpired = stored.expiresAt.getTime() - EXPIRY_SAFETY_WINDOW_MS <= Date.now();
    if (!isExpired) return stored;

    const refreshed = await this.refreshAccessToken(stored.refreshToken);
    return this.persistToken(refreshed, accountKey, stored.refreshToken);
  }

  private buildClient(token: ZohoStoredToken): AxiosInstance {
    return axios.create({
      baseURL: token.apiDomain || env.zoho.apiDomain,
      headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}` },
    });
  }

  public async fetchFromZoho<T>(
    path: string,
    params?: Record<string, string | undefined>,
    accountKey = DEFAULT_ACCOUNT_KEY,
  ): Promise<T> {
    const token = await this.getValidAccessToken(accountKey);
    if (token.accessToken === 'mock-local-token') {
      return { data: [] } as T;
    }
    const client = this.buildClient(token);

    try {
      const response = await client.get<T>(path, { params });
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      throw new AppError(
        `Zoho request failed for ${path}`,
        axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
        true,
        { code: ErrorCode.SERVICE_UNAVAILABLE, details: axiosErr.response?.data ?? axiosErr.message },
      );
    }
  }

  public async insertIntoZoho<T>(
    path: string,
    payload: unknown,
    accountKey = DEFAULT_ACCOUNT_KEY,
  ): Promise<T> {
    const token = await this.getValidAccessToken(accountKey);
    if (token.accessToken === 'mock-local-token') {
      return { data: [{ code: 'SUCCESS', details: { id: `mock_zoho_${Date.now()}` } }] } as T;
    }
    const client = this.buildClient(token);

    try {
      const response = await client.post<T>(path, payload);
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      throw new AppError(
        `Zoho insert failed for ${path}`,
        axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
        true,
        { code: ErrorCode.SERVICE_UNAVAILABLE, details: axiosErr.response?.data ?? axiosErr.message },
      );
    }
  }

  public async updateInZoho<T>(
    path: string,
    payload: unknown,
    accountKey = DEFAULT_ACCOUNT_KEY,
  ): Promise<T> {
    const token = await this.getValidAccessToken(accountKey);
    if (token.accessToken === 'mock-local-token') {
      return { data: [{ code: 'SUCCESS' }] } as T;
    }
    const client = this.buildClient(token);

    try {
      const response = await client.put<T>(path, payload);
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      throw new AppError(
        `Zoho update failed for ${path}`,
        axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
        true,
        { code: ErrorCode.SERVICE_UNAVAILABLE, details: axiosErr.response?.data ?? axiosErr.message },
      );
    }
  }

  public async deleteFromZoho<T>(path: string, accountKey = DEFAULT_ACCOUNT_KEY): Promise<T> {
    const token = await this.getValidAccessToken(accountKey);
    if (token.accessToken === 'mock-local-token') {
      return { data: [{ code: 'SUCCESS' }] } as T;
    }
    const client = this.buildClient(token);

    try {
      const response = await client.delete<T>(path);
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      throw new AppError(
        `Zoho delete failed for ${path}`,
        axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
        true,
        { code: ErrorCode.SERVICE_UNAVAILABLE, details: axiosErr.response?.data ?? axiosErr.message },
      );
    }
  }

  /**
   * Zoho user id for a login email, or null when no active user matches.
   * Records are owned by user id, but an id is tenant-specific and unreadable,
   * so config names people by email and this resolves it. Cached per process:
   * the mapping only changes when someone joins or leaves the CRM.
   */
  public async resolveUserIdByEmail(
    email: string,
    accountKey = DEFAULT_ACCOUNT_KEY,
  ): Promise<string | null> {
    const key = email.trim().toLowerCase();
    if (!key) return null;
    if (this.userIdByEmail.has(key)) return this.userIdByEmail.get(key)!;

    const response = await this.fetchFromZoho<{
      users?: Array<{ id?: string; email?: string; status?: string }>;
    }>('/crm/v2/users', { type: 'ActiveUsers' }, accountKey);

    const match = (response.users ?? []).find(
      (user) => (user.email ?? '').trim().toLowerCase() === key,
    );
    const id = match?.id ?? null;
    this.userIdByEmail.set(key, id);
    return id;
  }

  /**
   * Every note on a lead, oldest first, so the most recent instruction reads last.
   *
   * Errors are swallowed: a Zoho outage must not break the Notes tab. A failure
   * part-way through pagination returns the pages fetched so far rather than
   * nothing, which callers must treat as possibly-incomplete.
   */
  public async fetchLeadNotes(zohoLeadId: string, accountKey = DEFAULT_ACCOUNT_KEY): Promise<ZohoNote[]> {
    const notes: ZohoNote[] = [];

    try {
      for (let page = 1; page <= NOTES_MAX_PAGES; page += 1) {
        const resp = await this.fetchFromZoho<{
          data?: Array<Record<string, unknown>>;
          info?: { more_records?: boolean };
        }>(
          `/crm/v2/Leads/${zohoLeadId}/Notes`,
          {
            page: String(page),
            per_page: String(NOTES_PAGE_SIZE),
            sort_by: 'Created_Time',
            sort_order: 'asc',
          },
          accountKey,
        );

        const rows = typeof resp === 'object' && resp !== null ? (resp.data ?? []) : [];
        for (const n of rows) {
          // Created_By is the person who wrote the note. Owner is the lead's
          // owner, which is often someone else, so it is only a name fallback
          // and is never used for the email.
          const createdBy = (n['Created_By'] ?? null) as { name?: string; email?: string } | null;
          const owner = (n['Owner'] ?? null) as { name?: string } | null;
          notes.push({
            id: n['id'] ? String(n['id']) : null,
            title: (n['Note_Title'] as string | null) ?? null,
            content: stripHtml(n['Note_Content']),
            author: createdBy?.name ?? owner?.name ?? null,
            authorEmail: createdBy?.email ?? null,
            createdTime: (n['Created_Time'] as string | null) ?? null,
            modifiedTime: (n['Modified_Time'] as string | null) ?? null,
          });
        }

        const more = typeof resp === 'object' && resp !== null ? resp.info?.more_records : false;
        if (!more || rows.length === 0) break;
      }
    } catch {
      return notes;
    }

    return notes;
  }
}
