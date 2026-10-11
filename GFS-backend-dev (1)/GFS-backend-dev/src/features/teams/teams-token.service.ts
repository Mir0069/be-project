import axios, { AxiosError } from 'axios';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type {
  ITeamsStoredToken,
  ITeamsTokenRepository,
} from '@repositories/interfaces/i-teams-token.repository';

import type { GraphTokenResponse } from './teams.types';

const DEFAULT_TOKEN_KEY = 'default';
const EXPIRY_SAFETY_WINDOW_MS = 60 * 1000;

export interface TeamsAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  authority: string;
  scope: string;
}

/**
 * Obtains and caches a Microsoft Graph app-only access token using the
 * client-credentials grant. Tokens last ~1 hour; we cache them and re-request
 * a fresh one once the cached token is within a 60s safety window of expiry.
 */
export class TeamsTokenService {
  private readonly tokenRepository: ITeamsTokenRepository;
  private readonly config: TeamsAuthConfig;

  public constructor(tokenRepository: ITeamsTokenRepository, config: TeamsAuthConfig) {
    this.tokenRepository = tokenRepository;
    this.config = config;
  }

  public isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.tenantId);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError(
        'Teams integration is not configured. Set TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET and TEAMS_TENANT_ID.',
        StatusCodes.SERVICE_UNAVAILABLE,
        true,
        { code: ErrorCode.TEAMS_NOT_CONFIGURED },
      );
    }
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
          { code: ErrorCode.TEAMS_API_ERROR, details: response.data },
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
          code: ErrorCode.TEAMS_API_ERROR,
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

    const fresh = await this.fetchToken();
    const expiresAt = new Date(Date.now() + fresh.expires_in * 1000);
    const saved = await this.tokenRepository.upsertToken(tokenKey, {
      accessToken: fresh.access_token,
      expiresAt,
    });
    return saved.accessToken;
  }

  public async getCachedToken(tokenKey = DEFAULT_TOKEN_KEY): Promise<ITeamsStoredToken | null> {
    return this.tokenRepository.findToken(tokenKey);
  }
}
