import { TeamsFilesService } from '@features/teams/teams-files.service';
import type { ITeamsGraphClient } from '@features/teams/teams.graph-client';
import type { IDocumentIngestionPort } from '@features/teams/document-ingestion.port';

let graph: jest.Mocked<ITeamsGraphClient>;
let port: { upload: jest.Mock };
let service: TeamsFilesService;

beforeEach(() => {
  graph = {
    get: jest.fn(),
    getAllPages: jest.fn(),
    getDelta: jest.fn(),
    getBinary: jest.fn(),
    getAllTranscriptsByOrganizer: jest.fn(),
    getOnlineMeetingIdByJoinUrl: jest.fn(),
    resolveUserId: jest.fn((id: string) => Promise.resolve(id)),
    createSubscription: jest.fn(),
    renewSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
    listSubscriptions: jest.fn().mockResolvedValue([]),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  port = { upload: jest.fn().mockResolvedValue(undefined) };
  service = new TeamsFilesService(graph, port as unknown as IDocumentIngestionPort, true);
});

describe('TeamsFilesService — encodeShareUrl', () => {
  it('produces a base64url "u!" token without padding/+//', () => {
    const token = service.encodeShareUrl(
      'https://contoso.sharepoint.com/sites/x/Shared Documents/General/plan name.pdf',
    );
    expect(token.startsWith('u!')).toBe(true);
    expect(token).not.toContain('=');
    expect(token).not.toContain('/');
    expect(token).not.toContain('+');
  });
});

describe('TeamsFilesService — download', () => {
  it('returns buffer, mime and name from the driveItem (via /shares)', async () => {
    graph.get.mockResolvedValue({ id: 'd1', name: 'plan.pdf', file: { mimeType: 'application/pdf' } });
    graph.getBinary.mockResolvedValue(Buffer.from('PDFDATA'));

    const file = await service.download('https://x/plan.pdf');

    expect(file.originalName).toBe('plan.pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.buffer.toString()).toBe('PDFDATA');
    expect(graph.get).toHaveBeenCalledWith(expect.stringContaining('/shares/u!'));
    expect(graph.getBinary).toHaveBeenCalledWith(expect.stringContaining('/driveItem/content'));
  });

  it('falls back to provided name and octet-stream when driveItem lacks them', async () => {
    graph.get.mockResolvedValue({ id: 'd2' });
    graph.getBinary.mockResolvedValue(Buffer.from('x'));

    const file = await service.download('https://x/y', 'fallback.dwg');

    expect(file.originalName).toBe('fallback.dwg');
    expect(file.mimeType).toBe('application/octet-stream');
  });
});

describe('TeamsFilesService — ingestReferenceAttachment', () => {
  it('downloads and hands off to the port with an inferred documentType', async () => {
    graph.get.mockResolvedValue({ name: 'site.dwg', file: { mimeType: 'application/acad' } });
    graph.getBinary.mockResolvedValue(Buffer.from('DWG'));

    const ok = await service.ingestReferenceAttachment({
      projectId: 'p1',
      uploadedBy: 'u1',
      contentUrl: 'https://x/site.dwg',
    });

    expect(ok).toBe(true);
    expect(port.upload).toHaveBeenCalledTimes(1);
    const [ctx, input] = port.upload.mock.calls[0];
    expect(ctx).toEqual({ userId: 'u1' });
    expect(input.projectId).toBe('p1');
    expect(input.documentType).toBe('drawing'); // .dwg → drawing
    expect(input.file.originalName).toBe('site.dwg');
  });

  it('returns false (does not throw) when the download fails', async () => {
    graph.get.mockRejectedValue(new Error('graph 403'));

    const ok = await service.ingestReferenceAttachment({
      projectId: 'p1',
      uploadedBy: 'u1',
      contentUrl: 'https://x/f.pdf',
    });

    expect(ok).toBe(false);
    expect(port.upload).not.toHaveBeenCalled();
  });

  it('is a no-op when the service is disabled', async () => {
    const disabled = new TeamsFilesService(graph, port as unknown as IDocumentIngestionPort, false);

    const ok = await disabled.ingestReferenceAttachment({
      projectId: 'p1',
      uploadedBy: 'u1',
      contentUrl: 'https://x/f.pdf',
    });

    expect(ok).toBe(false);
    expect(graph.get).not.toHaveBeenCalled();
  });
});

describe('TeamsFilesService — listChannelRecordings (#8 fetch meeting recordings)', () => {
  const wire = (responses: Record<string, unknown>): void => {
    graph.get.mockImplementation(
      (path: string) => Promise.resolve(responses[path]) as never,
    );
  };

  it('returns .mp4/.mov recordings from the channel Recordings folder', async () => {
    wire({
      '/teams/T/channels/C/filesFolder': { id: 'root', parentReference: { driveId: 'D' } },
      '/drives/D/items/root/children': {
        value: [
          { id: 'f1', name: 'Recordings', folder: { childCount: 1 } },
          { id: 'd1', name: 'plan.pdf', size: 100 },
        ],
      },
      '/drives/D/items/f1/children': {
        value: [
          {
            id: 'r1',
            name: 'meeting.mp4',
            size: 5000,
            webUrl: 'http://web',
            '@microsoft.graph.downloadUrl': 'http://dl',
          },
          { id: 'x1', name: 'notes.txt', size: 10 },
        ],
      },
    });

    const recs = await service.listChannelRecordings('T', 'C');

    expect(recs).toEqual([
      { name: 'meeting.mp4', size: 5000, webUrl: 'http://web', downloadUrl: 'http://dl' },
    ]);
  });

  it('also picks up a recording sitting directly in the channel files root', async () => {
    wire({
      '/teams/T/channels/C/filesFolder': { id: 'root', parentReference: { driveId: 'D' } },
      '/drives/D/items/root/children': { value: [{ id: 'r0', name: 'clip.mov', size: 200 }] },
    });

    const recs = await service.listChannelRecordings('T', 'C');

    expect(recs.map((r) => r.name)).toEqual(['clip.mov']);
  });

  it('returns [] when the channel drive cannot be resolved', async () => {
    wire({ '/teams/T/channels/C/filesFolder': { id: 'root' } });

    expect(await service.listChannelRecordings('T', 'C')).toEqual([]);
  });
});

// =============================================================================
// STALE ATTACHMENT LINKS AFTER A TEAM/CHANNEL RENAME
//
// An attachment stores the SharePoint URL it had when it was posted. Renaming a
// team or channel moves the folder underneath it, so every file posted before
// the rename answers 403 accessDenied forever. The channel still knows where
// its files live, so we resolve them there and match by name.
// =============================================================================
describe('TeamsFilesService — recovering a dead attachment link', () => {
  const STALE = 'https://contoso.sharepoint.com/sites/gfs-OLDNAME/Shared Documents/old discussion/Lead Sheet (1).pdf';
  const denied = () => Object.assign(new Error('HTTP 403 accessDenied'), { status: 403 });

  const wireRecovery = (children: unknown[], nested?: Record<string, unknown[]>): void => {
    graph.get.mockImplementation((path: string) => {
      if (path.startsWith('/shares/')) return Promise.reject(denied()) as never;
      if (path === '/teams/T/channels/C/filesFolder') {
        return Promise.resolve({ id: 'root', parentReference: { driveId: 'D' } }) as never;
      }
      if (path === '/drives/D/items/root/children') return Promise.resolve({ value: children }) as never;
      const match = /^\/drives\/D\/items\/(.+)\/children$/.exec(path);
      if (match && nested?.[match[1] as string]) {
        return Promise.resolve({ value: nested[match[1] as string] }) as never;
      }
      return Promise.resolve({ value: [] }) as never;
    });
  };

  it('finds the file by name in the channel folder when the stored link is dead', async () => {
    wireRecovery([{ id: 'x1', name: 'Lead Sheet (1).pdf', file: { mimeType: 'application/pdf' } }]);
    graph.getBinary.mockResolvedValue(Buffer.from('RECOVERED'));

    const file = await service.download(STALE, 'Lead Sheet (1).pdf', { teamId: 'T', channelId: 'C' });

    expect(file.originalName).toBe('Lead Sheet (1).pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.buffer.toString()).toBe('RECOVERED');
    expect(graph.getBinary).toHaveBeenCalledWith('/drives/D/items/x1/content');
  });

  it('looks one level into subfolders, where meeting files land', async () => {
    wireRecovery(
      [{ id: 'sub', name: 'Meeting files', folder: { childCount: 1 } }],
      { sub: [{ id: 'x2', name: 'Lead Sheet (1).pdf', file: { mimeType: 'application/pdf' } }] },
    );
    graph.getBinary.mockResolvedValue(Buffer.from('NESTED'));

    const file = await service.download(STALE, null, { teamId: 'T', channelId: 'C' });

    expect(file.buffer.toString()).toBe('NESTED');
  });

  it('rethrows the original Graph error when the channel is unknown', async () => {
    graph.get.mockRejectedValue(denied());

    await expect(service.download(STALE, 'Lead Sheet (1).pdf')).rejects.toThrow('403');
  });

  it('rethrows when the channel folder holds nothing by that name', async () => {
    wireRecovery([{ id: 'x9', name: 'something else.pdf', file: {} }]);

    await expect(
      service.download(STALE, 'Lead Sheet (1).pdf', { teamId: 'T', channelId: 'C' }),
    ).rejects.toThrow('403');
  });

  it('does not touch the recovery path when the stored link still works', async () => {
    graph.get.mockResolvedValue({ id: 'd1', name: 'plan.pdf', file: { mimeType: 'application/pdf' } });
    graph.getBinary.mockResolvedValue(Buffer.from('PDFDATA'));

    await service.download(STALE, null, { teamId: 'T', channelId: 'C' });

    expect(graph.get).not.toHaveBeenCalledWith('/teams/T/channels/C/filesFolder');
  });
});
