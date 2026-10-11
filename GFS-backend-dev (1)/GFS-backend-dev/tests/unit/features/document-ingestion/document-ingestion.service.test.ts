import { DocumentIngestionPipeline, DocumentIngestionError } from '@features/document-ingestion/document-ingestion.service';
import { AuthContext, DocumentTypeTag, UploadedFile } from '@features/document-ingestion/document-ingestion.types';

describe('DocumentIngestionPipeline', () => {
  let mockRepository: any;
  let mockStorage: any;
  let mockQueue: any;
  let mockPermissions: any;
  let mockAudit: any;
  let pipeline: DocumentIngestionPipeline;

  const mockAuthCtx: AuthContext = { userId: 'test-user', roles: ['ESTIMATOR'] };

  beforeEach(() => {
    mockRepository = {
      create: jest.fn().mockImplementation((doc) => Promise.resolve(doc)),
      findLatestByRoot: jest.fn().mockResolvedValue(null),
      markPriorVersionsNotLatest: jest.fn().mockResolvedValue(undefined),
    };

    mockStorage = {
      put: jest.fn().mockResolvedValue({
        storageKey: 'fake/path/doc.pdf',
        blobUrl: 'https://fake.blob.core.windows.net/doc.pdf',
        sha256: 'fake-hash',
        byteSize: 1024,
      }),
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://fake.blob.core.windows.net/doc.pdf?sas=token'),
    };

    mockQueue = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mockPermissions = {
      assertCanUpload: jest.fn().mockResolvedValue(undefined),
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    pipeline = new DocumentIngestionPipeline({
      repository: mockRepository,
      storage: mockStorage,
      queue: mockQueue,
      permissions: mockPermissions,
      audit: mockAudit,
      idFactory: () => 'static-test-id',
      now: () => new Date('2026-05-25T12:00:00Z'),
    });
  });


  it('should successfully upload a valid PDF and dispatch to the queue', async () => {
    const fakeFile: UploadedFile = {
      originalName: 'architect-drawings.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fake-pdf-content'),
    };

    const result = await pipeline.upload(mockAuthCtx, {
      projectId: 'project-123',
      file: fakeFile,
      uploadedBy: 'test-user',
      documentType: 'drawing' as DocumentTypeTag,
    });

    expect(result).toHaveLength(1);
    const createdDoc = result[0]!;
    expect(createdDoc.id).toBe('static-test-id');
    expect(createdDoc.status).toBe('PENDING');

    expect(mockPermissions.assertCanUpload).toHaveBeenCalledWith(mockAuthCtx, 'project-123');
    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockRepository.create).toHaveBeenCalled();
    expect(mockQueue.publish).toHaveBeenCalledWith(expect.objectContaining({
      document_id: 'static-test-id',
      project_id: 'project-123',
    }));
  });

  it('should throw a 403 error if the user does not have permission', async () => {
    mockPermissions.assertCanUpload.mockRejectedValue(new DocumentIngestionError('Forbidden', 403));

    const fakeFile: UploadedFile = {
      originalName: 'secret.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('content'),
    };

    await expect(
      pipeline.upload(mockAuthCtx, {
        projectId: 'project-123',
        file: fakeFile,
        uploadedBy: 'hacker',
        documentType: 'drawing',
      })
    ).rejects.toThrow('Forbidden');

    expect(mockStorage.put).not.toHaveBeenCalled();
  });

  it('should throw a 415 error if the file extension is unsupported', async () => {
    const badFile: UploadedFile = {
      originalName: 'virus.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('bad-code'),
    };

    await expect(
      pipeline.upload(mockAuthCtx, {
        projectId: 'project-123',
        file: badFile,
        uploadedBy: 'test-user',
        documentType: 'other',
      })
    ).rejects.toThrow('Unsupported file extension');

    expect(mockQueue.publish).not.toHaveBeenCalled();
  });

  it('should throw a 415 error if a CAD or DWG file is uploaded', async () => {
    const cadFile: UploadedFile = {
      originalName: 'blueprint.dwg',
      mimeType: 'image/vnd.dwg',
      buffer: Buffer.from('dwg-data'),
    };

    await expect(
      pipeline.upload(mockAuthCtx, {
        projectId: 'project-123',
        file: cadFile,
        uploadedBy: 'test-user',
        documentType: 'drawing',
      })
    ).rejects.toThrow('Unsupported file extension: .dwg');

    expect(mockQueue.publish).not.toHaveBeenCalled();
  });

  describe('ingestExternalPackage', () => {
    const mockBundle = {
      correlationId: 'outlookEmail:123',
      messageId: 'msg-abc',
      conversationId: 'conv-xyz',
      sender: 'sender@example.com',
      to: ['to@example.com'],
      subject: 'Test Subject',
      bodyText: 'Hello world',
      receivedDateTime: '2026-05-25T12:00:00Z',
      attachments: [
        {
          originalName: 'test-doc.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          storageKey: 'fake/path/test-doc.pdf',
          downloadUrl: 'https://fake.blob.core.windows.net/test-doc.pdf?sas=token',
        },
      ],
    };

    it('should successfully ingest package with normal email body and attachments', async () => {
      const result = await pipeline.ingestExternalPackage(mockAuthCtx, mockBundle as any);

      expect(result).toHaveLength(2); // body text + 1 attachment
      expect(result[0]!.originalName).toBe('email-msg-abc.txt');
      expect(result[1]!.originalName).toBe('test-doc.pdf');

      expect(mockStorage.put).toHaveBeenCalledWith(expect.objectContaining({
        originalName: 'email-msg-abc.txt',
        mimeType: 'text/plain',
      }));
      expect(mockRepository.create).toHaveBeenCalledTimes(2);
      expect(mockQueue.publish).toHaveBeenCalled();
    });

    it('should successfully ingest package even if the email body is empty or whitespace only', async () => {
      const emptyBodyBundle = {
        ...mockBundle,
        bodyText: '   ',
      };

      const result = await pipeline.ingestExternalPackage(mockAuthCtx, emptyBodyBundle as any);

      expect(result).toHaveLength(2);
      expect(result[0]!.originalName).toBe('email-msg-abc.txt');
      
      // Verification: The body file was uploaded with fallback '(No content)'
      expect(mockStorage.put).toHaveBeenCalledWith(expect.objectContaining({
        originalName: 'email-msg-abc.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('(No content)', 'utf-8'),
      }));
    });
  });
});