import path from 'path';

import type { ITeamsGraphClient } from './teams.graph-client';
import type { GraphDriveItem, GraphList } from './teams.types';
import type { DocumentTypeTag, IDocumentIngestionPort } from './document-ingestion.port';
import { describeError } from './teams.errors';

export interface IngestAttachmentParams {
  projectId: string;
  uploadedBy: string;
  contentUrl: string;
  fallbackName?: string | null;
  sourceMeta?: Record<string, string | number | boolean | null>;
  /** Where the file lives now, used to recover from a stale contentUrl. */
  locator?: ChannelLocator;
}

/** The channel a file was posted in, resolved live rather than from the stored URL. */
export interface ChannelLocator {
  teamId?: string | null;
  channelId?: string | null;
}

export interface DownloadedFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface ChannelRecording {
  name: string;
  size: number;
  webUrl: string | null;
  downloadUrl: string | null;
}

const RECORDING_RE = /\.(mp4|mov)$/i;


const encodeShareUrl = (url: string): string => {
  const base64 = Buffer.from(url, 'utf8').toString('base64');
  return `u!${base64.replace(/=+$/g, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
};

/** Last path segment of a SharePoint attachment URL, decoded, or null. */
const fileNameFromUrl = (url: string): string | null => {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
};

export const inferDocumentType = (name: string): DocumentTypeTag => {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.dwg') return 'drawing';
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) return 'photo';
  return 'other';
};

/**
 * Downloads files shared in Teams channel messages (attachments of
 * contentType "reference") via Microsoft Graph and hands them to the Document
 * Ingestion Pipeline through IDocumentIngestionPort. Per-file errors are
 * swallowed (logged + returns false) so one bad file never aborts a sync.
 */
export class TeamsFilesService {
  private readonly graphClient: ITeamsGraphClient;
  private readonly documentPort: IDocumentIngestionPort;
  private readonly enabled: boolean;

  public constructor(
    graphClient: ITeamsGraphClient,
    documentPort: IDocumentIngestionPort,
    enabled = true,
  ) {
    this.graphClient = graphClient;
    this.documentPort = documentPort;
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public encodeShareUrl(url: string): string {
    return encodeShareUrl(url);
  }

  public async download(
    contentUrl: string,
    fallbackName?: string | null,
    locator?: ChannelLocator,
  ): Promise<DownloadedFile> {
    try {
      const shareId = encodeShareUrl(contentUrl);
      const item = await this.graphClient.get<GraphDriveItem>(`/shares/${shareId}/driveItem`);
      const buffer = await this.graphClient.getBinary(`/shares/${shareId}/driveItem/content`);
      return {
        buffer,
        originalName: item.name ?? fallbackName ?? 'teams-file',
        mimeType: item.file?.mimeType ?? 'application/octet-stream',
      };
    } catch (err) {
      // An attachment stores the SharePoint URL it had when it was posted, and
      // renaming a team or channel moves the folder underneath it. Every file
      // posted before the rename then answers 403 accessDenied forever, so the
      // stored link is worthless. The channel itself still knows where its files
      // are, so resolve them live and match by name.
      const recovered = await this.downloadFromChannelFolder(contentUrl, fallbackName, locator);
      if (!recovered) throw err;
      console.log(
        `[TeamsFiles] stale attachment link recovered from the channel folder: ${recovered.originalName}`,
      );
      return recovered;
    }
  }

  /**
   * Finds a file by name in the channel's CURRENT files folder (and one level
   * of subfolders, where meeting files land). Returns null when the channel is
   * unknown or nothing matches, so the caller can rethrow the original error.
   */
  private async downloadFromChannelFolder(
    contentUrl: string,
    fallbackName?: string | null,
    locator?: ChannelLocator,
  ): Promise<DownloadedFile | null> {
    const { teamId, channelId } = locator ?? {};
    if (!teamId || !channelId) return null;

    const wanted = fileNameFromUrl(contentUrl) ?? fallbackName;
    if (!wanted) return null;

    try {
      const folder = await this.graphClient.get<GraphDriveItem>(
        `/teams/${teamId}/channels/${channelId}/filesFolder`,
      );
      const driveId = folder.parentReference?.driveId;
      const rootId = folder.id;
      if (!driveId || !rootId) return null;

      const match = await this.findInFolder(driveId, rootId, wanted);
      if (!match) return null;

      const buffer = await this.graphClient.getBinary(`/drives/${driveId}/items/${match.id}/content`);
      return {
        buffer,
        originalName: match.name ?? wanted,
        mimeType: match.file?.mimeType ?? 'application/octet-stream',
      };
    } catch (err) {
      console.warn(
        `[TeamsFiles] channel-folder recovery failed for "${wanted}": ${describeError(err)}`,
      );
      return null;
    }
  }

  private async findInFolder(
    driveId: string,
    folderId: string,
    wanted: string,
  ): Promise<GraphDriveItem | null> {
    const listing = await this.graphClient.get<GraphList<GraphDriveItem>>(
      `/drives/${driveId}/items/${folderId}/children`,
    );
    const items = listing.value ?? [];
    const target = wanted.toLowerCase();

    const direct = items.find((item) => !item.folder && (item.name ?? '').toLowerCase() === target);
    if (direct) return direct;

    for (const sub of items.filter((item) => item.folder)) {
      const nested = await this.graphClient.get<GraphList<GraphDriveItem>>(
        `/drives/${driveId}/items/${sub.id}/children`,
      );
      const hit = (nested.value ?? []).find(
        (item) => !item.folder && (item.name ?? '').toLowerCase() === target,
      );
      if (hit) return hit;
    }

    return null;
  }

  /**
   * Hands a channel's already-ingested documents to the pipeline so they follow
   * the channel to the project it has just been reconnected to. Not gated on
   * `enabled`: this repairs existing documents rather than ingesting new ones.
   */
  public async moveChannelDocuments(channelId: string, targetProjectId: string): Promise<number> {
    if (!this.documentPort.moveChannelDocuments) return 0;
    return this.documentPort.moveChannelDocuments(channelId, targetProjectId);
  }

  public async ingestReferenceAttachment(params: IngestAttachmentParams): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const file = await this.download(params.contentUrl, params.fallbackName, params.locator);
      await this.documentPort.upload(
        { userId: params.uploadedBy },
        {
          projectId: params.projectId,
          file,
          uploadedBy: params.uploadedBy,
          documentType: inferDocumentType(file.originalName),
          metadata: params.sourceMeta,
        },
      );
      return true;
    } catch (err) {
      console.error(
        `[TeamsFiles] failed to ingest attachment for project ${params.projectId}: ${describeError(err)}`,
      );
      return false;
    }
  }

  /**
   * Lists the meeting recordings (.mp4/.mov) shared in a channel. Channel-meeting
   * recordings land in the channel drive's "Recordings" folder; some also sit
   * directly in the channel files root. Resolves the channel's drive via
   * filesFolder, then scans both locations.
   */
  public async listChannelRecordings(
    teamId: string,
    channelId: string,
  ): Promise<ChannelRecording[]> {
    const folder = await this.graphClient.get<GraphDriveItem>(
      `/teams/${teamId}/channels/${channelId}/filesFolder`,
    );
    const driveId = folder.parentReference?.driveId;
    const rootId = folder.id;
    if (!driveId || !rootId) return [];

    const pickRecordings = (items: GraphDriveItem[]): ChannelRecording[] =>
      items
        .filter((item): item is GraphDriveItem & { name: string } =>
          Boolean(item.name && RECORDING_RE.test(item.name)),
        )
        .map((item) => ({
          name: item.name,
          size: item.size ?? 0,
          webUrl: item.webUrl ?? null,
          downloadUrl: item['@microsoft.graph.downloadUrl'] ?? null,
        }));

    const root = await this.graphClient.get<GraphList<GraphDriveItem>>(
      `/drives/${driveId}/items/${rootId}/children`,
    );
    const rootItems = root.value ?? [];
    const recordings = pickRecordings(rootItems);

    const recFolder = rootItems.find(
      (item) => item.folder && (item.name ?? '').toLowerCase() === 'recordings',
    );
    if (recFolder) {
      const sub = await this.graphClient.get<GraphList<GraphDriveItem>>(
        `/drives/${driveId}/items/${recFolder.id}/children`,
      );
      recordings.push(...pickRecordings(sub.value ?? []));
    }

    return recordings;
  }
}
