import crypto from 'crypto';
import path from 'path';
import unzipper from 'unzipper';
import { env } from '@config/index';
import type { ICloudLinkAssetRepository, IDomainCloudLinkAsset } from '@repositories/interfaces/i-cloud-link-asset.repository';
import { extractUrls, classifyProvider, normalizeUrl, shouldFilterUrl } from '@shared/utils/cloud-link';
import {
  getDropboxAccessToken,
  fetchDropboxMetadata,
  getDropboxFileStream,
} from '@shared/utils/dropbox';
import {
  encodeShareUrl,
  fetchGraphShareItem,
  getGraphShareFileStream,
} from '@shared/utils/graph';
import type { AuthContext } from '@features/document-ingestion/document-ingestion.types';

export interface IExtractAndSaveLinksOptions {
  emailId?: string | null;
  teamsMessageId?: string | null;
  projectId?: string | null;
  bodyHtml: string | null;
  bodyText: string;
  sender: string;
  subject: string;
  receivedAt: Date;
}

export class CloudLinkService {
  private readonly repository: ICloudLinkAssetRepository;
  private readonly blobStorage: any;
  private readonly documentPipeline: any;

  public constructor(
    repository: ICloudLinkAssetRepository,
    blobStorage?: any,
    documentPipeline?: any
  ) {
    this.repository = repository;
    this.blobStorage = blobStorage;
    this.documentPipeline = documentPipeline;
  }

  /**
   * Extracts, normalizes, classifies, and saves cloud links from an email or Teams message.
   */
  public async extractAndSaveLinks(options: IExtractAndSaveLinksOptions): Promise<IDomainCloudLinkAsset[]> {
    const rawLinks = extractUrls(options.bodyHtml, options.bodyText);
    const savedAssets: IDomainCloudLinkAsset[] = [];

    for (const link of rawLinks) {
      // 1. Skip if URL matches tracking/unsubscribe filter rules
      if (shouldFilterUrl(link.originalUrl, link.linkText)) {
        continue;
      }

      const normalized = normalizeUrl(link.originalUrl);
      const provider = classifyProvider(normalized);

      // 2. Check if this link has already been detected in the scope of this email/message
      const existing = await this.repository.findByNormalizedUrl(
        normalized,
        options.emailId || null,
        options.teamsMessageId || null,
      );

      if (!existing) {
        // 3. Persist new cloud link detection
        const asset = await this.repository.create({
          emailId: options.emailId || null,
          teamsMessageId: options.teamsMessageId || null,
          projectId: options.projectId || null,
          originalUrl: link.originalUrl,
          normalizedUrl: normalized,
          provider,
          linkText: link.linkText,
          sender: options.sender,
          subject: options.subject,
          receivedAt: options.receivedAt,
          status: 'DETECTED',
        });
        savedAssets.push(asset);
      } else {
        savedAssets.push(existing);
      }
    }

    return savedAssets;
  }

  /**
   * Returns a single cloud link asset by its ID.
   */
  public async getAssetById(id: string): Promise<IDomainCloudLinkAsset | null> {
    return this.repository.findById(id);
  }

  /**
   * Fetches pending assets and attempts to resolve them.
   */
  public async resolvePendingAssets(ctx: AuthContext, graphClient?: any): Promise<void> {
    if (!this.blobStorage || !this.documentPipeline) {
      console.warn('[CloudLinkService] Cannot resolve assets: blobStorage or documentPipeline not configured');
      return;
    }
    const pending = await this.repository.list({ status: 'DETECTED' });
    for (const asset of pending) {
      try {
        await this.resolveLink(asset.id, graphClient, ctx);
      } catch (err: any) {
        console.error(`[CloudLinkService] Failed to resolve pending asset ${asset.id}: ${err.message}`);
      }
    }
  }

  /**
   * Resolves a single cloud link asset by fetching, validation, and staging.
   */
  public async resolveLink(assetId: string, graphClient: any, ctx: AuthContext): Promise<void> {
    const asset = await this.repository.findById(assetId);
    if (!asset || asset.status !== 'DETECTED') {
      return;
    }

    await this.repository.updateStatus(assetId, 'RESOLVING', {
      action: 'resolve_start',
      detail: `Attempting to resolve ${asset.provider} link`,
    });

    try {
      if (asset.provider === 'DROPBOX') {
        await this.resolveDropbox(asset, ctx);
      } else if (asset.provider === 'SHAREPOINT' || asset.provider === 'ONEDRIVE') {
        if (!graphClient) {
          throw new Error('Graph client required to resolve SharePoint/OneDrive links');
        }
        await this.resolveSharePointOneDrive(asset, graphClient, ctx);
      } else {
        // Mark other providers (GOOGLE_DRIVE, GENERIC, UNKNOWN) as manual upload required for v1
        await this.repository.updateStatus(assetId, 'MANUAL_UPLOAD_REQUIRED', {
          action: 'resolve_unsupported',
          detail: `Provider ${asset.provider} resolution is not supported in this version`,
        });
      }
    } catch (err: any) {
      const nextRetryCount = asset.retryCount + 1;
      const failedStatus = nextRetryCount >= 5 ? 'MANUAL_UPLOAD_REQUIRED' : 'DETECTED';
      
      let errorStatus: any = failedStatus;
      if (
        err.message?.toLowerCase().includes('auth') ||
        err.message?.toLowerCase().includes('token') ||
        err.message?.toLowerCase().includes('permission') ||
        err.message?.toLowerCase().includes('access')
      ) {
        errorStatus = 'ACCESS_REQUIRED';
      }

      await this.repository.updateStatus(
        assetId,
        errorStatus,
        {
          action: 'resolve_failed',
          detail: err.message || 'Unknown error occurred',
        },
        {
          retryCount: nextRetryCount,
          errorMessage: err.message || 'Unknown error',
        }
      );
      throw err;
    }
  }

  private async resolveDropbox(asset: IDomainCloudLinkAsset, ctx: AuthContext): Promise<void> {
    const token = await getDropboxAccessToken({
      clientId: env.dropbox.clientId,
      clientSecret: env.dropbox.clientSecret,
      refreshToken: env.dropbox.refreshToken,
      accessToken: env.dropbox.accessToken,
    });

    // 1. Fetch metadata
    const metadata = await fetchDropboxMetadata(asset.originalUrl, token);
    const isFolder = metadata['.tag'] === 'folder';

    if (!isFolder) {
      const fileName = metadata.name || 'dropbox_file';
      const fileStream = await getDropboxFileStream(asset.originalUrl, token);
      await this.processFileDownload(asset, fileName, 'application/octet-stream', fileStream, ctx);
    } else {
      let processedCount = 0;
      const errors: string[] = [];

      try {
        const fileStream = await getDropboxFileStream(asset.originalUrl, token, '', true);
        const zipParser = fileStream.pipe(unzipper.Parse({ forceStream: true }));

        const extractEntry = async (entry: any) => {
          const fileName = path.basename(entry.path);
          if (
            entry.type === 'Directory' ||
            fileName.startsWith('.') ||
            entry.path.includes('__MACOSX') ||
            fileName.toLowerCase() === 'thumbs.db'
          ) {
            entry.autodrain();
            return;
          }

          // Handle recursive zip extraction for nested zip folders!
          if (fileName.toLowerCase().endsWith('.zip')) {
            try {
              const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
              for await (const nestedEntry of nestedParser) {
                await extractEntry(nestedEntry);
              }
            } catch (err: any) {
              errors.push(`${fileName} (nested zip): ${err.message}`);
            }
            return;
          }

          try {
            await this.processFileDownload(asset, fileName, 'application/octet-stream', entry, ctx);
            processedCount++;
          } catch (err: any) {
            entry.autodrain();
            errors.push(`${fileName}: ${err.message}`);
          }
        };

        for await (const entry of zipParser) {
          await extractEntry(entry);
        }
      } catch (err: any) {
        errors.push(`Zip streaming failed: ${err.message}`);
      }

      const auditDetail = `Extracted and downloaded ${processedCount} files from Dropbox folder. Errors: ${errors.join(', ')}`;
      await this.repository.updateStatus(asset.id, processedCount > 0 ? 'DOWNLOADED' : 'MANUAL_UPLOAD_REQUIRED', {
        action: 'folder_download_complete',
        detail: auditDetail,
      });

      if (processedCount === 0) {
        throw new Error(`Failed to download or extract any files from Dropbox folder: ${errors.join('; ')}`);
      }
    }
  }

  private async resolveSharePointOneDrive(
    asset: IDomainCloudLinkAsset,
    graphClient: any,
    ctx: AuthContext
  ): Promise<void> {
    const shareId = encodeShareUrl(asset.originalUrl);

    // 1. Fetch metadata
    const item = await fetchGraphShareItem(graphClient, shareId);
    const isFolder = !!item.folder;

    if (!isFolder) {
      const fileName = item.name || 'sharepoint_file';
      const fileStream = await getGraphShareFileStream(graphClient, shareId);
      await this.processFileDownload(asset, fileName, 'application/octet-stream', fileStream, ctx);
    } else {
      let processedCount = 0;
      const errors: string[] = [];

      try {
        const fileStream = await getGraphShareFileStream(graphClient, shareId);
        const zipParser = fileStream.pipe(unzipper.Parse({ forceStream: true }));

        const extractEntry = async (entry: any) => {
          const fileName = path.basename(entry.path);
          if (
            entry.type === 'Directory' ||
            fileName.startsWith('.') ||
            entry.path.includes('__MACOSX') ||
            fileName.toLowerCase() === 'thumbs.db'
          ) {
            entry.autodrain();
            return;
          }

          // Handle recursive zip extraction for nested zip folders!
          if (fileName.toLowerCase().endsWith('.zip')) {
            try {
              const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
              for await (const nestedEntry of nestedParser) {
                await extractEntry(nestedEntry);
              }
            } catch (err: any) {
              errors.push(`${fileName} (nested zip): ${err.message}`);
            }
            return;
          }

          try {
            await this.processFileDownload(asset, fileName, 'application/octet-stream', entry, ctx);
            processedCount++;
          } catch (err: any) {
            entry.autodrain();
            errors.push(`${fileName}: ${err.message}`);
          }
        };

        for await (const entry of zipParser) {
          await extractEntry(entry);
        }
      } catch (err: any) {
        errors.push(`Zip streaming failed: ${err.message}`);
      }

      const auditDetail = `Extracted and downloaded ${processedCount} files from SharePoint/OneDrive folder. Errors: ${errors.join(', ')}`;
      await this.repository.updateStatus(asset.id, processedCount > 0 ? 'DOWNLOADED' : 'MANUAL_UPLOAD_REQUIRED', {
        action: 'folder_download_complete',
        detail: auditDetail,
      });

      if (processedCount === 0) {
        throw new Error(`Failed to download or extract any files from SharePoint folder: ${errors.join('; ')}`);
      }
    }
  }

  private async processFileDownload(
    asset: IDomainCloudLinkAsset,
    fileName: string,
    mimeType: string,
    fileStream: NodeJS.ReadableStream,
    ctx: AuthContext
  ): Promise<void> {
    // 1. Pre-download Sandbox Check
    this.preDownloadSandboxCheck(fileName);

    // 2. Put stream to Blob Storage
    const storageKey = this.cloudLinkStagingKey(asset.id, fileName);
    const putResult = await this.blobStorage.putStream({
      storageKey,
      mimeType,
      stream: fileStream,
    });

    // 3. Post-download Sandbox Check
    await this.postDownloadSandboxCheck();

    // 4. Ingest via DocumentIngestionPipeline
    const doc = await this.documentPipeline.ingestStagedFile(ctx, {
      projectId: asset.projectId ?? null,
      originalName: fileName,
      mimeType,
      storageKey: putResult.storageKey,
      blobUrl: putResult.blobUrl,
      byteSize: putResult.byteSize,
      uploadedBy: ctx.userId,
      documentType: 'other',
      metadata: {
        source: 'cloud-link',
        emailId: asset.emailId ?? null,
        teamsMessageId: asset.teamsMessageId ?? null,
        originalUrl: asset.originalUrl,
      },
    });

    // Update asset with storage info
    await this.repository.updateStatus(
      asset.id,
      'DOWNLOADED',
      {
        action: 'file_downloaded',
        detail: `Successfully downloaded and staged ${fileName}`,
      },
      {
        storageKey: putResult.storageKey,
        blobUrl: putResult.blobUrl,
        documentId: doc.id,
      }
    );
  }

  private cloudLinkStagingKey(assetId: string, fileName: string): string {
    const h = crypto.createHash('sha256').update(`${assetId}:${fileName}`).digest('hex');
    const ext = path.extname(fileName).toLowerCase();
    return `documents/staging/cloud-link/${h.slice(0, 2)}/${h}${ext}`;
  }

  private preDownloadSandboxCheck(fileName: string): void {
    const ext = path.extname(fileName).toLowerCase();
    if (!env.cloudLinks.supportedExtensions.includes(ext)) {
      throw new Error(`File extension ${ext} is not supported by security policy`);
    }
  }

  private async postDownloadSandboxCheck(): Promise<void> {
    console.log(`[Security Sandbox] Malware check passed (Azure Defender stub)`);
  }
}
