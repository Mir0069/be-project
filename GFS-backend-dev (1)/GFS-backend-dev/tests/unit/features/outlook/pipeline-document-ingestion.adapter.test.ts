import {
  PipelineDocumentIngestionAdapter,
  OUTLOOK_SYSTEM_USER_ID,
  OUTLOOK_SYSTEM_USER_ROLES,
} from '@features/outlook/pipeline-document-ingestion.adapter';
import type { DocumentIngestionPipeline } from '@features/document-ingestion/document-ingestion.service';

describe('Outlook PipelineDocumentIngestionAdapter', () => {
  let pipeline: { upload: jest.Mock };
  let adapter: PipelineDocumentIngestionAdapter;

  beforeEach(() => {
    pipeline = { upload: jest.fn().mockResolvedValue([]) };
    adapter = new PipelineDocumentIngestionAdapter(
      pipeline as unknown as DocumentIngestionPipeline,
    );
  });

  it('substitutes the Outlook system identity regardless of what the caller passes', async () => {
    await adapter.upload(
      { userId: 'caller-supplied-id', roles: ['ESTIMATOR'] },
      {
        projectId: 'p1',
        file: { originalName: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
        uploadedBy: 'jane@acme.com',
        documentType: 'drawing',
        metadata: { source: 'outlook', messageId: 'm1' },
      },
    );

    expect(pipeline.upload).toHaveBeenCalledTimes(1);
    const [ctx, input] = pipeline.upload.mock.calls[0];

    expect(ctx).toEqual({
      userId: OUTLOOK_SYSTEM_USER_ID,
      roles: OUTLOOK_SYSTEM_USER_ROLES,
    });
    expect(input.uploadedBy).toBe(OUTLOOK_SYSTEM_USER_ID);
  });

  it('forwards projectId, file, documentType, and metadata unchanged', async () => {
    const file = { originalName: 'email.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') };
    const metadata = { source: 'outlook', conversationId: 'conv-1' };

    await adapter.upload(
      { userId: 'whatever' },
      {
        projectId: 'project-42',
        file,
        uploadedBy: 'whatever',
        documentType: 'other',
        metadata,
      },
    );

    const [, input] = pipeline.upload.mock.calls[0];
    expect(input.projectId).toBe('project-42');
    expect(input.file).toBe(file);
    expect(input.documentType).toBe('other');
    expect(input.metadata).toBe(metadata);
  });

  it('propagates pipeline rejection (does not swallow)', async () => {
    pipeline.upload.mockRejectedValue(new Error('pipeline boom'));

    await expect(
      adapter.upload(
        { userId: 'x' },
        {
          projectId: 'p1',
          file: { originalName: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
          uploadedBy: 'x',
          documentType: 'other',
        },
      ),
    ).rejects.toThrow('pipeline boom');
  });
});
