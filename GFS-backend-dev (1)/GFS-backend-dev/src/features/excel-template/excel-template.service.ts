// =============================================================================
// EXCEL TEMPLATE FEATURE — SERVICE + CONTROLLER + ROUTER
//
// Admin-only feature for uploading the master .xlsx template to MongoDB.
// Once uploaded, the template is used by the Excel generator for all
// subsequent proposal generations. The stored file is never modified.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

import type { IExcelTemplateRepository } from '@repositories/interfaces/i-excel-template.repository';
import type { IDomainExcelTemplate, ExcelTemplateUploadResponse } from '@features/proposal/proposal.types';
import { invalidateTemplateBufferCache } from '@features/proposal/excel/graph.generator';

export class ExcelTemplateService {
  constructor(private readonly templateRepo: IExcelTemplateRepository) {}

  async upload(
    name: string,
    version: string,
    fileBuffer: Buffer,
    uploadedBy: string,
  ): Promise<ExcelTemplateUploadResponse> {
    const created = await this.templateRepo.create({
      name,
      version,
      fileBuffer,
      fileSizeBytes: fileBuffer.length,
      uploadedBy,
    });

    invalidateTemplateBufferCache();

    return {
      success:       true,
      publicId:      created.publicId,
      name:          created.name,
      version:       created.version,
      fileSizeBytes: created.fileSizeBytes,
    };
  }

  async listAll(): Promise<Omit<IDomainExcelTemplate, 'fileBuffer'>[]> {
    return this.templateRepo.findAllMetadata();
  }
}
