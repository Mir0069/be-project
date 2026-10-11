import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';

import type { OutlookTokenService } from './outlook-token.service';
import type { DeltaResult, GraphList } from './outlook.types';

export interface IOutlookGraphClient {
  get<T>(path: string, params?: Record<string, string | undefined>): Promise<T>;
  getAllPages<T>(path: string, params?: Record<string, string | undefined>): Promise<T[]>;
  getDelta<T>(pathOrDeltaLink: string): Promise<DeltaResult<T>>;
  getBinary(pathOrUrl: string): Promise<Buffer>;
  // Streaming download (constant memory) — used for staging large attachments.
  getStream(pathOrUrl: string): Promise<NodeJS.ReadableStream>;
  // DELETE a resource (e.g. a message after it has been fetched). Needs Mail.ReadWrite.
  delete(path: string): Promise<void>;
  // Permanently purge a message bypassing Trash / Deleted Items folder.
  permanentDelete(userId: string, messageId: string): Promise<void>;
}

// Time-to-response timeout so a stalled Graph connection fails cleanly instead
// of hanging. For streaming responses this bounds time-to-first-byte only (the
// timer is cleared once headers arrive), so it does not cut off a large
// in-progress download.
const GRAPH_REQUEST_TIMEOUT_MS = 120_000;

export class OutlookGraphClient implements IOutlookGraphClient {
  private readonly tokenService: OutlookTokenService;
  private readonly graphBaseUrl: string;

  public constructor(tokenService: OutlookTokenService, graphBaseUrl: string) {
    this.tokenService = tokenService;
    this.graphBaseUrl = graphBaseUrl;
  }

  private async buildClient(): Promise<AxiosInstance> {
    const token = await this.tokenService.getValidAccessToken();
    return axios.create({
      baseURL: this.graphBaseUrl,
      headers: { Authorization: `Bearer ${token}` },
      timeout: GRAPH_REQUEST_TIMEOUT_MS,
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

  public async getStream(pathOrUrl: string): Promise<NodeJS.ReadableStream> {
    const client = await this.buildClient();
    try {
      const response: AxiosResponse<NodeJS.ReadableStream> = await client.get(pathOrUrl, {
        responseType: 'stream',
      });
      return response.data;
    } catch (err) {
      throw await this.toStreamAppError(err, pathOrUrl);
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

  public async permanentDelete(userId: string, messageId: string): Promise<void> {
    const client = await this.buildClient();
    const base = userId.toLowerCase() === 'me' ? '/me' : `/users/${encodeURIComponent(userId)}`;
    const endpoint = `${base}/messages/${messageId}/permanentDelete`;
    try {
      await client.post(endpoint);
    } catch (err) {
      // Fall back to standard delete if the mailbox/endpoint does not support permanentDelete action
      try {
        await client.delete(`${base}/messages/${messageId}`);
      } catch {
        throw this.toAppError(err, endpoint);
      }
    }
  }

  private async toStreamAppError(err: unknown, path: string): Promise<AppError> {
    if (err instanceof AppError) return err;
    const axiosErr = err as AxiosError<any>;
    let details: any = axiosErr.message;
    const stream = axiosErr.response?.data;
    if (stream && typeof stream.on === 'function') {
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve) => {
          stream.on('data', (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          stream.on('end', () => resolve());
          stream.on('error', () => resolve());
          setTimeout(() => resolve(), 1000);
        });
        const text = Buffer.concat(chunks).toString('utf-8');
        try {
          details = JSON.parse(text);
        } catch {
          details = text || axiosErr.message;
        }
      } catch {
        details = axiosErr.message;
      }
    } else {
      details = axiosErr.response?.data ?? axiosErr.message;
    }

    return new AppError(
      `Microsoft Graph request failed for ${path}`,
      axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
      true,
      {
        code: ErrorCode.OUTLOOK_API_ERROR,
        details,
      },
    );
  }

  private toAppError(err: unknown, path: string): AppError {
    if (err instanceof AppError) return err;
    const axiosErr = err as AxiosError<any>;
    const rawData = axiosErr.response?.data;
    const details = (rawData && typeof rawData.on === 'function')
      ? axiosErr.message
      : (rawData ?? axiosErr.message);

    return new AppError(
      `Microsoft Graph request failed for ${path}`,
      axiosErr.response?.status ?? StatusCodes.BAD_GATEWAY,
      true,
      {
        code: ErrorCode.OUTLOOK_API_ERROR,
        details,
      },
    );
  }
}
