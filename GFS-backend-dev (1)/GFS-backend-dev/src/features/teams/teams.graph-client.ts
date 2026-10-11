import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';

import type { TeamsTokenService } from './teams-token.service';
import type {
  CreateSubscriptionInput,
  DeltaResult,
  GraphList,
  GraphSubscription,
  GraphTranscriptListEntry,
} from './teams.types';

// A write response that also surfaces status + headers. Team creation returns
// the new team id in the `Content-Location` header and the async operation id in
// `Location`, so provisioning needs more than just the JSON body.
export interface GraphResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string | undefined>;
}

export interface ITeamsGraphClient {
  get<T>(path: string, params?: Record<string, string | undefined>): Promise<T>;
  getAllPages<T>(path: string, params?: Record<string, string | undefined>): Promise<T[]>;
  getDelta<T>(pathOrDeltaLink: string): Promise<DeltaResult<T>>;
  getBinary(pathOrUrl: string): Promise<Buffer>;
  getAllTranscriptsByOrganizer(organizerUserId: string): Promise<GraphTranscriptListEntry[]>;
  getOnlineMeetingIdByJoinUrl(userId: string, joinUrl: string): Promise<string | null>;
  resolveUserId(userIdOrUpn: string): Promise<string>;
  createSubscription(input: CreateSubscriptionInput): Promise<GraphSubscription>;
  renewSubscription(subscriptionId: string, expirationDateTime: string): Promise<GraphSubscription>;
  deleteSubscription(subscriptionId: string): Promise<void>;
  listSubscriptions(): Promise<GraphSubscription[]>;
  // Generic write primitives (used by Teams provisioning). `post`/`patch` return
  // status + headers so callers can read Content-Location/Location; `delete` is
  // fire-and-forget.
  post<T>(path: string, body: unknown): Promise<GraphResponse<T>>;
  patch<T>(path: string, body: unknown): Promise<GraphResponse<T>>;
  delete(path: string): Promise<void>;
}



const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TeamsGraphClient implements ITeamsGraphClient {
  private readonly tokenService: TeamsTokenService;
  private readonly graphBaseUrl: string;
  // Cache UPN→GUID lookups so we don't re-query /users on every call.
  private readonly userIdCache = new Map<string, string>();

  public constructor(tokenService: TeamsTokenService, graphBaseUrl: string) {
    this.tokenService = tokenService;
    this.graphBaseUrl = graphBaseUrl;
  }

  private async buildClient(): Promise<AxiosInstance> {
    const token = await this.tokenService.getValidAccessToken();
    return axios.create({
      baseURL: this.graphBaseUrl,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  }

  public async get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const client = await this.buildClient();
    try {
      const response = await client.get<T>(path, { params });
      return response.data;
    } catch (err) {
      throw this.toAppError(err, path);
    }
  }

  public async getAllPages<T>(
    path: string,
    params?: Record<string, string | undefined>,
  ): Promise<T[]> {
    const client = await this.buildClient();
    const results: T[] = [];
    let nextUrl: string | undefined = path;
    let nextParams = params;

    try {
      while (nextUrl) {
        const response: AxiosResponse<GraphList<T>> = await client.get<GraphList<T>>(nextUrl, {
          params: nextParams,
        });
        results.push(...(response.data.value ?? []));
        nextUrl = response.data['@odata.nextLink'];
        nextParams = undefined; // nextLink already encodes the query
      }
      return results;
    } catch (err) {
      throw this.toAppError(err, path);
    }
  }

  public async getDelta<T>(pathOrDeltaLink: string): Promise<DeltaResult<T>> {
    const client = await this.buildClient();
    const items: T[] = [];
    let nextUrl: string | undefined = pathOrDeltaLink;
    let deltaLink: string | null = null;

    try {
      while (nextUrl) {
        const response: AxiosResponse<GraphList<T>> = await client.get<GraphList<T>>(nextUrl);
        items.push(...(response.data.value ?? []));

        if (response.data['@odata.nextLink']) {
          nextUrl = response.data['@odata.nextLink'];
        } else {
          deltaLink = response.data['@odata.deltaLink'] ?? null;
          nextUrl = undefined;
        }
      }
      return { items, deltaLink };
    } catch (err) {
      throw this.toAppError(err, pathOrDeltaLink);
    }
  }

  public async getBinary(pathOrUrl: string): Promise<Buffer> {
    const client = await this.buildClient();
    try {
      const response: AxiosResponse<ArrayBuffer> = await client.get<ArrayBuffer>(pathOrUrl, {
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (err) {
      throw this.toAppError(err, pathOrUrl);
    }
  }


  public async getAllTranscriptsByOrganizer(
    organizerUserId: string,
  ): Promise<GraphTranscriptListEntry[]> {
    const orgId = await this.resolveUserId(organizerUserId);
    const fn = `getAllTranscripts(meetingOrganizerUserId='${orgId}')`;
    const paths = [
      `/users/${orgId}/onlineMeetings/${fn}`,
      `/communications/onlineMeetings/${fn}`,
      `https://graph.microsoft.com/beta/users/${orgId}/onlineMeetings/${fn}`,
      `https://graph.microsoft.com/beta/communications/onlineMeetings/${fn}`,
    ];

    let lastErr: unknown = null;
    for (const path of paths) {
      try {
        const response = await this.get<GraphList<GraphTranscriptListEntry>>(path);
        return response.value ?? [];
      } catch (err) {
        const status = (err as AppError).statusCode;
        if (status !== StatusCodes.NOT_FOUND && status !== StatusCodes.BAD_REQUEST) {
          // 401/403/5xx are real errors — surface them
          throw err;
        }
        lastErr = err;
        // 404/400 → try the next URL pattern
      }
    }
    // Every path 404'd — re-throw the last one so the caller logs it.
    throw lastErr ?? new AppError('getAllTranscripts: no working URL', StatusCodes.NOT_FOUND);
  }

  /**
   * Resolve a user identifier to the object-id (GUID) Graph's onlineMeetings
   * endpoints require. The `/users/{id}/onlineMeetings` routes return a
   * misleading 404 when given a UPN/email — they only accept the GUID. Passes a
   * GUID straight through; looks up + caches anything else (e.g. a UPN).
   */
  public async resolveUserId(userIdOrUpn: string): Promise<string> {
    if (GUID_RE.test(userIdOrUpn)) return userIdOrUpn;
    const cached = this.userIdCache.get(userIdOrUpn);
    if (cached) return cached;
    const user = await this.get<{ id?: string }>(`/users/${encodeURIComponent(userIdOrUpn)}`, {
      $select: 'id',
    });
    const id = user.id ?? userIdOrUpn;
    this.userIdCache.set(userIdOrUpn, id);
    return id;
  }

  public async getOnlineMeetingIdByJoinUrl(
    userId: string,
    joinUrl: string,
  ): Promise<string | null> {
    const id = await this.resolveUserId(userId);
    const response = await this.get<GraphList<{ id: string }>>(
      `/users/${encodeURIComponent(id)}/onlineMeetings`,
      { $filter: `joinWebUrl eq '${joinUrl}'` },
    );
    return response.value?.[0]?.id ?? null;
  }

  public async createSubscription(input: CreateSubscriptionInput): Promise<GraphSubscription> {
    const client = await this.buildClient();
    try {
      const response = await client.post<GraphSubscription>('/subscriptions', {
        resource: input.resource,
        changeType: input.changeType,
        notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: input.lifecycleNotificationUrl,
        clientState: input.clientState,
        expirationDateTime: input.expirationDateTime,
        latestSupportedTlsVersion: 'v1_2',
      });
      return response.data;
    } catch (err) {
      throw this.toAppError(err, '/subscriptions');
    }
  }

  public async renewSubscription(
    subscriptionId: string,
    expirationDateTime: string,
  ): Promise<GraphSubscription> {
    const client = await this.buildClient();
    try {
      const response = await client.patch<GraphSubscription>(
        `/subscriptions/${subscriptionId}`,
        { expirationDateTime },
      );
      return response.data;
    } catch (err) {
      throw this.toAppError(err, `/subscriptions/${subscriptionId}`);
    }
  }

  public async listSubscriptions(): Promise<GraphSubscription[]> {
    const response = await this.get<GraphList<GraphSubscription>>('/subscriptions');
    return response.value ?? [];
  }

  public async deleteSubscription(subscriptionId: string): Promise<void> {
    const client = await this.buildClient();
    try {
      await client.delete(`/subscriptions/${subscriptionId}`);
    } catch (err) {
      throw this.toAppError(err, `/subscriptions/${subscriptionId}`);
    }
  }

  public async post<T>(path: string, body: unknown): Promise<GraphResponse<T>> {
    const client = await this.buildClient();
    try {
      const response = await client.post<T>(path, body);
      return {
        status: response.status,
        data: response.data,
        headers: this.normalizeHeaders(response.headers),
      };
    } catch (err) {
      throw this.toAppError(err, path);
    }
  }

  public async patch<T>(path: string, body: unknown): Promise<GraphResponse<T>> {
    const client = await this.buildClient();
    try {
      const response = await client.patch<T>(path, body);
      return {
        status: response.status,
        data: response.data,
        headers: this.normalizeHeaders(response.headers),
      };
    } catch (err) {
      throw this.toAppError(err, path);
    }
  }

  public async delete(path: string): Promise<void> {
    const client = await this.buildClient();
    try {
      await client.delete(path);
    } catch (err) {
      throw this.toAppError(err, path);
    }
  }

  // Graph (axios) may hand back an AxiosHeaders instance; flatten it to a plain
  // lower-cased map so callers can read e.g. headers['content-location'] safely.
  private normalizeHeaders(raw: unknown): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    const src =
      raw && typeof (raw as { toJSON?: () => unknown }).toJSON === 'function'
        ? (raw as { toJSON: () => Record<string, unknown> }).toJSON()
        : (raw as Record<string, unknown> | undefined);
    for (const key of Object.keys(src ?? {})) {
      const val = (src as Record<string, unknown>)[key];
      out[key.toLowerCase()] = val == null ? undefined : String(val);
    }
    return out;
  }

  private toAppError(err: unknown, path: string): AppError {
    if (err instanceof AppError) return err;
    const axiosErr = err as AxiosError;
    return new AppError(
      `Microsoft Graph request failed for ${path}`,
      axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
      true,
      {
        code: ErrorCode.TEAMS_API_ERROR,
        details: axiosErr.response?.data ?? axiosErr.message,
      },
    );
  }
}
