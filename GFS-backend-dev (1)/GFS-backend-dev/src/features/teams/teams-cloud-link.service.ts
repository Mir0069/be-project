import crypto from 'crypto';
import path from 'path';

import { env } from '@config/index';
import type { BlobStorage, AuthContext } from '@features/document-ingestion/document-ingestion.types';
import type { DocumentIngestionPipeline } from '@features/document-ingestion/document-ingestion.service';
import type { CloudLinkService } from '@services/cloud-link.service';
import type {
  ICloudLinkAssetRepository,
  IDomainCloudLinkAsset,
} from '@repositories/interfaces/i-cloud-link-asset.repository';
import type { IDomainTeamsMessage } from '@repositories/interfaces/i-teams-message.repository';
import {
  getDropboxAccessToken,
  fetchDropboxMetadata,
  getDropboxFileStream,
} from '@shared/utils/dropbox';
import { processZipStream } from '@shared/utils/zip';

import { inferDocumentType } from './teams-files.service';
import { describeError } from './teams.errors';

const SYSTEM_USER = 'teams-integration';
const MAX_RETRY = 5;

// Real MIME types keep the staged doc correct for the AI/UI. (The staged path
// skips validation, but octet-stream would mislabel every file.)
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain',
};

type StagedDocumentSink = Pick<DocumentIngestionPipeline, 'ingestStagedFile'>;

// Minimal structural deps so this service stays decoupled from the concrete
// NotificationService / channel repo (and trivially mockable in the scripts).
type CloudLinkFailureNotifier = {
  notifyTeamsCloudLinkFailed(input: {
    projectId: string | null;
    channelName?: string | null;
    teamName?: string | null;
    failedUrls: string[];
    messageId?: string | null;
  }): Promise<void>;
};

type MonitoredChannelLookup = {
  findByChannel(
    teamId: string,
    channelId: string,
  ): Promise<{ channelName?: string | null; teamName?: string | null } | null>;
};

/**
 * Fetches documents from Dropbox links found in a Teams message body and ingests
 * them as Teams documents (streamed to blob, never buffered). Reuses the shared
 * cloud-link detection/dedup and Dropbox/zip utilities. OneDrive/SharePoint are
 * detected but deferred (the Teams graph client has no stream download yet).
 */
export class TeamsCloudLinkService {
  public constructor(
    private readonly cloudLinkService: CloudLinkService,
    private readonly assetRepository: ICloudLinkAssetRepository,
    private readonly blobStorage: BlobStorage,
    private readonly documentPipeline: StagedDocumentSink,
    // Optional so the standalone re-ingest/test scripts can construct without them.
    private readonly notificationService?: CloudLinkFailureNotifier,
    private readonly monitoredChannelRepository?: MonitoredChannelLookup,
  ) {}

  public async ingestMessageLinks(message: IDomainTeamsMessage): Promise<number> {
    // Skip only when there's nothing to do: no project to attribute to, or
    // Dropbox isn't configured (avoids throwing per message on such a box).
    if (!message.projectId || !this.hasDropboxCredentials()) return 0;

    const assets = await this.cloudLinkService.extractAndSaveLinks({
      teamsMessageId: message.id, // Mongo _id — the dedup key (NOT the Graph id)
      projectId: message.projectId,
      bodyHtml: message.contentHtml ?? null,
      bodyText: message.contentText,
      sender: message.fromName ?? 'teams',
      subject: (message.contentText || 'Teams message').slice(0, 120),
      receivedAt: message.createdDateTime,
    });

    let ingested = 0;
    for (const asset of assets) {
      if (asset.provider !== 'DROPBOX' || asset.status !== 'DETECTED') continue;
      try {
        ingested += await this.resolveDropboxAsset(asset, message);
      } catch (err) {
        await this.markRetry(asset, err, message);
      }
    }
    return ingested;
  }

  private hasDropboxCredentials(): boolean {
    const d = env.dropbox;
    return Boolean((d.refreshToken && d.clientId && d.clientSecret) || d.accessToken);
  }

  private async resolveDropboxAsset(
    asset: IDomainCloudLinkAsset,
    message: IDomainTeamsMessage,
  ): Promise<number> {
    const token = await getDropboxAccessToken({
      clientId: env.dropbox.clientId,
      clientSecret: env.dropbox.clientSecret,
      refreshToken: env.dropbox.refreshToken,
      accessToken: env.dropbox.accessToken,
    });

    const metadata = await fetchDropboxMetadata(asset.originalUrl, token);
    const isFolder = metadata['.tag'] === 'folder';
    const fileName: string = metadata.name || 'dropbox_file';

    let count = 0;
    const onFile = async (name: string, stream: NodeJS.ReadableStream): Promise<void> => {
      if (await this.stageEntry(name, stream, asset, message)) count += 1;
    };

    if (isFolder) {
      const stream = await getDropboxFileStream(asset.originalUrl, token, '', true);
      await processZipStream(stream, onFile);
    } else {
      const stream = await getDropboxFileStream(asset.originalUrl, token);
      if (fileName.toLowerCase().endsWith('.zip')) {
        await processZipStream(stream, onFile);
      } else if (await this.stageEntry(fileName, stream, asset, message)) {
        count += 1;
      }
    }

    if (count > 0) {
      await this.assetRepository.updateStatus(asset.id, 'DOWNLOADED', {
        action: 'teams_cloud_link_ingested',
        detail: `Ingested ${count} file(s) from Dropbox`,
      });
    } else {
      await this.assetRepository.updateStatus(asset.id, 'MANUAL_UPLOAD_REQUIRED', {
        action: 'teams_cloud_link_empty',
        detail: 'No supported files found at the Dropbox link',
      });
    }
    return count;
  }

  // Streams one file to blob and records it as a Teams document. Returns false
  // (after draining) when the extension is unsupported so processZipStream never
  // hangs waiting on an unconsumed entry.
  private async stageEntry(
    fileName: string,
    stream: NodeJS.ReadableStream,
    asset: IDomainCloudLinkAsset,
    message: IDomainTeamsMessage,
  ): Promise<boolean> {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.zip' || !env.cloudLinks.supportedExtensions.includes(ext)) {
      stream.resume();
      return false;
    }

    const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const uploadedBy = message.fromId ?? SYSTEM_USER;
    const ctx: AuthContext = { userId: uploadedBy };

    const put = await this.blobStorage.putStream({
      storageKey: this.stagingKey(asset.id, fileName),
      mimeType,
      stream,
    });

    await this.documentPipeline.ingestStagedFile(ctx, {
      projectId: message.projectId ?? null,
      originalName: fileName,
      mimeType,
      storageKey: put.storageKey,
      blobUrl: put.blobUrl,
      byteSize: put.byteSize, // actual uploaded size counted by putStream

      uploadedBy,
      documentType: inferDocumentType(fileName),
      metadata: {
        source: 'teams',
        messageId: message.messageId, // Graph id — the doc<->message association key
        teamId: message.teamId,
        channelId: message.channelId,
        ...(message.parentMessageId ? { parentMessageId: message.parentMessageId } : {}),
        originalUrl: asset.originalUrl,
      },
    });
    return true;
  }

  private stagingKey(assetId: string, fileName: string): string {
    const h = crypto.createHash('sha256').update(`${assetId}:${fileName}`).digest('hex');
    const ext = path.extname(fileName).toLowerCase();
    return `documents/staging/teams-cloud-link/${h.slice(0, 2)}/${h}${ext}`;
  }

  private async markRetry(
    asset: IDomainCloudLinkAsset,
    err: unknown,
    message: IDomainTeamsMessage,
  ): Promise<void> {
    const retryCount = (asset.retryCount ?? 0) + 1;
    const exhausted = retryCount >= MAX_RETRY;
    await this.assetRepository.updateStatus(
      asset.id,
      exhausted ? 'MANUAL_UPLOAD_REQUIRED' : 'DETECTED',
      { action: 'teams_cloud_link_failed', detail: describeError(err) },
      { retryCount },
    );
    // Only once retries are exhausted (the link is truly unfetchable) do we alert
    // the sales manager to upload it by hand, not on every transient retry.
    if (exhausted) await this.notifyFailure(asset, message);
  }

  // Emits the in-app "upload manually" alert for a Dropbox link we could not
  // fetch, naming the project + channel + the failed link. Best-effort.
  private async notifyFailure(
    asset: IDomainCloudLinkAsset,
    message: IDomainTeamsMessage,
  ): Promise<void> {
    if (!this.notificationService) return;
    try {
      let channelName: string | null = null;
      let teamName: string | null = null;
      if (this.monitoredChannelRepository && message.teamId && message.channelId) {
        const chan = await this.monitoredChannelRepository.findByChannel(
          message.teamId,
          message.channelId,
        );
        channelName = chan?.channelName ?? null;
        teamName = chan?.teamName ?? null;
      }
      await this.notificationService.notifyTeamsCloudLinkFailed({
        projectId: message.projectId ?? null,
        channelName,
        teamName,
        failedUrls: [asset.originalUrl],
        messageId: message.messageId,
      });
    } catch (err) {
      console.error(`[TeamsCloudLink] failed to emit failure notification: ${describeError(err)}`);
    }
  }
}
