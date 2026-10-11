// =============================================================================
// EXCEL TEMPLATE REPOSITORY — MONGOOSE IMPLEMENTATION
// =============================================================================

import { ExcelTemplateModel, type IExcelTemplateDoc } from '@db/models/excel-template.model';
import type {
  IExcelTemplateRepository,
  ICreateExcelTemplateFields,
} from '../interfaces/i-excel-template.repository';
import type { IDomainExcelTemplate } from '@features/proposal/proposal.types';

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL LEAN TYPE
// ─────────────────────────────────────────────────────────────────────────────

type LeanTemplate = IExcelTemplateDoc & { _id: any; createdAt: Date; updatedAt: Date };
type LeanTemplateNoBuffer = Omit<LeanTemplate, 'fileBuffer'>;

// ─────────────────────────────────────────────────────────────────────────────
// MAPPER
// ─────────────────────────────────────────────────────────────────────────────

const toDomain = (doc: LeanTemplate): IDomainExcelTemplate => ({
  id:            doc._id.toString(),
  publicId:      doc.publicId,
  name:          doc.name,
  version:       doc.version,
  fileBuffer:    Buffer.isBuffer(doc.fileBuffer) 
                   ? doc.fileBuffer 
                   // @ts-expect-error mongodb.Binary has a .buffer property representing the native Buffer
                   : doc.fileBuffer.buffer || Buffer.from(doc.fileBuffer as any),
  fileSizeBytes: doc.fileSizeBytes,
  isActive:      doc.isActive,
  uploadedBy:    doc.uploadedBy,
  createdAt:     doc.createdAt,
  updatedAt:     doc.updatedAt,
});

// ─────────────────────────────────────────────────────────────────────────────
// REPOSITORY
// ─────────────────────────────────────────────────────────────────────────────

export class MongooseExcelTemplateRepository implements IExcelTemplateRepository {

  async findActive(): Promise<IDomainExcelTemplate | null> {
    const doc = await ExcelTemplateModel
      .findOne({ isActive: true })
      .lean<LeanTemplate>()
      .exec();

    return doc !== null ? toDomain(doc) : null;
  }

  async create(fields: ICreateExcelTemplateFields): Promise<IDomainExcelTemplate> {
    // Deactivate all existing templates
    await ExcelTemplateModel.updateMany({}, { $set: { isActive: false } }).exec();

    const created = await ExcelTemplateModel.create({
      name:          fields.name,
      version:       fields.version,
      fileBuffer:    fields.fileBuffer,
      fileSizeBytes: fields.fileSizeBytes,
      isActive:      true,
      uploadedBy:    fields.uploadedBy,
    });

    return toDomain(created.toObject() as unknown as LeanTemplate);
  }

  async findAllMetadata(): Promise<Omit<IDomainExcelTemplate, 'fileBuffer'>[]> {
    const docs = await ExcelTemplateModel
      .find({})
      .select('-fileBuffer')
      .sort({ createdAt: -1 })
      .lean<LeanTemplateNoBuffer[]>()
      .exec();

    return docs.map((doc) => ({
      id:            doc._id.toString(),
      publicId:      doc.publicId,
      name:          doc.name,
      version:       doc.version,
      fileSizeBytes: doc.fileSizeBytes,
      isActive:      doc.isActive,
      uploadedBy:    doc.uploadedBy,
      createdAt:     doc.createdAt,
      updatedAt:     doc.updatedAt,
    }));
  }
}
