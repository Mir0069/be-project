import { Readable } from 'stream';

import AdmZip from 'adm-zip';

import { TeamsCloudLinkService } from '@features/teams/teams-cloud-link.service';
import type { CloudLinkService } from '@services/cloud-link.service';
import type {
  ICloudLinkAssetRepository,
  IDomainCloudLinkAsset,
} from '@repositories/interfaces/i-cloud-link-asset.repository';
import type { BlobStorage } from '@features/document-ingestion/document-ingestion.types';
import type { IDomainTeamsMessage } from '@repositories/interfaces/i-teams-message.repository';

jest.mock('@shared/utils/dropbox', () => ({
  getDropboxAccessToken: jest.fn().mockResolvedValue('token'),
  fetchDropboxMetadata: jest.fn(),
  getDropboxFileStream: jest.fn(),
}));
import { env } from '@config/index';
import { fetchDropboxMetadata, getDropboxFileStream } from '@shared/utils/dropbox';

const DROPBOX_URL = 'https://www.dropbox.com/s/abc/plan.pdf';

const makeAsset = (o: Partial<IDomainCloudLinkAsset> = {}): IDomainCloudLinkAsset => ({
  id: 'asset-1',
  emailId: null,
  teamsMessageId: 'db-m1',
  projectId: 'p1',
  originalUrl: DROPBOX_URL,
  normalizedUrl: DROPBOX_URL,
  provider: 'DROPBOX',
  linkText: null,
  sender: 'Pradeep',
  subject: 'msg',
  receivedAt: new Date(),
  status: 'DETECTED',
  storageKey: null,
  blobUrl: null,
  documentId: null,
  firstSeenAt: new Date(),
  lastCheckedAt: null,
  retryCount: 0,
  errorMessage: null,
  auditLog: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeMessage = (o: Partial<IDomainTeamsMessage> = {}): IDomainTeamsMessage => ({
  id: 'db-m1',
  messageId: 'm1',
  teamId: 'team-A',
  channelId: 'chan-A',
  parentMessageId: null,
  fromName: 'Pradeep',
  fromId: 'u-pradeep',
  contentText: `see ${DROPBOX_URL}`,
  contentHtml: null,
  webUrl: null,
  createdDateTime: new Date(),
  attachments: [],
  projectId: 'p1',
  linkMethod: 'CHANNEL_MAP',
  routedToPipeline: false,
  sentToAI: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const zipStream = (files: Array<[string, Buffer]>): Readable => {
  const zip = new AdmZip();
  for (const [name, buf] of files) zip.addFile(name, buf);
  return Readable.from(zip.toBuffer());
};

let cloudLink: { extractAndSaveLinks: jest.Mock };
let assetRepo: { updateStatus: jest.Mock };
let blob: { putStream: jest.Mock };
let pipeline: { ingestStagedFile: jest.Mock };

const build = (): TeamsCloudLinkService =>
  new TeamsCloudLinkService(
    cloudLink as unknown as CloudLinkService,
    assetRepo as unknown as ICloudLinkAssetRepository,
    blob as unknown as BlobStorage,
    pipeline as unknown as never,
  );

beforeEach(() => {
  (env as any).dropbox = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
    accessToken: '',
    rootPath: '/GFS-Projects',
    syncIntervalMs: 1800000,
    pollingEnabled: true,
  };
  cloudLink = { extractAndSaveLinks: jest.fn().mockResolvedValue([makeAsset()]) };
  assetRepo = { updateStatus: jest.fn().mockResolvedValue(null) };
  blob = { putStream: jest.fn().mockResolvedValue({ storageKey: 'sk', blobUrl: 'https://blob/sk', byteSize: 4096 }) };
  pipeline = { ingestStagedFile: jest.fn().mockResolvedValue({ id: 'doc-1' }) };
  (getDropboxFileStream as jest.Mock).mockReset().mockResolvedValue(Readable.from([Buffer.from('pdf')]));
  (fetchDropboxMetadata as jest.Mock).mockReset().mockResolvedValue({ '.tag': 'file', name: 'plan.pdf' });
});

describe('TeamsCloudLinkService.ingestMessageLinks', () => {
  it('stages a single Dropbox file as a Teams document with the right metadata', async () => {
    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(1);
    expect(cloudLink.extractAndSaveLinks).toHaveBeenCalledWith(
      expect.objectContaining({ teamsMessageId: 'db-m1', projectId: 'p1' }),
    );
    expect(blob.putStream).toHaveBeenCalledTimes(1);
    expect(pipeline.ingestStagedFile).toHaveBeenCalledTimes(1);

    const [, input] = pipeline.ingestStagedFile.mock.calls[0];
    expect(input.originalName).toBe('plan.pdf');
    expect(input.mimeType).toBe('application/pdf'); // NOT octet-stream
    expect(input.documentType).toBe('other');
    expect(input.projectId).toBe('p1');
    expect(input.byteSize).toBe(4096); // real size from putStream, not 0
    expect(input.metadata).toEqual({
      source: 'teams',
      messageId: 'm1', // Graph id, not the Mongo _id
      teamId: 'team-A',
      channelId: 'chan-A',
      originalUrl: DROPBOX_URL,
    });
    expect(assetRepo.updateStatus).toHaveBeenCalledWith('asset-1', 'DOWNLOADED', expect.any(Object));
  });

  it('unzips a Dropbox folder, skips directories and unsupported DWG files, and infers per-file type', async () => {
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({ '.tag': 'folder', name: 'drawings' });
    (getDropboxFileStream as jest.Mock).mockResolvedValue(
      zipStream([
        ['drawing.dwg', Buffer.from('dwg')],
        ['photo.jpg', Buffer.from('jpg')],
        ['spec.pdf', Buffer.from('pdf')],
      ]),
    );

    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(2);
    expect(getDropboxFileStream).toHaveBeenCalledWith(DROPBOX_URL, 'token', '', true);
    expect(pipeline.ingestStagedFile).toHaveBeenCalledTimes(2);
    const types = pipeline.ingestStagedFile.mock.calls.map((c) => c[1].documentType).sort();
    expect(types).toEqual(['other', 'photo']);
  });

  it('recurses into a nested zip inside a folder', async () => {
    const inner = new AdmZip();
    inner.addFile('deep.pdf', Buffer.from('x'));
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({ '.tag': 'folder', name: 'f' });
    (getDropboxFileStream as jest.Mock).mockResolvedValue(zipStream([['bundle.zip', inner.toBuffer()]]));

    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(1);
    expect(pipeline.ingestStagedFile.mock.calls[0][1].originalName).toBe('deep.pdf');
  });

  it('skips unsupported extensions and still ingests the supported ones', async () => {
    (fetchDropboxMetadata as jest.Mock).mockResolvedValue({ '.tag': 'folder', name: 'f' });
    (getDropboxFileStream as jest.Mock).mockResolvedValue(
      zipStream([
        ['virus.exe', Buffer.from('nope')],
        ['ok.pdf', Buffer.from('pdf')],
      ]),
    );

    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(1);
    expect(pipeline.ingestStagedFile).toHaveBeenCalledTimes(1);
    expect(pipeline.ingestStagedFile.mock.calls[0][1].originalName).toBe('ok.pdf');
  });

  it('ignores non-Dropbox providers (OneDrive/SharePoint deferred)', async () => {
    cloudLink.extractAndSaveLinks.mockResolvedValue([makeAsset({ provider: 'SHAREPOINT' })]);

    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(0);
    expect(getDropboxFileStream).not.toHaveBeenCalled();
    expect(blob.putStream).not.toHaveBeenCalled();
  });

  it('does not re-fetch an already DOWNLOADED asset (dedup)', async () => {
    cloudLink.extractAndSaveLinks.mockResolvedValue([makeAsset({ status: 'DOWNLOADED' })]);

    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(0);
    expect(getDropboxFileStream).not.toHaveBeenCalled();
    expect(pipeline.ingestStagedFile).not.toHaveBeenCalled();
  });

  it('is best-effort: a fetch error leaves the asset for retry', async () => {
    (getDropboxFileStream as jest.Mock).mockRejectedValue(new Error('dropbox down'));

    const count = await build().ingestMessageLinks(makeMessage());

    expect(count).toBe(0);
    expect(assetRepo.updateStatus).toHaveBeenCalledWith(
      'asset-1',
      'DETECTED',
      expect.any(Object),
      expect.objectContaining({ retryCount: 1 }),
    );
  });

  it('propagates parentMessageId into metadata (meeting-chat links)', async () => {
    await build().ingestMessageLinks(makeMessage({ parentMessageId: 'evt-1' }));
    expect(pipeline.ingestStagedFile.mock.calls[0][1].metadata.parentMessageId).toBe('evt-1');
  });

  it('is a no-op when the message has no project', async () => {
    const count = await build().ingestMessageLinks(makeMessage({ projectId: null }));
    expect(count).toBe(0);
    expect(cloudLink.extractAndSaveLinks).not.toHaveBeenCalled();
  });

  it('maps extensions to real MIME types', async () => {
    const cases: Array<[string, string]> = [
      ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['a.png', 'image/png'],
      ['a.txt', 'text/plain'],
    ];
    for (const [name, mime] of cases) {
      pipeline.ingestStagedFile.mockClear();
      (fetchDropboxMetadata as jest.Mock).mockResolvedValue({ '.tag': 'file', name });
      await build().ingestMessageLinks(makeMessage());
      expect(pipeline.ingestStagedFile.mock.calls[0][1].mimeType).toBe(mime);
    }
  });
});
