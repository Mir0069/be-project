// =============================================================================
// EXCEL TEMPLATE REPOSITORY — INTERFACE
// =============================================================================

import type { IDomainExcelTemplate } from '@features/proposal/proposal.types';

export interface ICreateExcelTemplateFields {
  readonly name: string;
  readonly version: string;
  readonly fileBuffer: Buffer;
  readonly fileSizeBytes: number;
  readonly uploadedBy: string;
}

export interface IExcelTemplateRepository {
  /**
   * Finds the currently active template (metadata only — includes fileBuffer).
   * Returns null if no template has been uploaded yet.
   */
  findActive(): Promise<IDomainExcelTemplate | null>;

  /**
   * Stores a new template and marks it as active.
   * Atomically sets all other templates to isActive=false first.
   */
  create(fields: ICreateExcelTemplateFields): Promise<IDomainExcelTemplate>;

  /**
   * Returns lightweight metadata for all uploaded templates (without fileBuffer).
   * Used by the admin list endpoint.
   */
  findAllMetadata(): Promise<Omit<IDomainExcelTemplate, 'fileBuffer'>[]>;
}
