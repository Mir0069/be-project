import type { DocumentIngestionPipeline } from '@features/document-ingestion/document-ingestion.service';
import type {
  DocIngestAuthContext,
  DocIngestInput,
  IDocumentIngestionPort,
  IEmailPackageBundle,
} from './document-ingestion.port';

export const OUTLOOK_SYSTEM_USER_ID = 'outlook-integration';
export const OUTLOOK_SYSTEM_USER_ROLES = ['SYSTEM_ADMIN'];

export class PipelineDocumentIngestionAdapter implements IDocumentIngestionPort {
  private readonly pipeline: DocumentIngestionPipeline;

  public constructor(pipeline: DocumentIngestionPipeline) {
    this.pipeline = pipeline;
  }

  public async upload(_ctx: DocIngestAuthContext, input: DocIngestInput): Promise<void> {
    await this.pipeline.upload(
      { userId: OUTLOOK_SYSTEM_USER_ID, roles: OUTLOOK_SYSTEM_USER_ROLES },
      {
        projectId: input.projectId,
        file: input.file,
        uploadedBy: OUTLOOK_SYSTEM_USER_ID,
        documentType: input.documentType,
        metadata: input.metadata,
      },
    );
  }

  public async ingestEmailPackage(bundle: IEmailPackageBundle): Promise<void> {
    try {
      const ctx = {
        userId: OUTLOOK_SYSTEM_USER_ID,
        roles: OUTLOOK_SYSTEM_USER_ROLES,
      };

      // Call ingestion Method
      await this.pipeline.ingestExternalPackage(ctx as any, bundle);

      console.log(`[outlook→pipeline] ✅ Successfully routed email package ${bundle.correlationId} to Document Pipeline and AI Queue`);
    } catch (error) {
      console.error(`[outlook→pipeline] ❌ Failed to route email package ${bundle.correlationId}:`, error);
      throw error;
    }
  }
}
