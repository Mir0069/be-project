import { CloudLinkService } from '@services/cloud-link.service';
import type { ICloudLinkAssetRepository } from '@repositories/interfaces/i-cloud-link-asset.repository';
import AdmZip from 'adm-zip';
import { Readable } from 'stream';
import {
  unwrapUrl,
  normalizeUrl,
  classifyProvider,
  shouldFilterUrl,
  cleanPlainTextUrl,
  extractUrls,
} from '@shared/utils/cloud-link';

jest.mock('@shared/utils/dropbox', () => ({
  getDropboxAccessToken: jest.fn().mockResolvedValue('mock-dropbox-token'),
  fetchDropboxMetadata: jest.fn(),
  listDropboxFolder: jest.fn(),
  getDropboxFileStream: jest.fn(),
}));

jest.mock('@shared/utils/graph', () => ({
  encodeShareUrl: jest.fn().mockReturnValue('mock-share-id'),
  fetchGraphShareItem: jest.fn(),
  listGraphShareFolderChildren: jest.fn(),
  getGraphShareFileStream: jest.fn(),
}));

import {
  fetchDropboxMetadata,
  getDropboxFileStream,
} from '@shared/utils/dropbox';

import {
  fetchGraphShareItem,
  getGraphShareFileStream,
} from '@shared/utils/graph';

describe('Cloud Link Utilities', () => {
  describe('unwrapUrl', () => {
    it('should unwrap Outlook Safelinks', () => {
      const wrapped = 'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fdrive.google.com%2Ffile%2Fd%2F123&data=05%7C02%7Ctest';
      expect(unwrapUrl(wrapped)).toBe('https://drive.google.com/file/d/123');
    });

    it('should unwrap Proofpoint URL Defense', () => {
      const wrapped = 'https://urldefense.proofpoint.com/v2/url?u=https-3A__drive.google.com_file_d_123&d=DwIDaQ';
      expect(unwrapUrl(wrapped)).toBe('https://drive.google.com/file/d/123');
    });

    it('should leave normal URLs untouched', () => {
      const url = 'https://drive.google.com/file/d/123';
      expect(unwrapUrl(url)).toBe(url);
    });
  });

  describe('normalizeUrl', () => {
    it('should lowercase hostname and protocol', () => {
      expect(normalizeUrl('HTTPS://Drive.Google.Com/Path')).toBe('https://drive.google.com/Path');
    });

    it('should strip tracking and Microsoft UI parameters', () => {
      const url = 'https://example.sharepoint.com/sites/test?web=1&utm_source=email&activecell=A1&id=123';
      expect(normalizeUrl(url)).toBe('https://example.sharepoint.com/sites/test?id=123');
    });

    it('should remove trailing slash except root', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('should sort remaining query parameters', () => {
      const url = 'https://example.com?z=3&a=1&b=2';
      expect(normalizeUrl(url)).toBe('https://example.com/?a=1&b=2&z=3');
    });
  });

  describe('classifyProvider', () => {
    it('should classify SharePoint URLs', () => {
      expect(classifyProvider('https://company.sharepoint.com/sites/site')).toBe('SHAREPOINT');
    });

    it('should classify OneDrive URLs', () => {
      expect(classifyProvider('https://onedrive.live.com/redir?id=123')).toBe('ONEDRIVE');
      expect(classifyProvider('https://1drv.ms/f/s!An')).toBe('ONEDRIVE');
    });

    it('should classify Google Drive URLs', () => {
      expect(classifyProvider('https://drive.google.com/file/d/123/view')).toBe('GOOGLE_DRIVE');
      expect(classifyProvider('https://docs.google.com/document/d/123/edit')).toBe('GOOGLE_DRIVE');
      expect(classifyProvider('https://sheets.google.com/spreadsheets/d/123')).toBe('GOOGLE_DRIVE');
    });

    it('should classify Dropbox URLs', () => {
      expect(classifyProvider('https://dropbox.com/s/123')).toBe('DROPBOX');
      expect(classifyProvider('https://www.dropbox.com/sh/abc')).toBe('DROPBOX');
    });

    it('should classify HTTP/HTTPS URLs as GENERIC', () => {
      expect(classifyProvider('https://example.com/doc.pdf')).toBe('GENERIC');
    });

    it('should classify other schemes as UNKNOWN', () => {
      expect(classifyProvider('mailto:test@example.com')).toBe('UNKNOWN');
      expect(classifyProvider('invalid-url')).toBe('UNKNOWN');
    });
  });

  describe('shouldFilterUrl', () => {
    it('should filter out unsubscribe links', () => {
      expect(shouldFilterUrl('https://mail.sender.com/unsubscribe?email=test', 'Unsubscribe')).toBe(true);
      expect(shouldFilterUrl('https://sender.com/opt-out', 'opt-out')).toBe(true);
    });

    it('should filter out non-document image/layout assets on generic hosts', () => {
      expect(shouldFilterUrl('https://website.com/logo.png', 'Logo')).toBe(true);
      expect(shouldFilterUrl('https://tracker.com/pixel.gif', null)).toBe(true);
    });

    it('should NOT filter out image assets from cloud providers', () => {
      expect(shouldFilterUrl('https://drive.google.com/file/d/123/image.png', 'My Drawing')).toBe(false);
      expect(shouldFilterUrl('https://company.sharepoint.com/image.jpg', 'Sharepoint Image')).toBe(false);
    });

    it('should filter non-http/https links', () => {
      expect(shouldFilterUrl('mailto:test@example.com', null)).toBe(true);
      expect(shouldFilterUrl('javascript:void(0)', null)).toBe(true);
    });
  });

  describe('cleanPlainTextUrl', () => {
    it('should strip trailing punctuation', () => {
      expect(cleanPlainTextUrl('https://example.com/file.pdf.')).toBe('https://example.com/file.pdf');
      expect(cleanPlainTextUrl('https://example.com/file.pdf,')).toBe('https://example.com/file.pdf');
      expect(cleanPlainTextUrl('https://example.com/file.pdf?')).toBe('https://example.com/file.pdf');
    });

    it('should keep balanced parentheses', () => {
      expect(cleanPlainTextUrl('https://en.wikipedia.org/wiki/URL_(disambiguation)')).toBe('https://en.wikipedia.org/wiki/URL_(disambiguation)');
    });
  });

  describe('extractUrls', () => {
    it('should extract hrefs from HTML a tags and inner labels', () => {
      const html = `<p>Check out this <a href="https://drive.google.com/file/d/1">Google Drive link</a> and this <a href="https://dropbox.com/s/2">Dropbox folder</a>.</p>`;
      const text = `Check out this Google Drive link (https://drive.google.com/file/d/1) and this Dropbox folder.`;
      const result = extractUrls(html, text);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        originalUrl: 'https://drive.google.com/file/d/1',
        linkText: 'Google Drive link',
      });
      expect(result).toContainEqual({
        originalUrl: 'https://dropbox.com/s/2',
        linkText: 'Dropbox folder',
      });
    });

    it('should extract plain text URLs and deduplicate', () => {
      const html = null;
      const text = `Here is drive link https://drive.google.com/file/d/1. Also checkout https://drive.google.com/file/d/1 again.`;
      const result = extractUrls(html, text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        originalUrl: 'https://drive.google.com/file/d/1',
        linkText: null,
      });
    });
  });
});

describe('CloudLinkService', () => {
  let mockRepository: jest.Mocked<ICloudLinkAssetRepository>;
  let service: CloudLinkService;

  beforeEach(() => {
    mockRepository = {
      create: jest.fn().mockImplementation(async (fields) => ({
        id: 'asset-id-123',
        ...fields,
        createdAt: new Date(),
        updatedAt: new Date(),
        auditLog: fields.auditLog || [{ action: fields.status || 'DETECTED', timestamp: new Date(), detail: null }],
      })),
      findById: jest.fn(),
      findByNormalizedUrl: jest.fn(),
      updateStatus: jest.fn(),
      list: jest.fn(),
    };
    service = new CloudLinkService(mockRepository);
  });

  it('should extract, classify, and save new detected links', async () => {
    mockRepository.findByNormalizedUrl.mockResolvedValue(null);

    const result = await service.extractAndSaveLinks({
      emailId: 'email-id-123',
      projectId: 'project-id-456',
      bodyHtml: `<a href="https://drive.google.com/file/d/abc">GDrive Link</a>`,
      bodyText: `https://drive.google.com/file/d/abc`,
      sender: 'sender@example.com',
      subject: 'Weekly Report',
      receivedAt: new Date('2026-07-04T00:00:00Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.originalUrl).toBe('https://drive.google.com/file/d/abc');
    expect(result[0]?.provider).toBe('GOOGLE_DRIVE');
    expect(result[0]?.emailId).toBe('email-id-123');
    expect(result[0]?.projectId).toBe('project-id-456');

    expect(mockRepository.create).toHaveBeenCalledTimes(1);
    expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      originalUrl: 'https://drive.google.com/file/d/abc',
      provider: 'GOOGLE_DRIVE',
      linkText: 'GDrive Link',
      emailId: 'email-id-123',
      projectId: 'project-id-456',
    }));
  });

  it('should return existing asset and not recreate it if already saved for this email', async () => {
    const existingAsset = {
      id: 'asset-id-123',
      emailId: 'email-id-123',
      projectId: 'project-id-456',
      originalUrl: 'https://drive.google.com/file/d/abc',
      normalizedUrl: 'https://drive.google.com/file/d/abc',
      provider: 'GOOGLE_DRIVE' as any,
      linkText: 'GDrive Link',
      sender: 'sender@example.com',
      subject: 'Weekly Report',
      receivedAt: new Date('2026-07-04T00:00:00Z'),
      status: 'DETECTED' as any,
      firstSeenAt: new Date(),
      retryCount: 0,
      auditLog: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockRepository.findByNormalizedUrl.mockResolvedValue(existingAsset);

    const result = await service.extractAndSaveLinks({
      emailId: 'email-id-123',
      projectId: 'project-id-456',
      bodyHtml: `<a href="https://drive.google.com/file/d/abc">GDrive Link</a>`,
      bodyText: `https://drive.google.com/file/d/abc`,
      sender: 'sender@example.com',
      subject: 'Weekly Report',
      receivedAt: new Date('2026-07-04T00:00:00Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('asset-id-123');
    expect(mockRepository.create).not.toHaveBeenCalled();
  });

  it('should ignore unsubscribes and newsletter links', async () => {
    mockRepository.findByNormalizedUrl.mockResolvedValue(null);

    const result = await service.extractAndSaveLinks({
      emailId: 'email-id-123',
      bodyHtml: `<a href="https://mail.sender.com/unsubscribe?id=123">Unsubscribe here</a>`,
      bodyText: `https://mail.sender.com/unsubscribe?id=123`,
      sender: 'sender@example.com',
      subject: 'Newsletter',
      receivedAt: new Date(),
    });

    expect(result).toHaveLength(0);
    expect(mockRepository.create).not.toHaveBeenCalled();
  });
});



describe('CloudLinkService - resolveLink', () => {
  let mockRepository: jest.Mocked<ICloudLinkAssetRepository>;
  let mockBlobStorage: any;
  let mockDocumentPipeline: any;
  let service: CloudLinkService;
  const mockCtx = { userId: 'test-user', roles: ['SYSTEM_ADMIN'] };

  beforeEach(() => {
    mockRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByNormalizedUrl: jest.fn(),
      updateStatus: jest.fn(),
      list: jest.fn(),
    };
    mockBlobStorage = {
      putStream: jest.fn().mockResolvedValue({
        storageKey: 'mock-storage-key',
        blobUrl: 'mock-blob-url',
      }),
    };
    mockDocumentPipeline = {
      ingestStagedFile: jest.fn().mockResolvedValue({
        id: 'mock-doc-id',
        originalName: 'test-file.pdf',
      }),
    };
    service = new CloudLinkService(mockRepository, mockBlobStorage, mockDocumentPipeline);

    jest.clearAllMocks();
  });

  it('should successfully resolve a Dropbox file link', async () => {
    const asset = {
      id: 'asset-dropbox-1',
      provider: 'DROPBOX' as any,
      originalUrl: 'https://dropbox.com/s/file.pdf',
      status: 'DETECTED' as any,
      retryCount: 0,
      projectId: 'proj-123',
      emailId: 'email-123',
    };

    mockRepository.findById.mockResolvedValue(asset as any);
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({
      '.tag': 'file',
      name: 'test-drawing.pdf',
    });
    const mockStream = Readable.from(['fake file content']);
    (getDropboxFileStream as jest.Mock).mockResolvedValue(mockStream);

    await service.resolveLink(asset.id, null, mockCtx);

    expect(mockRepository.updateStatus).toHaveBeenCalledWith(asset.id, 'RESOLVING', expect.any(Object));
    expect(fetchDropboxMetadata).toHaveBeenCalledWith(asset.originalUrl, 'mock-dropbox-token');
    expect(getDropboxFileStream).toHaveBeenCalledWith(asset.originalUrl, 'mock-dropbox-token');
    expect(mockBlobStorage.putStream).toHaveBeenCalledWith({
      storageKey: expect.stringContaining('cloud-link'),
      mimeType: 'application/octet-stream',
      stream: mockStream,
    });
    expect(mockDocumentPipeline.ingestStagedFile).toHaveBeenCalledWith(mockCtx, expect.objectContaining({
      projectId: 'proj-123',
      originalName: 'test-drawing.pdf',
    }));
    expect(mockRepository.updateStatus).toHaveBeenLastCalledWith(
      asset.id,
      'DOWNLOADED',
      expect.any(Object),
      expect.objectContaining({
        documentId: 'mock-doc-id',
      })
    );
  });

  it('should successfully resolve a Dropbox folder link', async () => {
    const asset = {
      id: 'asset-dropbox-folder-1',
      provider: 'DROPBOX' as any,
      originalUrl: 'https://dropbox.com/sh/folder1',
      status: 'DETECTED' as any,
      retryCount: 0,
      projectId: 'proj-123',
    };

    mockRepository.findById.mockResolvedValue(asset as any);
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({
      '.tag': 'folder',
      name: 'drawings-folder',
    });

    const zip = new AdmZip();
    zip.addFile('drawing1.pdf', Buffer.from('pdf1'));
    zip.addFile('drawing2.pdf', Buffer.from('pdf2'));
    zip.addFile('subfolder/', Buffer.alloc(0));
    const mockZipBuffer = zip.toBuffer();

    (getDropboxFileStream as jest.Mock).mockResolvedValue(Readable.from(mockZipBuffer));

    await service.resolveLink(asset.id, null, mockCtx);

    expect(getDropboxFileStream).toHaveBeenCalledWith(asset.originalUrl, 'mock-dropbox-token', '', true);
    expect(mockBlobStorage.putStream).toHaveBeenCalledTimes(2);
    expect(mockDocumentPipeline.ingestStagedFile).toHaveBeenCalledTimes(2);
    expect(mockRepository.updateStatus).toHaveBeenLastCalledWith(
      asset.id,
      'DOWNLOADED',
      expect.objectContaining({ action: 'folder_download_complete' })
    );
  });

  it('should successfully resolve a SharePoint file link', async () => {
    const asset = {
      id: 'asset-sp-1',
      provider: 'SHAREPOINT' as any,
      originalUrl: 'https://company.sharepoint.com/file.docx',
      status: 'DETECTED' as any,
      retryCount: 0,
      projectId: 'proj-123',
    };

    const mockGraphClient = {};
    mockRepository.findById.mockResolvedValue(asset as any);
    (fetchGraphShareItem as jest.Mock).mockResolvedValue({
      name: 'document.docx',
    });
    const mockStream = Readable.from(['docx content']);
    (getGraphShareFileStream as jest.Mock).mockResolvedValue(mockStream);

    await service.resolveLink(asset.id, mockGraphClient, mockCtx);

    expect(fetchGraphShareItem).toHaveBeenCalledWith(mockGraphClient, 'mock-share-id');
    expect(getGraphShareFileStream).toHaveBeenCalledWith(mockGraphClient, 'mock-share-id');
    expect(mockRepository.updateStatus).toHaveBeenLastCalledWith(
      asset.id,
      'DOWNLOADED',
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('should successfully resolve a SharePoint folder link', async () => {
    const asset = {
      id: 'asset-sp-folder-1',
      provider: 'SHAREPOINT' as any,
      originalUrl: 'https://company.sharepoint.com/sites/folder',
      status: 'DETECTED' as any,
      retryCount: 0,
      projectId: 'proj-123',
    };

    const mockGraphClient = {};
    mockRepository.findById.mockResolvedValue(asset as any);
    (fetchGraphShareItem as jest.Mock).mockResolvedValue({
      name: 'folder',
      folder: {},
    });

    const zip = new AdmZip();
    zip.addFile('file1.pdf', Buffer.from('pdf1'));
    zip.addFile('file2.jpg', Buffer.from('jpg2'));
    zip.addFile('subfolder/', Buffer.alloc(0));
    const mockZipBuffer = zip.toBuffer();

    (getGraphShareFileStream as jest.Mock).mockResolvedValue(Readable.from(mockZipBuffer));

    await service.resolveLink(asset.id, mockGraphClient, mockCtx);

    expect(fetchGraphShareItem).toHaveBeenCalledWith(mockGraphClient, 'mock-share-id');
    expect(getGraphShareFileStream).toHaveBeenCalledWith(mockGraphClient, 'mock-share-id');
    expect(mockBlobStorage.putStream).toHaveBeenCalledTimes(2);
    expect(mockRepository.updateStatus).toHaveBeenLastCalledWith(
      asset.id,
      'DOWNLOADED',
      expect.objectContaining({ action: 'folder_download_complete' })
    );
  });

  it('should block unsupported extensions during pre-download check', async () => {
    const asset = {
      id: 'asset-dropbox-exe',
      provider: 'DROPBOX' as any,
      originalUrl: 'https://dropbox.com/s/virus.exe',
      status: 'DETECTED' as any,
      retryCount: 0,
      projectId: 'proj-123',
    };

    mockRepository.findById.mockResolvedValue(asset as any);
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({
      '.tag': 'file',
      name: 'malicious-script.exe',
    });

    await expect(service.resolveLink(asset.id, null, mockCtx)).rejects.toThrow(
      'File extension .exe is not supported by security policy'
    );

    expect(mockRepository.updateStatus).toHaveBeenLastCalledWith(
      asset.id,
      'DETECTED',
      expect.objectContaining({ action: 'resolve_failed' }),
      expect.objectContaining({ retryCount: 1 })
    );
  });

  it('should block DWG and CAD files during pre-download check', async () => {
    const asset = {
      id: 'asset-dropbox-dwg',
      provider: 'DROPBOX' as any,
      originalUrl: 'https://dropbox.com/s/architectural-plan.dwg',
      status: 'DETECTED' as any,
      retryCount: 0,
      projectId: 'proj-123',
    };

    mockRepository.findById.mockResolvedValue(asset as any);
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({
      '.tag': 'file',
      name: 'architectural-plan.dwg',
    });

    await expect(service.resolveLink(asset.id, null, mockCtx)).rejects.toThrow(
      'File extension .dwg is not supported by security policy'
    );
  });
});
