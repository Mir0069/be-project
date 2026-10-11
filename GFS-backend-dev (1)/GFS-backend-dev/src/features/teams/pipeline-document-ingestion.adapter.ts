import type { DocumentIngestionPipeline } from '@features/document-ingestion/document-ingestion.service';
import type {
  DocIngestAuthContext,
  DocIngestInput,
  IDocumentIngestionPort,
} from './document-ingestion.port';

export const TEAMS_SYSTEM_USER_ID = 'teams-integration';
export const TEAMS_SYSTEM_USER_ROLES = ['SYSTEM_ADMIN'];

export class PipelineDocumentIngestionAdapter implements IDocumentIngestionPort {
  private readonly pipeline: DocumentIngestionPipeline;

  public constructor(pipeline: DocumentIngestionPipeline) {
    this.pipeline = pipeline;
  }

  public async upload(_ctx: DocIngestAuthContext, input: DocIngestInput): Promise<void> {
    await this.pipeline.upload(
      { userId: TEAMS_SYSTEM_USER_ID, roles: TEAMS_SYSTEM_USER_ROLES },
      {
        projectId: input.projectId,
        file: input.file,
        uploadedBy: TEAMS_SYSTEM_USER_ID,
        documentType: input.documentType,
        metadata: input.metadata,
      },
    );
  }

  public async moveChannelDocuments(
    channelId: string,
    targetProjectId: string,
  ): Promise<number> {
    const documentIds = await this.pipeline.listTeamsChannelDocumentIds(
      channelId,
      targetProjectId,
    );
    if (documentIds.length === 0) return 0;

    // runExtraction:false keeps this out of the immediate re-extraction path and
    // raises ONE pending approval for the batch instead, which is the right
    // amount of noise for a reconnect that can carry dozens of files.
    const result = await this.pipeline.moveDocuments(
      { userId: TEAMS_SYSTEM_USER_ID, roles: TEAMS_SYSTEM_USER_ROLES },
      documentIds,
      targetProjectId,
      { runExtraction: false },
    );
    return result.movedCount;
  }
}
