import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { AiExtractionStatus } from '@db/models/call-record.model';
import type {
  ICallRecordRepository,
  ICallRecordPage,
  IDomainCallRecord,
} from '@repositories/interfaces/i-call-record.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';
import type { CreateCallRecordBody, ListCallRecordsQuery, UpdateCallRecordBody } from './phone-transcript.types';
import { azureSpeechService } from '@services/azure-speech.service';
import mongoose from 'mongoose';
import { DocumentTypeTag, DocumentModel } from '@db/models/document.model';
import { DocumentIngestionPipeline } from '@features/document-ingestion/document-ingestion.service';

export class PhoneTranscriptService {
  private readonly callRecordRepository: ICallRecordRepository;
  private readonly projectRepository: IProjectRepository;
  private readonly documentIngestion: DocumentIngestionPipeline;

  public constructor(
    callRecordRepository: ICallRecordRepository,
    projectRepository: IProjectRepository,
    documentIngestion: DocumentIngestionPipeline,
  ) {
    this.callRecordRepository = callRecordRepository;
    this.projectRepository = projectRepository;
    this.documentIngestion = documentIngestion;
  }

  public async createCallRecord(
    projectId: string,
    body: CreateCallRecordBody,
    contributedBy: string,
  ): Promise<IDomainCallRecord> {
    const project = await this.projectRepository.findById(projectId);
    if (!project || !project.isActive) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    }

    if (body.summaryText && !body.transcriptFileName && this.documentIngestion && typeof this.documentIngestion.upload === 'function') {
      const textBuffer = Buffer.from(body.summaryText, 'utf-8');
      const textFileName = `call-record-${Date.now()}.txt`;
      try {
        const [doc] = await this.documentIngestion.upload(
          { userId: contributedBy, roles: ['SALES_MANAGER', 'ESTIMATOR'] },
          {
            projectId,
            file: {
              originalName: textFileName,
              mimeType: 'text/plain',
              buffer: textBuffer,
            },
            uploadedBy: contributedBy,
            documentType: DocumentTypeTag.TRANSCRIPT,
          }
        );
        if (doc) {
          body.transcriptFileName = doc.originalName;
          body.transcriptFileUrl = doc.blobUrl;
        }
      } catch (err: any) {
        console.error(`[PhoneTranscriptService] failed to create document for manual CallRecord:`, err?.message ?? err);
      }
    }

    return this.callRecordRepository.create({
      projectId,
      callDate: body.callDate,
      customerName: body.customerName,
      summaryText: body.summaryText,
      transcriptFileUrl: body.transcriptFileUrl,
      transcriptFileName: body.transcriptFileName,
      contributedBy,
    });
  }

  public async processAudioUpload(
    projectId: string,
    audioBuffer: Buffer,
    mimeType: string,
    originalName: string,
    userId: string,
  ): Promise<IDomainCallRecord> {

    const project = await this.projectRepository.findById(projectId);
    if (!project || !project.isActive) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    }

    const transcript = await azureSpeechService.transcribeBuffer(audioBuffer, mimeType);
    if (!transcript.trim()) {
      throw new AppError('No speech detected in the audio file', StatusCodes.UNPROCESSABLE_ENTITY);
    }

    // 3. Stage for the Documents Tab (This automatically handles Blob + AI Queue)
    const textBuffer = Buffer.from(transcript, 'utf-8');
    const textFileName = `transcript-${Date.now()}-${originalName.replace(/\.[^/.]+$/, "")}.txt`;

    const [documentRecord] = await this.documentIngestion.upload(
      { userId, roles: ['SALES_MANAGER', 'ESTIMATOR'] },
      {
        projectId,
        file: {
          originalName: textFileName,
          mimeType: 'text/plain',
          buffer: textBuffer,
        },
        uploadedBy: userId,
        documentType: DocumentTypeTag.TRANSCRIPT,
      }
    );

    if (!documentRecord) {
      throw new AppError('Failed to generate document record for transcript', StatusCodes.INTERNAL_SERVER_ERROR);
    }

    const callRecord = await this.callRecordRepository.create({
      projectId,
      callDate: new Date(),
      customerName: project.customerName || 'Unknown Client',
      summaryText: transcript,
      transcriptFileUrl: documentRecord.blobUrl,
      transcriptFileName: documentRecord.originalName,
      contributedBy: userId,
    });

    return callRecord;
  }

  public async listCallRecords(
    projectId: string,
    query: ListCallRecordsQuery,
  ): Promise<ICallRecordPage> {
    const project = await this.projectRepository.findById(projectId);
    if (!project || !project.isActive) {
      throw new AppError('Project not found', StatusCodes.NOT_FOUND);
    }

    return this.callRecordRepository.findByProjectId(projectId, query.page, query.limit);
  }

  public async getCallRecord(
    projectId: string,
    recordId: string,
  ): Promise<IDomainCallRecord> {
    const record = await this.callRecordRepository.findById(recordId);
    if (!record || !record.isActive || record.projectId !== projectId) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    return record;
  }

  public async updateCallRecord(
    projectId: string,
    recordId: string,
    body: UpdateCallRecordBody,
  ): Promise<IDomainCallRecord> {
    const record = await this.callRecordRepository.findById(recordId);
    if (!record || !record.isActive || record.projectId !== projectId) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    // updateById filters isActive:true, so a concurrent soft-delete returns null here
    const updated = await this.callRecordRepository.updateById(recordId, body);
    if (!updated) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    return updated;
  }

  public async deleteCallRecord(projectId: string, recordId: string): Promise<IDomainCallRecord> {
    const record = await this.callRecordRepository.findById(recordId);
    if (!record || !record.isActive || record.projectId !== projectId) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    // deleteById filters isActive:true, so a concurrent double-delete returns null
    const deleted = await this.callRecordRepository.deleteById(recordId);
    if (!deleted) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    // Also soft-delete the corresponding transcript document so it gets deleted from Dropbox
    if (record.transcriptFileName) {
      try {
        await DocumentModel.updateMany(
          { 
            projectId: new mongoose.Types.ObjectId(projectId), 
            originalName: record.transcriptFileName, 
            isActive: true 
          },
          { 
            $set: { 
              isActive: false, 
              deletedAt: new Date(), 
              deletedBy: record.contributedBy?.toString() || 'call-record-delete' 
            } 
          }
        );
      } catch (err: any) {
        console.error(`[PhoneTranscriptService] failed to soft-delete corresponding document for CallRecord ${recordId}:`, err.message);
      }
    }

    return deleted;
  }

  public async triggerAiExtraction(
    projectId: string,
    recordId: string,
  ): Promise<IDomainCallRecord> {
    const record = await this.callRecordRepository.findById(recordId);
    if (!record || !record.isActive || record.projectId !== projectId) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    // State check before data check: a PENDING record should return 409 regardless of content
    if (record.aiExtractionStatus === AiExtractionStatus.PENDING) {
      throw new AppError('AI extraction is already in progress', StatusCodes.CONFLICT);
    }

    if (!record.summaryText && !record.transcriptFileUrl) {
      throw new AppError(
        'No transcript text available for AI extraction',
        StatusCodes.UNPROCESSABLE_ENTITY,
      );
    }

    const pending = await this.callRecordRepository.updateById(recordId, {
      aiExtractionStatus: AiExtractionStatus.PENDING,
    });
    if (!pending) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    try {
      const extracted = await this.runAiExtraction(record.summaryText, record.transcriptFileUrl);
      const updated = await this.callRecordRepository.updateById(recordId, {
        aiExtractionStatus: AiExtractionStatus.COMPLETED,
        aiExtractedRequirements: extracted,
        aiExtractedAt: new Date(),
      });
      if (!updated) throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
      return updated;
    } catch {
      await this.callRecordRepository.updateById(recordId, {
        aiExtractionStatus: AiExtractionStatus.FAILED,
      });
      throw new AppError('AI extraction failed', StatusCodes.INTERNAL_SERVER_ERROR);
    }
  }

  public async transcribeAudio(
    projectId: string,
    recordId: string,
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<IDomainCallRecord> {
    const record = await this.callRecordRepository.findById(recordId);
    if (!record || !record.isActive || record.projectId !== projectId) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    const transcript = await azureSpeechService.transcribeBuffer(audioBuffer, mimeType);
    if (!transcript.trim()) {
      throw new AppError('No speech detected in the audio file', StatusCodes.UNPROCESSABLE_ENTITY);
    }

    const updated = await this.callRecordRepository.updateById(recordId, {
      summaryText: transcript,
    });
    if (!updated) {
      throw new AppError('Call record not found', StatusCodes.NOT_FOUND);
    }

    return updated;
  }

  // Stub: replace with actual LLM call (e.g. Azure OpenAI / Anthropic) when AI service is wired up.
  // Must accept both summaryText and transcriptFileUrl — when only a URL is provided, the real
  // implementation should fetch/read the file content before passing to the LLM.
  private async runAiExtraction(
    summaryText: string | undefined,
    transcriptFileUrl: string | undefined,
  ): Promise<string> {
    const text = summaryText?.trim() ?? '';
    if (!text && !transcriptFileUrl) {
      throw new Error('No content to extract from');
    }
    const source = text || `[file: ${transcriptFileUrl}]`;
    return `[Pending AI integration] Transcript excerpt for review: ${source.substring(0, 500)}`;
  }
}
