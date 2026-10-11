import axios from 'axios';
import { Readable } from 'stream';
import { env } from '@config/index';

/**
 * Constructs the standardized Dropbox folder path for a project using its name and reference number.
 * Format: `<rootPath>/<sanitizedProjectName> - <referenceNumber>`
 * Sanitizes slashes and illegal characters in project names so the Dropbox folder name is flat and matches the reference number.
 */
export function buildDropboxFolderPath(
  projectName: string,
  referenceNumber: string,
  rootPath: string = env.dropbox.rootPath
): string {
  const cleanName = (projectName || 'Untitled Project').trim().replace(/[/\\?%*:|"<>]/g, '-');
  const cleanRef = (referenceNumber || '').trim();
  const folderName = cleanRef ? `${cleanName} - ${cleanRef}` : cleanName;
  let base = (rootPath || '/GFS-Projects').replace(/\/+$/, '').trim();
  if (!base.startsWith('/')) {
    base = `/${base}`;
  }
  return `${base}/${folderName}`;
}

let cachedToken: string | null = null;
let tokenExpiresAt: Date | null = null;

/**
 * Obtains a valid access token. If refresh token credentials are provided,
 * it requests a fresh short-lived access token. Otherwise, it falls back to
 * the static access token.
 */
export async function getDropboxAccessToken(config: {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
}): Promise<string> {
  // Prevent automated Jest test runs from hitting live Dropbox OAuth
  if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
    return 'mock-test-dropbox-token';
  }

  // If we have a cached token that is still valid (with a 5-minute safety window)
  if (cachedToken && tokenExpiresAt && tokenExpiresAt.getTime() - 5 * 60 * 1000 > Date.now()) {
    return cachedToken;
  }

  if (config.refreshToken && config.clientId && config.clientSecret) {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', config.refreshToken);
    params.append('client_id', config.clientId);
    params.append('client_secret', config.clientSecret);

    try {
      const res = await axios.post('https://api.dropbox.com/oauth2/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      
      const accessToken = res.data.access_token;
      if (typeof accessToken !== 'string') {
        throw new Error('Dropbox OAuth response did not contain a valid access_token.');
      }
      
      cachedToken = accessToken;
      const expiresInSeconds = res.data.expires_in || 14400; // default to 4 hours if not provided
      tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);
      
      return accessToken;
    } catch (err: any) {
      const detail = err?.response?.data?.error_description || err?.response?.data?.error || err?.message || 'OAuth request failed';
      throw new Error(`Dropbox OAuth error (${err?.response?.status || 'network'}): ${detail}`);
    }
  }

  if (config.accessToken) {
    return config.accessToken;
  }

  throw new Error(
    'Dropbox credentials not configured. Please provide DROPBOX_ACCESS_TOKEN or client credentials with refresh token.'
  );
}

/**
 * Executes a function, retrying with exponential backoff on transient network errors.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000,
  backoffFactor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries <= 0) {
      throw err;
    }
    const status = err?.response?.status;
    // Do not retry client errors like 400, 401, 403, 409 (conflict)
    if (status && status >= 400 && status < 500 && status !== 429) {
      throw err;
    }
    console.warn(`[Dropbox API Request Failed] Retrying in ${delayMs}ms. Error: ${err?.message || err}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return retryWithBackoff(fn, retries - 1, delayMs * backoffFactor, backoffFactor);
  }
}

/**
 * Retrieves metadata for a Dropbox shared link.
 */
export async function fetchDropboxMetadata(sharedLinkUrl: string, accessToken: string): Promise<any> {
  const response = await axios.post(
    'https://api.dropboxapi.com/2/sharing/get_shared_link_metadata',
    { url: sharedLinkUrl },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

/**
 * Recursively lists files in a Dropbox shared link folder (up to limit).
 */
export async function listDropboxFolder(
  sharedLinkUrl: string,
  accessToken: string,
  maxFiles = 50
): Promise<any[]> {
  const files: any[] = [];
  
  let response = await axios.post(
    'https://api.dropboxapi.com/2/files/list_folder',
    {
      path: '',
      shared_link: { url: sharedLinkUrl },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  let entries = response.data.entries || [];
  files.push(...entries);

  let hasMore = response.data.has_more;
  let cursor = response.data.cursor;

  while (hasMore && files.length < maxFiles) {
    response = await axios.post(
      'https://api.dropboxapi.com/2/files/list_folder/continue',
      { cursor },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    entries = response.data.entries || [];
    files.push(...entries);
    hasMore = response.data.has_more;
    cursor = response.data.cursor;
  }

  return files.slice(0, maxFiles);
}

/**
 * Downloads a file from a shared link as a stream.
 */
export async function getDropboxFileStream(
  sharedLinkUrl: string,
  accessToken: string,
  relativePath = '',
  isFolder = false
): Promise<NodeJS.ReadableStream> {
  if (isFolder && !relativePath) {
    const downloadUrl = sharedLinkUrl.includes('?')
      ? sharedLinkUrl.replace(/dl=0/g, 'dl=1')
      : `${sharedLinkUrl}?dl=1`;
    const response = await axios.get(downloadUrl, { responseType: 'stream' });
    return response.data as NodeJS.ReadableStream;
  }

  const apiArgObj: { url: string; path?: string } = {
    url: sharedLinkUrl,
  };
  if (relativePath) {
    apiArgObj.path = relativePath;
  }
  const apiArg = JSON.stringify(apiArgObj);

  // Safe header encoding for non-ASCII characters
  const safeApiArg = apiArg.replace(
    /[\u007f-\uffff]/g,
    (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
  );

  const response = await axios.post(
    'https://content.dropboxapi.com/2/sharing/get_shared_link_file',
    Buffer.alloc(0),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': safeApiArg,
        'Content-Type': 'application/octet-stream',
      },
      responseType: 'stream',
    }
  );

  return response.data as NodeJS.ReadableStream;
}

// ---------------------------------------------------------------------------
// Component 1 — New functions for 2-Way Dropbox Sync
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per append chunk
const CHUNKED_UPLOAD_THRESHOLD = 15 * 1024 * 1024; // use session upload for files >= 15 MB

/**
 * A single entry returned by the Dropbox list_folder API.
 * `.tag` is `'file'` or `'folder'`.
 */
export interface DropboxEntry {
  '.tag': 'file' | 'folder';
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
  /** Only present for files. */
  size?: number;
  /** Only present for files. ISO-8601 string. */
  client_modified?: string;
  /** Only present for files. ISO-8601 string. */
  server_modified?: string;
  /** Unique revision ID for files in Dropbox. Changes on every update. */
  rev?: string;
  /** Content hash of the file computed by Dropbox. */
  content_hash?: string;
}

/**
 * Creates a folder at the given absolute Dropbox path.
 * If the folder already exists the call is silently ignored (idempotent).
 *
 * @param path    Absolute Dropbox path, e.g. `/GFS Projects/Acme - PRJ-2026-0001`
 * @param token   Short-lived Dropbox access token
 */
export async function createDropboxFolder(path: string, token: string): Promise<void> {
  if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
    return;
  }
  try {
    await axios.post(
      'https://api.dropboxapi.com/2/files/create_folder_v2',
      { path, autorename: false },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err: any) {
    // 409 means the folder or path already exists — treat as idempotent success.
    if (err?.response?.status === 409) {
      return;
    }
    throw new Error(
      `createDropboxFolder failed for "${path}": ${err?.response?.data?.error_summary ?? err?.message}`
    );
  }
}

/**
 * Lists all entries (files and subfolders) directly inside a Dropbox folder path.
 * Automatically follows pagination cursors until all entries are fetched.
 *
 * @param path    Absolute Dropbox path, e.g. `/GFS Projects/Acme - PRJ-2026-0001`
 * @param token   Short-lived Dropbox access token
 * @returns       Flat array of `DropboxEntry` objects (non-recursive, single level)
 */
export async function listDropboxPath(path: string, token: string): Promise<DropboxEntry[]> {
  const entries: DropboxEntry[] = [];

  let response = await axios.post(
    'https://api.dropboxapi.com/2/files/list_folder',
    { path, recursive: false },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  entries.push(...(response.data.entries as DropboxEntry[]));

  let hasMore: boolean = response.data.has_more;
  let cursor: string = response.data.cursor;

  while (hasMore) {
    response = await axios.post(
      'https://api.dropboxapi.com/2/files/list_folder/continue',
      { cursor },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    entries.push(...(response.data.entries as DropboxEntry[]));
    hasMore = response.data.has_more;
    cursor = response.data.cursor;
  }

  return entries;
}

/**
 * Downloads a file from Dropbox by its absolute path and returns a readable stream.
 * Uses the path-based download API (not shared-link based).
 *
 * @param path    Absolute Dropbox path of the file to download
 * @param token   Short-lived Dropbox access token
 * @returns       A Node.js readable stream of the file contents
 */
export async function downloadDropboxFileByPath(
  path: string,
  token: string
): Promise<NodeJS.ReadableStream> {
  const apiArg = JSON.stringify({ path });

  // Safe header encoding for non-ASCII characters (same pattern as getDropboxFileStream)
  const safeApiArg = apiArg.replace(
    /[\u007f-\uffff]/g,
    (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
  );

  const response = await axios.post(
    'https://content.dropboxapi.com/2/files/download',
    Buffer.alloc(0),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': safeApiArg,
        'Content-Type': 'application/octet-stream',
      },
      responseType: 'stream',
    }
  );

  return response.data as NodeJS.ReadableStream;
}

/**
 * Reads a Node.js readable stream fully into a single Buffer.
 */
export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Uploads a file to Dropbox at the given absolute path.
 *
 * - **Small files (< 15 MB)**: single-shot upload via `/files/upload`.
 * - **Large files (≥ 15 MB)**: 3-phase chunked session upload (4 MB chunks)
 *   via `/files/upload_session/start`, `/files/upload_session/append_v2`,
 *   and `/files/upload_session/finish`. This matches the plan's resilient
 *   chunked upload design.
 *
 * In both cases the file is written with `mode: overwrite` so re-syncing is safe.
 *
 * @param path      Absolute Dropbox destination path, e.g. `/GFS Projects/.../plan.pdf`
 * @param stream    Readable stream of the file contents (from Azure Blob Storage)
 * @param fileSize  Total byte size of the file (used to choose upload strategy)
 * @param token     Short-lived Dropbox access token
 */
export async function uploadDropboxFileByPath(
  path: string,
  stream: NodeJS.ReadableStream,
  fileSize: number,
  token: string
): Promise<any> {
  if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
    return;
  }
  const commitInfo = { path, mode: 'overwrite', autorename: false };

  if (fileSize < CHUNKED_UPLOAD_THRESHOLD) {
    // ── Single-shot upload ────────────────────────────────────────────────
    const buffer = await streamToBuffer(stream);

    const apiArg = JSON.stringify(commitInfo);
    const safeApiArg = apiArg.replace(
      /[\u007f-\uffff]/g,
      (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
    );

    const res = await retryWithBackoff(() =>
      axios.post('https://content.dropboxapi.com/2/files/upload', buffer, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': safeApiArg,
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      })
    );

    return res?.data;
  }

  // ── Chunked session upload (≥ 15 MB) ─────────────────────────────────────
  let sessionId: string | null = null;
  let offset = 0;
  let accumulator = Buffer.alloc(0);

  const readableStream = Readable.from(stream);

  for await (const chunk of readableStream) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    accumulator = Buffer.concat([accumulator, chunkBuffer]);

    while (accumulator.length >= CHUNK_SIZE) {
      const slice = accumulator.subarray(0, CHUNK_SIZE);
      accumulator = accumulator.subarray(CHUNK_SIZE);

      if (!sessionId) {
        // Phase 1 — Start session
        const startResponse = await retryWithBackoff(() =>
          axios.post(
            'https://content.dropboxapi.com/2/files/upload_session/start',
            slice,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Dropbox-API-Arg': JSON.stringify({ close: false }),
                'Content-Type': 'application/octet-stream',
              },
            }
          )
        );
        sessionId = startResponse.data.session_id;
      } else {
        // Phase 2 — Append chunk
        const cursor = { session_id: sessionId, offset };
        await retryWithBackoff(() =>
          axios.post(
            'https://content.dropboxapi.com/2/files/upload_session/append_v2',
            slice,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Dropbox-API-Arg': JSON.stringify({ cursor, close: false }),
                'Content-Type': 'application/octet-stream',
              },
              maxBodyLength: Infinity,
              maxContentLength: Infinity,
            }
          )
        );
      }

      offset += CHUNK_SIZE;
    }
  }

  // Phase 3 — Finish: send the final (possibly partial) chunk and commit
  let finishRes: any;
  if (!sessionId) {
    // If stream ended but never exceeded CHUNK_SIZE
    const apiArg = JSON.stringify(commitInfo);
    const safeApiArg = apiArg.replace(
      /[\u007f-\uffff]/g,
      (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
    );
    finishRes = await retryWithBackoff(() =>
      axios.post('https://content.dropboxapi.com/2/files/upload', accumulator, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': safeApiArg,
          'Content-Type': 'application/octet-stream',
        },
      })
    );
  } else {
    const finalCursor = { session_id: sessionId, offset };
    const finishApiArg = JSON.stringify({ cursor: finalCursor, commit: commitInfo });
    const safeFinishApiArg = finishApiArg.replace(
      /[\u007f-\uffff]/g,
      (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
    );

    finishRes = await retryWithBackoff(() =>
      axios.post(
        'https://content.dropboxapi.com/2/files/upload_session/finish',
        accumulator,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Dropbox-API-Arg': safeFinishApiArg,
            'Content-Type': 'application/octet-stream',
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      )
    );
  }

  return finishRes?.data;
}

/**
 * Deletes a file or folder at the given absolute Dropbox path.
 */
export async function deleteDropboxFileByPath(path: string, token: string): Promise<void> {
  if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
    return;
  }
  try {
    await retryWithBackoff(() =>
      axios.post(
        'https://api.dropboxapi.com/2/files/delete_v2',
        { path },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )
    );
  } catch (err: any) {
    // If file is already deleted/not found (409/path/not_found), ignore the error
    const summary: string = err?.response?.data?.error_summary ?? '';
    if (err?.response?.status === 409 && (summary.includes('path/not_found') || summary.includes('not_found'))) {
      return;
    }
    throw new Error(`deleteDropboxFileByPath failed for "${path}": ${err?.response?.data?.error_summary ?? err?.message}`);
  }
}

/**
 * Moves a file or folder in Dropbox from an absolute source path to an absolute destination path.
 *
 * @param fromPath    Absolute Dropbox path of the source file, e.g. `/GFS-Projects/Old - PRJ-001/doc.pdf`
 * @param toPath      Absolute Dropbox path of the destination file, e.g. `/GFS-Projects/New - PRJ-002/doc.pdf`
 * @param token       Short-lived Dropbox access token
 * @param autorename  If true, auto-renames target file if a duplicate name exists (default: false)
 * @returns           The metadata of the moved entry returned by Dropbox, or null if fromPath was not found
 */
export async function moveDropboxFileByPath(
  fromPath: string,
  toPath: string,
  token: string,
  autorename = false
): Promise<DropboxEntry | null> {
  if (process.env['JEST_WORKER_ID'] !== undefined || process.env['npm_lifecycle_event'] === 'test') {
    return {
      '.tag': 'file',
      name: toPath.split('/').pop() || 'file',
      path_lower: toPath.toLowerCase(),
      path_display: toPath,
      id: 'mock-test-id',
    };
  }
  try {
    const response = await retryWithBackoff(() =>
      axios.post(
        'https://api.dropboxapi.com/2/files/move_v2',
        {
          from_path: fromPath,
          to_path: toPath,
          autorename,
          allow_shared_folder: true,
          allow_ownership_transfer: true,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )
    );
    return (response.data?.metadata as DropboxEntry) ?? null;
  } catch (err: any) {
    const summary: string = err?.response?.data?.error_summary ?? '';
    // If source file not found in Dropbox, return null so caller can handle gracefully
    if (err?.response?.status === 409 && (summary.includes('path_lookup/not_found') || summary.includes('not_found'))) {
      return null;
    }
    throw new Error(
      `moveDropboxFileByPath failed from "${fromPath}" to "${toPath}": ${summary || err?.message}`
    );
  }
}

