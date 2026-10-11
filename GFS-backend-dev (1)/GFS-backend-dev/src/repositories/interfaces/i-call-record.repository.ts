import type { AiExtractionStatus } from '@db/models/call-record.model';

export interface ICreateCallRecordFields {
  projectId: string;
  callDate: Date;
  customerName: string;
  summaryText?: string;
  transcriptFileUrl?: string;
  transcriptFileName?: string;
  contributedBy?: string | null;
}

export interface IUpdateCallRecordFields {
  callDate?: Date;
  customerName?: string;
  summaryText?: string;
  transcriptFileUrl?: string;
  transcriptFileName?: string;
  aiExtractionStatus?: AiExtractionStatus;
  aiExtractedRequirements?: string;
  aiExtractedAt?: Date;
}

export interface IDomainCallRecord {
  id: string;
  projectId: string;
  callDate: Date;
  customerName: string;
  summaryText?: string;
  transcriptFileUrl?: string;
  transcriptFileName?: string;
  contributedBy?: string | null;
  aiExtractionStatus: AiExtractionStatus;
  aiExtractedRequirements?: string;
  aiExtractedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICallRecordPage {
  records: IDomainCallRecord[];
  total: number;
}

export interface ICallRecordRepository {
  findById(id: string): Promise<IDomainCallRecord | null>;
  findByProjectId(projectId: string, page: number, limit: number): Promise<ICallRecordPage>;
  create(fields: ICreateCallRecordFields): Promise<IDomainCallRecord>;
  updateById(id: string, fields: IUpdateCallRecordFields): Promise<IDomainCallRecord | null>;
  deleteById(id: string): Promise<IDomainCallRecord | null>;
}
