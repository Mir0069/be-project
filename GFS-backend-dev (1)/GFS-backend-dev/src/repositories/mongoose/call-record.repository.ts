import type { HydratedDocument } from 'mongoose';
import { CallRecord, type ICallRecord } from '@db/models/call-record.model';
import type {
  ICallRecordRepository,
  ICallRecordPage,
  ICreateCallRecordFields,
  IUpdateCallRecordFields,
  IDomainCallRecord,
} from '@repositories/interfaces/i-call-record.repository';

export class MongooseCallRecordRepository implements ICallRecordRepository {
  public async findById(id: string): Promise<IDomainCallRecord | null> {
    const record = await CallRecord.findById(id);
    return record ? this.toDomain(record) : null;
  }

  public async findByProjectId(
    projectId: string,
    page: number,
    limit: number,
  ): Promise<ICallRecordPage> {
    const p = typeof page === 'number' && Number.isInteger(page) && page > 0 ? page : 1;
    const l = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : 12;
    const filter = { projectId, isActive: true };
    const [records, total] = await Promise.all([
      CallRecord.find(filter)
        .sort({ callDate: -1 })
        .skip((p - 1) * l)
        .limit(l),
      CallRecord.countDocuments(filter),
    ]);
    return { records: records.map((r) => this.toDomain(r)), total };
  }

  public async create(fields: ICreateCallRecordFields): Promise<IDomainCallRecord> {
    const record = await CallRecord.create({
      ...fields,
      contributedBy: fields.contributedBy ? fields.contributedBy : undefined,
    });
    return this.toDomain(record);
  }

  public async updateById(
    id: string,
    fields: IUpdateCallRecordFields,
  ): Promise<IDomainCallRecord | null> {
    const record = await CallRecord.findOneAndUpdate({ _id: id, isActive: true }, fields, { new: true });
    return record ? this.toDomain(record) : null;
  }

  public async deleteById(id: string): Promise<IDomainCallRecord | null> {
    const result = await CallRecord.findOneAndUpdate({ _id: id, isActive: true }, { isActive: false }, { new: true });
    return result ? this.toDomain(result) : null;
  }

  private toDomain(record: HydratedDocument<ICallRecord>): IDomainCallRecord {
    return {
      id: record._id.toString(),
      projectId: record.projectId.toString(),
      callDate: record.callDate,
      customerName: record.customerName,
      summaryText: record.summaryText,
      transcriptFileUrl: record.transcriptFileUrl,
      transcriptFileName: record.transcriptFileName,
      contributedBy: record.contributedBy ? record.contributedBy.toString() : null,
      aiExtractionStatus: record.aiExtractionStatus,
      aiExtractedRequirements: record.aiExtractedRequirements,
      aiExtractedAt: record.aiExtractedAt,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
