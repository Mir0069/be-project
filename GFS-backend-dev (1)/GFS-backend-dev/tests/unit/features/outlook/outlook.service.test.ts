import mongoose from 'mongoose';
import { Readable } from 'stream';
import AdmZip from 'adm-zip';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import { fetchGraphShareItem, getGraphShareFileStream } from '@shared/utils/graph';
import { env } from '@config/index';
import { OutlookService } from '@features/outlook/outlook.service';
import type { IOutlookGraphClient } from '@features/outlook/outlook.graph-client';
import type { OutlookTokenService } from '@features/outlook/outlook-token.service';
import type { OutlookAssociationService } from '@features/outlook/outlook-association.service';

jest.mock('@shared/utils/graph', () => {
  const actual = jest.requireActual('@shared/utils/graph');
  return {
    ...actual,
    fetchGraphShareItem: jest.fn(),
    getGraphShareFileStream: jest.fn(),
  };
});

jest.mock('@db/models/document.model', () => {
  const mockFind = jest.fn().mockImplementation(() => ({
    lean: jest.fn().mockResolvedValue([]),
    catch: jest.fn().mockResolvedValue([]),
    then: jest.fn().mockImplementation((cb) => Promise.resolve(cb([]))),
  }));
  (mockFind as any).lean = jest.fn().mockResolvedValue([]);
  const mockFindOne = jest.fn().mockImplementation(() => ({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  }));
  return {
    DocumentModel: {
      create: jest.fn().mockResolvedValue({ id: 'mock-doc-id' }),
      find: mockFind,
      findOne: mockFindOne,
      updateMany: jest.fn().mockReturnValue({ catch: jest.fn().mockResolvedValue(undefined) }),
      updateOne: jest.fn().mockResolvedValue({}),
    },
  };
});
import { DocumentModel } from '@db/models/document.model';
import {
  REFERENCE_ATTACHMENT_ODATA_TYPE,
  FILE_ATTACHMENT_ODATA_TYPE,
  type GraphMailMessage,
} from '@features/outlook/outlook.types';
import type {
  IOutlookMonitoredMailboxRepository,
  IDomainMonitoredMailbox,
} from '@repositories/interfaces/i-outlook-monitored-mailbox.repository';
import type {
  IOutlookEmailRepository,
  IDomainOutlookEmailAttachment,
} from '@repositories/interfaces/i-outlook-email.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

const makeMailbox = (
  overrides: Partial<IDomainMonitoredMailbox> = {},
): IDomainMonitoredMailbox => ({
  id: 'mb-db-1',
  userId: 'sales@gfs.com',
  displayName: 'Sales Inbox',
  folderId: 'inbox',
  projectId: null,
  deltaLink: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMail = (overrides: Partial<GraphMailMessage> = {}): GraphMailMessage => ({
  id: 'mail-1',
  internetMessageId: '<abc@acme.com>',
  conversationId: 'conv-1',
  subject: 'RE: Skylight inquiry',
  from: { emailAddress: { name: 'Jane', address: 'jane@acme.com' } },
  toRecipients: [{ emailAddress: { address: 'sales@gfs.com' } }],
  ccRecipients: [{ emailAddress: { address: 'cc@gfs.com' } }],
  bccRecipients: [{ emailAddress: { address: 'bcc@gfs.com' } }],
  body: { contentType: 'html', content: '<p>Hello <b>world</b></p>' },
  receivedDateTime: '2026-06-01T10:00:00Z',
  webLink: 'https://outlook.office365.com/owa/?ItemID=mail-1',
  hasAttachments: false,
  isDraft: false,
  ...overrides,
});

let graphClient: jest.Mocked<IOutlookGraphClient>;
let mailboxRepo: jest.Mocked<IOutlookMonitoredMailboxRepository>;
let emailRepo: jest.Mocked<IOutlookEmailRepository>;
let projectRepo: jest.Mocked<IProjectRepository>;
let association: { resolveProject: jest.Mock };
let tokenService: { isConfigured: jest.Mock; getCachedToken: jest.Mock; isDelegated: jest.Mock };
let documentPort: { upload: jest.Mock; ingestEmailPackage: jest.Mock };
let service: OutlookService;

beforeEach(() => {
  delete process.env['OUTLOOK_CENTRALIZED_MAILBOX'];
  graphClient = {
    get: jest.fn().mockResolvedValue({ value: [] }), // default: attachment list empty
    getAllPages: jest.fn(),
    getDelta: jest.fn(),
    getBinary: jest.fn(),
    getStream: jest.fn(),
    delete: jest.fn(),
    permanentDelete: jest.fn().mockResolvedValue(undefined),
  };
  mailboxRepo = {
    listActive: jest.fn(),
    findById: jest.fn(),
    findByMailbox: jest.fn(),
    upsert: jest.fn(),
    updateDeltaLink: jest.fn(),
    deactivate: jest.fn(),
  };
  emailRepo = {
    // Return a realistic domain email so attachment/body routing can run on it.
    upsertByMessageId: jest.fn().mockImplementation(async (fields) => ({
      id: `db-${fields.messageId}`,
      routedToPipeline: false,
      ...fields,
      status: fields.status ?? 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findByMessageId: jest.fn(),
    list: jest.fn(),
    listParticipantsByProjectId: jest.fn().mockResolvedValue([]),
    setProject: jest.fn(),
    markAttachmentsDownloaded: jest.fn(),
    markRoutedToPipeline: jest.fn(),
    findWithUnstagedAttachments: jest.fn().mockResolvedValue([]),
    setAttachmentStaged: jest.fn(),
    recordAttachmentStageFailure: jest.fn(),
  };
  projectRepo = {
    findById: jest.fn(),
    findByReferenceNumber: jest.fn(),
    findByZohoLeadId: jest.fn(),
    listActive: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  };
  association = { resolveProject: jest.fn().mockResolvedValue({ projectId: null, linkMethod: null }) };
  tokenService = {
    isConfigured: jest.fn().mockReturnValue(true),
    getCachedToken: jest.fn().mockResolvedValue(null),
    isDelegated: jest.fn().mockResolvedValue(false),
  };
  documentPort = {
    upload: jest.fn().mockResolvedValue(undefined),
    ingestEmailPackage: jest.fn().mockResolvedValue(undefined),
  };

  service = new OutlookService(
    graphClient,
    tokenService as unknown as OutlookTokenService,
    mailboxRepo,
    emailRepo,
    association as unknown as OutlookAssociationService,
    projectRepo,
    documentPort,
    {} as any, // workspaceService
  );

  (fetchGraphShareItem as jest.Mock).mockResolvedValue({
    name: 'some-file.docx',
    file: {},
  });
});

describe('OutlookService — syncMailbox', () => {
  it('ingests mail, skips drafts and removed entries, strips HTML, and advances the deltaLink', async () => {
    graphClient.getDelta.mockResolvedValue({
      items: [
        makeMail({ id: 'mail-1' }),
        makeMail({ id: 'mail-draft', isDraft: true }),
        { id: 'mail-del', '@removed': { reason: 'deleted' } } as GraphMailMessage,
      ],
      deltaLink: 'https://graph.microsoft.com/delta-next',
    });
    emailRepo.findByMessageId.mockResolvedValue(null);
    association.resolveProject.mockResolvedValue({ projectId: 'p1', linkMethod: 'AUTO' });

    const result = await service.syncMailbox(makeMailbox());

    expect(result.ingested).toBe(1);
    expect(emailRepo.upsertByMessageId).toHaveBeenCalledTimes(1);
    const upserted = emailRepo.upsertByMessageId.mock.calls[0]?.[0];
    expect(upserted?.messageId).toBe('mail-1');
    expect(upserted?.bodyText).toBe('Hello world'); // HTML stripped
    expect(upserted?.bodyHtml).toBe('<p>Hello <b>world</b></p>');
    expect(upserted?.fromAddress).toBe('jane@acme.com');
    expect(upserted?.toRecipients).toEqual(['sales@gfs.com']);
    expect(upserted?.ccRecipients).toEqual(['cc@gfs.com']);
    expect(upserted?.bccRecipients).toEqual(['bcc@gfs.com']);
    expect(upserted?.projectId).toBe('p1');
    expect(upserted?.linkMethod).toBe('AUTO');
    expect(mailboxRepo.updateDeltaLink).toHaveBeenCalledWith(
      'mb-db-1',
      'https://graph.microsoft.com/delta-next',
    );
  });

  it('builds the initial delta URL from the mailbox, folder and a $select projection', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: null });

    await service.syncMailbox(makeMailbox());

    const startUrl = graphClient.getDelta.mock.calls[0]?.[0] as string;
    expect(startUrl).toContain('/users/sales%40gfs.com/mailFolders/inbox/messages/delta');
    expect(startUrl).toContain('$select=');
    expect(startUrl).toContain('body');
    expect(startUrl).toContain('hasAttachments');
  });

  it('starts from the stored deltaLink when present', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [], deltaLink: null });

    await service.syncMailbox(makeMailbox({ deltaLink: 'https://graph.microsoft.com/v1.0/saved-delta' }));

    expect(graphClient.getDelta).toHaveBeenCalledWith('/saved-delta');
  });

  it('automatically recovers when stored deltaLink expires (HTTP 410 / SyncStateNotFound)', async () => {
    // 1st call fails with 410 SyncStateNotFound
    graphClient.getDelta.mockRejectedValueOnce(
      new AppError('Microsoft Graph request failed', StatusCodes.GONE, true, {
        code: ErrorCode.OUTLOOK_API_ERROR,
        details: { error: { code: 'SyncStateNotFound', message: 'The sync state generation is not found' } },
      }),
    );
    // 2nd call succeeds with initial delta query
    graphClient.getDelta.mockResolvedValueOnce({
      items: [],
      deltaLink: 'https://graph.microsoft.com/v1.0/fresh-delta',
    });

    const mailbox = makeMailbox({ id: 'mb-1', deltaLink: 'https://graph.microsoft.com/v1.0/expired-delta' });
    const result = await service.syncMailbox(mailbox);

    // Monitored repository should have been cleared to null first, then updated to new delta
    expect(mailboxRepo.updateDeltaLink).toHaveBeenCalledWith('mb-1', null);
    expect(mailboxRepo.updateDeltaLink).toHaveBeenCalledWith('mb-1', 'https://graph.microsoft.com/v1.0/fresh-delta');

    // 2 calls made to getDelta: 1st with expired delta, 2nd with initial delta query
    expect(graphClient.getDelta).toHaveBeenCalledTimes(2);
    expect(graphClient.getDelta).toHaveBeenNthCalledWith(1, '/expired-delta');
    expect(graphClient.getDelta).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/users/sales%40gfs.com/mailFolders/inbox/messages/delta'),
    );
    expect(result.ingested).toBe(0);
  });

  it('preserves an existing MANUAL link instead of re-resolving', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [makeMail({ id: 'mail-1' })], deltaLink: null });
    emailRepo.findByMessageId.mockResolvedValue({
      id: 'x', messageId: 'mail-1', mailboxUserId: 'sales@gfs.com',
      toRecipients: [], ccRecipients: [], bccRecipients: [], bodyText: 'prev', receivedDateTime: new Date(), attachments: [],
      projectId: 'manual-project', linkMethod: 'MANUAL', routedToPipeline: false,
      status: 'PENDING' as const,
      createdAt: new Date(), updatedAt: new Date(),
    });

    await service.syncMailbox(makeMailbox());

    expect(association.resolveProject).not.toHaveBeenCalled();
    const upserted = emailRepo.upsertByMessageId.mock.calls[0]?.[0];
    expect(upserted?.projectId).toBe('manual-project');
    expect(upserted?.linkMethod).toBe('MANUAL');
  });

  it('fetches attachment metadata only when hasAttachments is set, keeping fileAttachments and referenceAttachments (when Graph beta is configured)', async () => {
    // Force beta endpoint
    const originalUrl = env.outlook.graphBaseUrl;
    (env.outlook as any).graphBaseUrl = 'https://graph.microsoft.com/beta';

    try {
      graphClient.getDelta.mockResolvedValue({
        items: [makeMail({ id: 'mail-att', hasAttachments: true })],
        deltaLink: null,
      });
      emailRepo.findByMessageId.mockResolvedValue(null);
      graphClient.get.mockResolvedValue({
        value: [
          {
            id: 'att1', '@odata.type': FILE_ATTACHMENT_ODATA_TYPE,
            name: 'plan.pdf', contentType: 'application/pdf', size: 1234, isInline: false,
          },
          {
            id: 'att2', '@odata.type': '#microsoft.graph.itemAttachment',
            name: 'forwarded-mail', contentType: null,
          },
          {
            id: 'att3', '@odata.type': REFERENCE_ATTACHMENT_ODATA_TYPE,
            name: 'cloud-file.docx', contentType: 'application/vnd.docx', size: 5678, isInline: false,
            sourceUrl: 'https://gfs.sharepoint.com/:w:/r/sites/Files/cloud-file.docx',
          },
        ],
      });

      await service.syncMailbox(makeMailbox());

      expect(graphClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/users/sales%40gfs.com/messages/mail-att/attachments'),
        undefined,
      );
      const upserted = emailRepo.upsertByMessageId.mock.calls[0]?.[0];
      expect(upserted?.attachments).toHaveLength(2);
      expect(upserted?.attachments[0]).toMatchObject({ id: 'att1', name: 'plan.pdf', downloaded: false, isReference: false });
      expect(upserted?.attachments[1]).toMatchObject({
        id: 'att3',
        name: 'cloud-file.docx',
        downloaded: false,
        isReference: true,
        sourceUrl: 'https://gfs.sharepoint.com/:w:/r/sites/Files/cloud-file.docx',
      });
    } finally {
      // Restore original URL
      (env.outlook as any).graphBaseUrl = originalUrl;
    }
  });

  it('omits sourceUrl from $select when running on Graph v1.0, and skips reference attachment staging', async () => {
    // Force v1.0 endpoint
    const originalUrl = env.outlook.graphBaseUrl;
    (env.outlook as any).graphBaseUrl = 'https://graph.microsoft.com/v1.0';

    try {
      graphClient.getDelta.mockResolvedValue({
        items: [makeMail({ id: 'mail-att', hasAttachments: true })],
        deltaLink: null,
      });
      emailRepo.findByMessageId.mockResolvedValue(null);
      // v1.0 won't return sourceUrl
      graphClient.get.mockResolvedValue({
        value: [
          {
            id: 'att1', '@odata.type': FILE_ATTACHMENT_ODATA_TYPE,
            name: 'plan.pdf', contentType: 'application/pdf', size: 1234, isInline: false,
          },
          {
            id: 'att-ref', '@odata.type': REFERENCE_ATTACHMENT_ODATA_TYPE,
            name: 'cloud-file.docx', contentType: 'application/vnd.docx', size: 5678, isInline: false,
            // no sourceUrl
          },
        ],
      });

      await service.syncMailbox(makeMailbox());

      expect(graphClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/users/sales%40gfs.com/messages/mail-att/attachments'),
        expect.objectContaining({ $select: 'id,name,contentType,size,isInline' }), // NO sourceUrl!
      );
      const upserted = emailRepo.upsertByMessageId.mock.calls[0]?.[0];
      expect(upserted?.attachments).toHaveLength(2);
      expect(upserted?.attachments[1]).toMatchObject({
        id: 'att-ref',
        name: 'cloud-file.docx',
        downloaded: false,
        isReference: true,
        sourceUrl: null,
      });
    } finally {
      // Restore original URL
      (env.outlook as any).graphBaseUrl = originalUrl;
    }
  });

  it('does not fetch attachments for mail without hasAttachments', async () => {
    graphClient.getDelta.mockResolvedValue({ items: [makeMail({ id: 'mail-1' })], deltaLink: null });
    emailRepo.findByMessageId.mockResolvedValue(null);

    await service.syncMailbox(makeMailbox());

    expect(graphClient.get).not.toHaveBeenCalled();
  });

  it('re-throws transient errors during message ingestion to halt sync', async () => {
    graphClient.getDelta.mockResolvedValue({
      items: [makeMail({ id: 'mail-fail', hasAttachments: true })],
      deltaLink: 'https://graph.microsoft.com/delta-next',
    });
    // Throw transient 429
    graphClient.get.mockRejectedValue(new AppError('Rate limit exceeded', 429));

    await expect(service.syncMailbox(makeMailbox())).rejects.toThrow('Rate limit exceeded');
    expect(mailboxRepo.updateDeltaLink).not.toHaveBeenCalled();
  });

  it('skips fatal errors during message ingestion, continuing with other messages and updating deltaLink', async () => {
    graphClient.getDelta.mockResolvedValue({
      items: [
        makeMail({ id: 'mail-fatal', hasAttachments: true }),
        makeMail({ id: 'mail-ok', hasAttachments: false }),
      ],
      deltaLink: 'https://graph.microsoft.com/delta-next',
    });
    // Throw fatal 404 for mail-fatal
    graphClient.get.mockRejectedValueOnce(new AppError('Not found', 404));

    const result = await service.syncMailbox(makeMailbox());

    expect(result.ingested).toBe(1); // Only mail-ok successfully ingested
    expect(mailboxRepo.updateDeltaLink).toHaveBeenCalledWith(
      'mb-db-1',
      'https://graph.microsoft.com/delta-next',
    );
  });
});

describe('OutlookService — syncAll', () => {
  it('isolates per-mailbox failures', async () => {
    mailboxRepo.listActive.mockResolvedValue([
      makeMailbox({ id: 'mb-1', userId: 'a@gfs.com' }),
      makeMailbox({ id: 'mb-2', userId: 'b@gfs.com' }),
    ]);
    graphClient.getDelta
      .mockResolvedValueOnce({ items: [], deltaLink: null })
      .mockRejectedValueOnce(new Error('graph boom'));

    const summary = await service.syncAll();

    expect(summary.mailboxes).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.mailboxUserId).toBe('b@gfs.com');
  });
});

describe('OutlookService — sync (single mailbox)', () => {
  it('throws 404 for an unknown or inactive mailbox id', async () => {
    mailboxRepo.findById.mockResolvedValue(null);
    await expect(service.sync('missing')).rejects.toMatchObject({ statusCode: 404 });

    mailboxRepo.findById.mockResolvedValue(makeMailbox({ isActive: false }));
    await expect(service.sync('mb-db-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('OutlookService — addMonitoredMailbox', () => {
  const input = { userId: 'sales@gfs.com', displayName: 'Sales Inbox' };

  it('rejects a mailbox that is already actively monitored', async () => {
    mailboxRepo.findByMailbox.mockResolvedValue(makeMailbox({ isActive: true }));

    await expect(service.addMonitoredMailbox(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(mailboxRepo.upsert).not.toHaveBeenCalled();
  });

  it('rejects when the mapped project does not exist', async () => {
    projectRepo.findById.mockResolvedValue(null);

    await expect(
      service.addMonitoredMailbox({ ...input, projectId: 'missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('upserts a new monitored mailbox defaulting the folder to inbox', async () => {
    mailboxRepo.findByMailbox.mockResolvedValue(null);
    mailboxRepo.upsert.mockResolvedValue(makeMailbox());

    const result = await service.addMonitoredMailbox(input);

    expect(result.userId).toBe('sales@gfs.com');
    expect(mailboxRepo.findByMailbox).toHaveBeenCalledWith('sales@gfs.com', 'inbox');
    expect(mailboxRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'inbox' }),
    );
  });
});

describe('OutlookService — removeMonitoredMailbox', () => {
  it('throws 404 when the mailbox does not exist', async () => {
    mailboxRepo.deactivate.mockResolvedValue(null);
    await expect(service.removeMonitoredMailbox('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('OutlookService — ensureCentralizedMailbox', () => {
  it('idempotently upserts the central mailbox on the inbox folder', async () => {
    mailboxRepo.upsert.mockResolvedValue(makeMailbox({ userId: 'centralized@gfs.com' }));

    await service.ensureCentralizedMailbox('centralized@gfs.com');

    expect(mailboxRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'centralized@gfs.com', folderId: 'inbox' }),
    );
  });
});

describe('OutlookService — linkEmail', () => {
  it('throws 404 when the project is missing', async () => {
    projectRepo.findById.mockResolvedValue(null);
    await expect(service.linkEmail('mail-1', 'p-missing')).rejects.toBeInstanceOf(AppError);
  });

  it('throws 404 when the email is missing', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    emailRepo.setProject.mockResolvedValue(null);
    await expect(service.linkEmail('mail-missing', 'p1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sets a MANUAL link on success', async () => {
    projectRepo.findById.mockResolvedValue({ id: 'p1' } as never);
    emailRepo.setProject.mockResolvedValue({
      id: 'x', messageId: 'mail-1', mailboxUserId: 'sales@gfs.com',
      toRecipients: [], ccRecipients: [], bccRecipients: [], bodyText: 'hello there', receivedDateTime: new Date(), attachments: [],
      projectId: 'p1', linkMethod: 'MANUAL', routedToPipeline: false,
      status: 'PENDING' as const,
      createdAt: new Date(), updatedAt: new Date(),
    });

    await service.linkEmail('mail-1', 'p1');

    expect(emailRepo.setProject).toHaveBeenCalledWith('mail-1', 'p1', 'MANUAL');
  });
});

describe('OutlookService — getStatus', () => {
  it('reports configured state and monitored mailbox count', async () => {
    mailboxRepo.listActive.mockResolvedValue([makeMailbox(), makeMailbox({ id: 'mb-2' })]);

    const status = await service.getStatus();

    expect(status.configured).toBe(true);
    expect(status.monitoredMailboxCount).toBe(2);
    expect(status.cachedTokenExpiresAt).toBeNull();
  });
});

describe('OutlookService — Reference Attachment Staging', () => {
  let stagingService: OutlookService;
  let blobStorage: jest.Mocked<any>;

  beforeEach(() => {
    blobStorage = {
      put: jest.fn(),
      putStream: jest.fn().mockResolvedValue({
        storageKey: 'documents/staging/mock-key.docx',
        blobUrl: 'https://mock.blob.core.windows.net/container/mock-key.docx',
        sha256: 'mock-sha',
        byteSize: 1234,
      }),
      delete: jest.fn(),
      createSignedDownloadUrl: jest.fn(),
    } as any;

    stagingService = new OutlookService(
      graphClient,
      tokenService as unknown as OutlookTokenService,
      mailboxRepo,
      emailRepo,
      association as unknown as OutlookAssociationService,
      projectRepo,
      documentPort,
      blobStorage,
    );
  });

  it('stages reference attachments by encoding sourceUrl and requesting driveItem content', async () => {
    const sourceUrl = 'https://gfs.sharepoint.com/:w:/r/sites/Files/plan.docx';
    const mockStream = { pipe: jest.fn() } as any;
    graphClient.getStream.mockResolvedValue(mockStream);

    const attachments: IDomainOutlookEmailAttachment[] = [
      {
        id: 'att-ref',
        name: 'plan.docx',
        contentType: 'application/vnd.docx',
        size: 5678,
        isInline: false,
        isReference: true,
        sourceUrl,
        downloaded: false,
      },
    ];

    const existingById = new Map();

    await (stagingService as any).stageAttachments('user-1', 'mail-123', attachments, existingById);

    expect(graphClient.getStream).toHaveBeenCalledWith(
      expect.stringContaining('/shares/u!')
    );

    const expectedShareId = 'u!' + Buffer.from(sourceUrl, 'utf8').toString('base64').replace(/=+$/g, '').replace(/\//g, '_').replace(/\+/g, '-');
    expect(graphClient.getStream).toHaveBeenCalledWith(`/shares/${expectedShareId}/driveItem/content`);

    expect(blobStorage.putStream).toHaveBeenCalledWith({
      storageKey: expect.stringContaining('.docx'),
      mimeType: 'application/vnd.docx',
      stream: mockStream,
    });

    expect(attachments[0]?.downloaded).toBe(true);
    expect(attachments[0]?.storageKey).toBe('documents/staging/mock-key.docx');
    expect(attachments[0]?.blobUrl).toBe('https://mock.blob.core.windows.net/container/mock-key.docx');
  });

  it('backfills reference attachments that failed to stage on an earlier sync', async () => {
    const sourceUrl = 'https://gfs.sharepoint.com/:w:/r/sites/Files/plan.docx';
    const mockStream = { pipe: jest.fn() } as any;
    graphClient.getStream.mockResolvedValue(mockStream);

    const emailWithUnstagedRef = {
      messageId: 'mail-123',
      mailboxUserId: 'user-1',
      attachments: [
        {
          id: 'att-ref',
          name: 'plan.docx',
          contentType: 'application/vnd.docx',
          size: 5678,
          isInline: false,
          isReference: true,
          sourceUrl,
          downloaded: false,
          stageAttempts: 1,
        },
      ],
    };

    emailRepo.findWithUnstagedAttachments.mockResolvedValue([emailWithUnstagedRef as any]);

    await (stagingService as any).backfillUnstaged('user-1');

    expect(graphClient.getStream).toHaveBeenCalled();
    expect(blobStorage.putStream).toHaveBeenCalled();
    expect(emailRepo.setAttachmentStaged).toHaveBeenCalledWith(
      'mail-123',
      'att-ref',
      'documents/staging/mock-key.docx',
      'https://mock.blob.core.windows.net/container/mock-key.docx'
    );
  });

  it('stages reference folder attachments by unzipping and staging files', async () => {
    const sourceUrl = 'https://gfs.sharepoint.com/sites/Files/folder1';
    
    (fetchGraphShareItem as jest.Mock).mockResolvedValue({
      name: 'folder1',
      folder: {},
    });

    const zip = new AdmZip();
    zip.addFile('sheet1.pdf', Buffer.from('pdf-data'));
    zip.addFile('image2.png', Buffer.from('png-data'));
    zip.addFile('unsupported.exe', Buffer.from('exe-data'));
    const mockZipBuffer = zip.toBuffer();

    (getGraphShareFileStream as jest.Mock).mockResolvedValue(Readable.from(mockZipBuffer));
    
    emailRepo.findByMessageId.mockResolvedValue({
      id: new mongoose.Types.ObjectId(),
      messageId: 'mail-folder-123',
      projectId: new mongoose.Types.ObjectId().toString(),
      fromAddress: 'sender@example.com',
    } as any);

    const attachments: any[] = [
      {
        id: 'att-ref-folder',
        name: 'folder1',
        contentType: 'application/octet-stream',
        size: 0,
        isInline: false,
        isReference: true,
        sourceUrl,
        downloaded: false,
      },
    ];

    const existingById = new Map();

    await (stagingService as any).stageAttachments('user-1', 'mail-folder-123', attachments, existingById);

    expect(fetchGraphShareItem).toHaveBeenCalled();
    expect(getGraphShareFileStream).toHaveBeenCalled();
    expect(blobStorage.putStream).toHaveBeenCalledTimes(2);

    expect(attachments[0]?.downloaded).toBe(true);
    expect(attachments[0]?.storageKey).toBe('FOLDER_STAGED');
  });

  it('reuses pre-existing staged document in DocumentModel and skips calling Graph', async () => {
    const attachments: IDomainOutlookEmailAttachment[] = [
      {
        id: 'att-existing',
        name: 'already-staged.pdf',
        contentType: 'application/pdf',
        size: 12345,
        isInline: false,
        isReference: false,
        downloaded: false,
      },
    ];

    (DocumentModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          storageKey: 'documents/staging/mock-existing.pdf',
          blobUrl: 'https://mock.blob/already-staged.pdf',
        }),
      }),
    });

    await (stagingService as any).stageAttachments('user-1', 'mail-123', attachments, new Map());

    expect(graphClient.getStream).not.toHaveBeenCalled();
    expect(attachments[0]?.downloaded).toBe(true);
    expect(attachments[0]?.storageKey).toBe('documents/staging/mock-existing.pdf');
    expect(attachments[0]?.blobUrl).toBe('https://mock.blob/already-staged.pdf');
  });

  it('fails fast and sets stageAttempts to MAX_STAGE_ATTEMPTS when Graph returns 404 ItemNotFound', async () => {
    const attachments: IDomainOutlookEmailAttachment[] = [
      {
        id: 'att-404',
        name: 'missing.pdf',
        contentType: 'application/pdf',
        size: 12345,
        isInline: false,
        isReference: false,
        downloaded: false,
      },
    ];

    (DocumentModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    graphClient.getStream.mockRejectedValue(
      new AppError('Microsoft Graph request failed', StatusCodes.NOT_FOUND, true, {
        code: ErrorCode.OUTLOOK_API_ERROR,
        details: { error: { code: 'ErrorItemNotFound', message: 'Item not found in store' } },
      }),
    );

    await (stagingService as any).stageAttachments('user-1', 'mail-123', attachments, new Map());

    expect(attachments[0]?.downloaded).toBe(false);
    expect(attachments[0]?.stageAttempts).toBe(5); // MAX_STAGE_ATTEMPTS = 5
  });

  describe('moveEmail', () => {
    it('throws NOT_FOUND if target project does not exist', async () => {
      projectRepo.findById.mockResolvedValue(null);
      await expect(service.moveEmail('msg-1', 'target-proj-id')).rejects.toThrow('Target project not found');
    });

    it('throws error if email is already linked to the target project', async () => {
      const targetProjId = new mongoose.Types.ObjectId().toString();
      projectRepo.findById.mockResolvedValue({
        id: targetProjId,
        referenceNumber: 'PRJ-2026-0001',
        projectName: 'Target Project',
      } as any);

      emailRepo.findByMessageId.mockResolvedValue({
        id: new mongoose.Types.ObjectId().toString(),
        messageId: 'msg-1',
        projectId: targetProjId,
        attachments: [],
      } as any);

      await expect(service.moveEmail('msg-1', targetProjId)).rejects.toThrow('Email is already linked to this project');
    });

    it('moves email and its documents to target project successfully', async () => {
      const sourceProjId = new mongoose.Types.ObjectId().toString();
      const targetProjId = new mongoose.Types.ObjectId().toString();

      projectRepo.findById.mockImplementation(async (id: string) => {
        if (id === targetProjId) {
          return { id: targetProjId, referenceNumber: 'PRJ-2026-0002', projectName: 'Target Proj' } as any;
        }
        return { id: sourceProjId, referenceNumber: 'PRJ-2026-0001', projectName: 'Source Proj' } as any;
      });

      const emailObj: any = {
        id: new mongoose.Types.ObjectId().toString(),
        messageId: 'msg-move-1',
        projectId: sourceProjId,
        attachments: [{ id: 'att-1', storageKey: 'blob-key-1' }],
        subject: 'Move Test',
        fromAddress: 'contractor@example.com',
      };

      emailRepo.findByMessageId.mockResolvedValue(emailObj);
      emailRepo.setProject.mockResolvedValue({ ...emailObj, projectId: targetProjId, linkMethod: 'MANUAL', status: 'LINKED' });

      const mockDoc = { _id: new mongoose.Types.ObjectId(), originalName: 'drawing.pdf', documentType: 'drawing', metadata: new Map() };
      (DocumentModel.find as jest.Mock).mockResolvedValue([mockDoc]);

      const result = await service.moveEmail('msg-move-1', targetProjId, { runExtraction: false });

      expect(emailRepo.setProject).toHaveBeenCalledWith('msg-move-1', targetProjId, 'MANUAL');
      expect(result.email.projectId).toBe(targetProjId);
      expect(result.movedDocumentCount).toBe(1);
    });
  });
});


