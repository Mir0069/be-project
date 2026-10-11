import {
  PipelineDocumentIngestionAdapter,
  TEAMS_SYSTEM_USER_ID,
  TEAMS_SYSTEM_USER_ROLES,
} from '@features/teams/pipeline-document-ingestion.adapter';
import type { DocumentIngestionPipeline } from '@features/document-ingestion/document-ingestion.service';

describe('PipelineDocumentIngestionAdapter', () => {
  let pipeline: {
    upload: jest.Mock;
    listTeamsChannelDocumentIds: jest.Mock;
    moveDocuments: jest.Mock;
  };
  let adapter: PipelineDocumentIngestionAdapter;

  beforeEach(() => {
    pipeline = {
      upload: jest.fn().mockResolvedValue([]),
      listTeamsChannelDocumentIds: jest.fn().mockResolvedValue([]),
      moveDocuments: jest.fn().mockResolvedValue({ movedCount: 0, documentIds: [] }),
    };
    adapter = new PipelineDocumentIngestionAdapter(
      pipeline as unknown as DocumentIngestionPipeline,
    );
  });

  it('substitutes the Teams system identity regardless of what the caller passes', async () => {
    await adapter.upload(
      { userId: 'caller-supplied-id', roles: ['ESTIMATOR'] },
      {
        projectId: 'p1',
        file: { originalName: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') },
        uploadedBy: 'teams-graph-user-id',
        documentType: 'drawing',
        metadata: { source: 'teams', messageId: 'm1' },
      },
    );

    expect(pipeline.upload).toHaveBeenCalledTimes(1);
    const [ctx, input] = pipeline.upload.mock.calls[0];

    expect(ctx).toEqual({
      userId: TEAMS_SYSTEM_USER_ID,
      roles: TEAMS_SYSTEM_USER_ROLES,
    });
    expect(input.uploadedBy).toBe(TEAMS_SYSTEM_USER_ID);
  });

  it('forwards projectId, file, documentType, and metadata unchanged', async () => {
    const file = { originalName: 'doc.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') };
    const metadata = { source: 'teams', meetingId: 'meet-1' };

    await adapter.upload(
      { userId: 'whatever' },
      {
        projectId: 'project-42',
        file,
        uploadedBy: 'whatever',
        documentType: 'transcript',
        metadata,
      },
    );

    const [, input] = pipeline.upload.mock.calls[0];
    expect(input.projectId).toBe('project-42');
    expect(input.file).toBe(file);
    expect(input.documentType).toBe('transcript');
    expect(input.metadata).toBe(metadata);
  });

  describe('moveChannelDocuments', () => {
    it('moves the channel documents without triggering re-extraction', async () => {
      pipeline.listTeamsChannelDocumentIds.mockResolvedValue(['d1', 'd2']);
      pipeline.moveDocuments.mockResolvedValue({ movedCount: 2, documentIds: ['d1', 'd2'] });

      const moved = await adapter.moveChannelDocuments('channel-1', 'project-B');

      expect(pipeline.listTeamsChannelDocumentIds).toHaveBeenCalledWith('channel-1', 'project-B');
      expect(pipeline.moveDocuments).toHaveBeenCalledWith(
        { userId: TEAMS_SYSTEM_USER_ID, roles: TEAMS_SYSTEM_USER_ROLES },
        ['d1', 'd2'],
        'project-B',
        { runExtraction: false },
      );
      expect(moved).toBe(2);
    });

    it('is a no-op when the documents already sit on the target project', async () => {
      // Reconnecting to the SAME project must not re-file anything, or every
      // reconnect would churn Dropbox and duplicate the Documents list.
      pipeline.listTeamsChannelDocumentIds.mockResolvedValue([]);

      const moved = await adapter.moveChannelDocuments('channel-1', 'project-A');

      expect(pipeline.moveDocuments).not.toHaveBeenCalled();
      expect(moved).toBe(0);
    });
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
