import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { safeJson } from '@shared/http/safe-json';
import type { PhoneTranscriptService } from './phone-transcript.service';
import type { CreateCallRecordBody, ListCallRecordsQuery, UpdateCallRecordBody } from './phone-transcript.types';

export class PhoneTranscriptController {
  private readonly service: PhoneTranscriptService;

  public constructor(service: PhoneTranscriptService) {
    this.service = service;
  }

  public async createCallRecord(req: Request, res: Response): Promise<void> {
    const { projectId } = req.params as { projectId: string };
    const body = req.body as CreateCallRecordBody;
    const contributedBy = req.user!.userId;

    const record = await this.service.createCallRecord(projectId, body, contributedBy);
    safeJson(res, StatusCodes.CREATED, { success: true, data: { callRecord: record } });
  }

  public async listCallRecords(req: Request, res: Response): Promise<void> {
    const { projectId } = req.params as { projectId: string };
    const query = req.query as unknown as ListCallRecordsQuery;

    const { records, total } = await this.service.listCallRecords(projectId, query);

    safeJson(res, StatusCodes.OK, {
      success: true,
      data: {
        callRecords: records,
        pagination: {
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      },
    });
  }

  public async getCallRecord(req: Request, res: Response): Promise<void> {
    const { projectId, recordId } = req.params as { projectId: string; recordId: string };

    const record = await this.service.getCallRecord(projectId, recordId);
    safeJson(res, StatusCodes.OK, { success: true, data: { callRecord: record } });
  }

  public async updateCallRecord(req: Request, res: Response): Promise<void> {
    const { projectId, recordId } = req.params as { projectId: string; recordId: string };
    const body = req.body as UpdateCallRecordBody;

    const record = await this.service.updateCallRecord(projectId, recordId, body);
    safeJson(res, StatusCodes.OK, { success: true, data: { callRecord: record } });
  }

  public async deleteCallRecord(req: Request, res: Response): Promise<void> {
    const { projectId, recordId } = req.params as { projectId: string; recordId: string };

    const record = await this.service.deleteCallRecord(projectId, recordId);
    safeJson(res, StatusCodes.OK, { success: true, data: { callRecord: record } });
  }

  public async triggerAiExtraction(req: Request, res: Response): Promise<void> {
    const { projectId, recordId } = req.params as { projectId: string; recordId: string };

    const record = await this.service.triggerAiExtraction(projectId, recordId);
    safeJson(res, StatusCodes.OK, { success: true, data: { callRecord: record } });
  }

  public async transcribeAudio(req: Request, res: Response): Promise<void> {
    const { projectId, recordId } = req.params as { projectId: string; recordId: string };
    const file = (req as any).file as { buffer: Buffer; mimetype: string } | undefined;
    if (!file) {
      safeJson(res, 400, { success: false, message: 'Audio file is required' });
      return;
    }

    const record = await this.service.transcribeAudio(projectId, recordId, file.buffer, file.mimetype);
    safeJson(res, StatusCodes.OK, { success: true, data: { callRecord: record } });
  }

  public async uploadAndTranscribe(req: Request, res: Response): Promise<void> {
    const { projectId } = req.params as { projectId: string };
    const userId = req.user!.userId;
    const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname: string } | undefined;
    
    if (!file) {
      safeJson(res, 400, { success: false, message: 'Audio file is required' });
      return;
    }

    const record = await this.service.processAudioUpload(
      projectId, 
      file.buffer, 
      file.mimetype, 
      file.originalname, 
      userId
    );
    
    safeJson(res, StatusCodes.CREATED, { success: true, data: { callRecord: record } });
  }
}
