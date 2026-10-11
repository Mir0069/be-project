import fs from 'fs';
import { Request, Response } from 'express';
import { DocumentIngestionPipeline, DocumentIngestionError } from './document-ingestion.service';
import { AuthContext, DocumentTypeTag } from './document-ingestion.types';

export class DocumentIngestionController {
  public constructor(private readonly pipeline: DocumentIngestionPipeline) {}

private getAuthContext(req: Request): AuthContext {
    const user = req.user;
    
    if (!user || !user.userId) {
      throw new DocumentIngestionError('Authentication required to access documents', 401);
    }

    return {
      userId: user.userId,
      roles: user.role ? [user.role] : [],
    };
  }

  public async upload(req: Request, res: Response): Promise<void> {
    const file = (req as any).file;
    if (!file) throw new DocumentIngestionError('file field is required', 400);
    
    const projectId = req.params['projectId'] as string;
    if (!projectId) throw new DocumentIngestionError('projectId route parameter is required', 400);

    const ctx = this.getAuthContext(req);
    
    const documentType = String(req.body.documentType || 'other') as DocumentTypeTag;
    const markAsFinalInput = req.body.markAsFinalInput === 'true' || req.body.markAsFinalInput === true;
    const replaceDocumentId = req.body.replaceDocumentId ? String(req.body.replaceDocumentId).trim() : undefined;
    let metadata = {};
    
    if (req.body.metadata) {
      try {
        metadata = typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata;
      } catch {
        throw new DocumentIngestionError('metadata must be valid JSON', 422);
      }
    }

    try {
      const documents = await this.pipeline.upload(ctx, {
        projectId,
        file: {
          originalName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
          path: file.path,
          size: file.size,
        },
        uploadedBy: ctx.userId,
        documentType,
        markAsFinalInput,
        replaceDocumentId,
        metadata,
      });

      res.status(201).json({ data: { documents } });
    } finally {
      if (file.path) {
        await fs.promises.rm(file.path, { force: true }).catch(() => {});
      }
    }
  }

  public async list(req: Request, res: Response): Promise<void> {
    const projectId = req.params['projectId'] as string;
    const includeDeleted = req.query['includeDeleted'] === 'true';
    
    const documents = await this.pipeline.list(projectId, includeDeleted);
    res.status(200).json({ data: { documents } });
  }

  public async markAsFinalInput(req: Request, res: Response): Promise<void> {
    const documentId = req.params['documentId'] as string;
    const isFinalInput = req.body.isFinalInput === 'true' || req.body.isFinalInput === true;
    const ctx = this.getAuthContext(req);
    
    const document = await this.pipeline.markAsFinalInput(ctx, documentId, isFinalInput);
    res.status(200).json({ data: { document } });
  }

  public async createDownloadUrl(req: Request, res: Response): Promise<void> {
    const documentId = req.params['documentId'] as string;
    const expiresInMinutes = Number(req.query['expiresInMinutes'] ?? 15);
    // ?inline=1 renders the file in the browser (preview) instead of downloading.
    const inline = req.query['inline'] === '1' || req.query['inline'] === 'true';
    const ctx = this.getAuthContext(req);

    const downloadUrl = await this.pipeline.createDownloadUrl(ctx, documentId, expiresInMinutes, inline);
    res.status(200).json({ data: { downloadUrl, expiresInMinutes } });
  }

  public async download(req: Request, res: Response): Promise<void> {
    const documentId = req.body?.documentId ? String(req.body.documentId).trim() : '';
    if (!documentId) throw new DocumentIngestionError('documentId is required', 400);

    const file = await this.pipeline.download(this.getAuthContext(req), documentId);
    if (file.contentType) res.setHeader('Content-Type', file.contentType);
    if (file.contentLength !== undefined) res.setHeader('Content-Length', String(file.contentLength));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.document.originalName.replace(/"/g, '')}"`,
    );
    file.stream.pipe(res);
  }

  public async viewDocument(req: Request, res: Response): Promise<void> {
    const documentId = (req.params['documentId'] ? String(req.params['documentId']).trim() : '') || (req.query['documentId'] ? String(req.query['documentId']).trim() : '');
    if (!documentId) throw new DocumentIngestionError('documentId is required', 400);

    const file = await this.pipeline.download(this.getAuthContext(req), documentId);
    if (file.contentType) res.setHeader('Content-Type', file.contentType);
    if (file.contentLength !== undefined) res.setHeader('Content-Length', String(file.contentLength));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.document.originalName.replace(/"/g, '')}"`,
    );
    file.stream.pipe(res);
  }

  public async delete(req: Request, res: Response): Promise<void> {
    const documentId = req.params['documentId'] as string;
    const ctx = this.getAuthContext(req);

    const document = await this.pipeline.delete(ctx, documentId);
    res.status(200).json({ data: { document } });
  }

  public async restore(req: Request, res: Response): Promise<void> {
    const documentId = req.params['documentId'] as string;
    const ctx = this.getAuthContext(req);

    const document = await this.pipeline.restore(ctx, documentId);
    res.status(200).json({ data: { document } });
  }

  public async moveDocuments(req: Request, res: Response): Promise<void> {
    const ctx = this.getAuthContext(req);
    const documentIds = Array.isArray(req.body.documentIds) && req.body.documentIds.length > 0
      ? req.body.documentIds
      : req.params['documentId']
        ? [req.params['documentId']]
        : req.body.documentId
          ? [req.body.documentId]
          : [];
    const targetProjectId = req.body.targetProjectId as string;
    const runExtraction = req.body.runExtraction !== false && req.body.runExtraction !== 'false';
    const result = await this.pipeline.moveDocuments(ctx, documentIds, targetProjectId, { runExtraction });
    res.status(200).json({ success: true, data: result });
  }
}

