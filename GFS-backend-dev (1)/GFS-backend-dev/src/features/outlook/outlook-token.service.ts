import axios, { AxiosError } from 'axios';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type {
  IOutlookStoredToken,
  IOutlookTokenRepository,
} from '@repositories/interfaces/i-outlook-token.repository';

import type { GraphTokenResponse } from './outlook.types';

const DEFAULT_TOKEN_KEY = 'default';
const EXPIRY_SAFETY_WINDOW_MS = 60 * 1000;

export interface OutlookAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  authority: string;
  scope: string;
  redirectUri?: string;
}

const DELEGATED_SCOPES = 'offline_access Mail.Read Mail.ReadWrite User.Read';

/**
 * Manages Microsoft Graph access tokens for Outlook mail integration.
 * Supports both:
 * 1. Delegated tokens (OAuth2 authorization code flow with refresh tokens) for personal / user mailboxes.
 * 2. App-only tokens (client_credentials) for organization / enterprise daemons.
 */
export class OutlookTokenService {
  private readonly tokenRepository: IOutlookTokenRepository;
  private readonly config: OutlookAuthConfig;

  public constructor(tokenRepository: IOutlookTokenRepository, config: OutlookAuthConfig) {
    this.tokenRepository = tokenRepository;
    this.config = config;
  }

  public isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.tenantId);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError(
        'Outlook integration is not configured. Set OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET and OUTLOOK_TENANT_ID (or the TEAMS_* equivalents).',
        StatusCodes.SERVICE_UNAVAILABLE,
        true,
        { code: ErrorCode.OUTLOOK_NOT_CONFIGURED },
      );
    }
  }

  public getAuthUrl(redirectUri?: string, state = 'outlook_delegated'): string {
    this.assertConfigured();
    const redirect = redirectUri || this.config.redirectUri;
    if (!redirect) {
      throw new AppError('Redirect URI is required for OAuth login', StatusCodes.BAD_REQUEST);
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirect,
      response_mode: 'query',
      scope: DELEGATED_SCOPES,
      state,
    });

    return `${this.config.authority}/${this.config.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  public async exchangeAuthCode(
    code: string,
    redirectUri?: string,
    tokenKey = DEFAULT_TOKEN_KEY,
  ): Promise<IOutlookStoredToken> {
    this.assertConfigured();
    const redirect = redirectUri || this.config.redirectUri;
    if (!redirect) {
      throw new AppError('Redirect URI is required to exchange auth code', StatusCodes.BAD_REQUEST);
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirect,
      scope: DELEGATED_SCOPES,
    });

    const url = `${this.config.authority}/${this.config.tenantId}/oauth2/v2.0/token`;

    try {
      const response = await axios.post<GraphTokenResponse>(url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response.data.access_token) {
        throw new AppError(
          'Microsoft did not return an access token',
          StatusCodes.BAD_GATEWAY,
          true,
          { code: ErrorCode.OUTLOOK_API_ERROR, details: response.data },
        );
      }

      const expiresAt = new Date(Date.now() + response.data.expires_in * 1000);
      return this.tokenRepository.upsertToken(tokenKey, {
        accessToken: response.data.access_token,
        expiresAt,
        refreshToken: response.data.refresh_token ?? null,
        accountType: 'delegated',
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      const axiosErr = err as AxiosError;
      throw new AppError(
        'Failed to exchange authorization code for Microsoft Graph tokens',
        StatusCodes.BAD_GATEWAY,
        true,
        {
          code: ErrorCode.OUTLOOK_API_ERROR,
          details: axiosErr.response?.data ?? axiosErr.message,
        },
      );
    }
  }

  public async refreshDelegatedToken(
    refreshToken: string,
    tokenKey = DEFAULT_TOKEN_KEY,
  ): Promise<IOutlookStoredToken> {
    this.assertConfigured();

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      scope: DELEGATED_SCOPES,
    });

    const url = `${this.config.authority}/${this.config.tenantId}/oauth2/v2.0/token`;

    try {
      const response = await axios.post<GraphTokenResponse>(url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response.data.access_token) {
        throw new AppError(
          'Microsoft did not return an access token on refresh',
          StatusCodes.BAD_GATEWAY,
          true,
          { code: ErrorCode.OUTLOOK_API_ERROR, details: response.data },
        );
      }

      const expiresAt = new Date(Date.now() + response.data.expires_in * 1000);
      return this.tokenRepository.upsertToken(tokenKey, {
        accessToken: response.data.access_token,
        expiresAt,
        refreshToken: response.data.refresh_token || refreshToken,
        accountType: 'delegated',
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      const axiosErr = err as AxiosError;
      throw new AppError(
        'Failed to refresh Microsoft Graph delegated access token',
        StatusCodes.BAD_GATEWAY,
        true,
        {
          code: ErrorCode.OUTLOOK_API_ERROR,
          details: axiosErr.response?.data ?? axiosErr.message,
        },
      );
    }
  }

  public async isDelegated(tokenKey = DEFAULT_TOKEN_KEY): Promise<boolean> {
    const stored = await this.tokenRepository.findToken(tokenKey);
    return Boolean(stored?.refreshToken || stored?.accountType === 'delegated');
  }

  public async fetchToken(): Promise<GraphTokenResponse> {
    this.assertConfigured();

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope,
    });

    const url = `${this.config.authority}/${this.config.tenantId}/oauth2/v2.0/token`;

    try {
      const response = await axios.post<GraphTokenResponse>(url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response.data.access_token) {
        throw new AppError(
          'Microsoft did not return an access token',
          StatusCodes.BAD_GATEWAY,
          true,
          { code: ErrorCode.OUTLOOK_API_ERROR, details: response.data },
        );
      }

      return response.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const axiosErr = err as AxiosError;
      throw new AppError(
        'Failed to obtain Microsoft Graph access token',
        StatusCodes.BAD_GATEWAY,
        true,
        {
          code: ErrorCode.OUTLOOK_API_ERROR,
          details: axiosErr.response?.data ?? axiosErr.message,
        },
      );
    }
  }

  public async getValidAccessToken(tokenKey = DEFAULT_TOKEN_KEY): Promise<string> {
    const stored = await this.tokenRepository.findToken(tokenKey);

    if (stored && stored.expiresAt.getTime() - EXPIRY_SAFETY_WINDOW_MS > Date.now()) {
      return stored.accessToken;
    }

    if (stored?.refreshToken) {
      try {
        const refreshed = await this.refreshDelegatedToken(stored.refreshToken, tokenKey);
        return refreshed.accessToken;
      } catch (err) {
        console.error('[OutlookTokenService] Delegated token refresh failed:', err);
      }
    }

    if (this.config.tenantId === 'consumers') {
      throw new AppError(
        'Microsoft personal accounts (consumers tenant) require delegated OAuth login. Please authenticate at /api/v1/outlook/auth/login',
        StatusCodes.UNAUTHORIZED,
        true,
        { code: ErrorCode.UNAUTHORIZED },
      );
    }

    const fresh = await this.fetchToken();
    const expiresAt = new Date(Date.now() + fresh.expires_in * 1000);
    const saved = await this.tokenRepository.upsertToken(tokenKey, {
      accessToken: fresh.access_token,
      expiresAt,
      accountType: 'app_only',
    });
    return saved.accessToken;
  }

  public async getCachedToken(tokenKey = DEFAULT_TOKEN_KEY): Promise<IOutlookStoredToken | null> {
    return this.tokenRepository.findToken(tokenKey);
  }
}
