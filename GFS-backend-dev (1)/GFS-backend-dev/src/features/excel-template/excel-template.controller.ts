// =============================================================================
// EXCEL TEMPLATE FEATURE — CONTROLLER
// =============================================================================

import { StatusCodes } from 'http-status-codes';
import type { Request, Response } from 'express';
import { asyncHandler } from '@shared/utils/async-handler';
import { safeJson } from '@shared/http/safe-json';
import { AppError } from '@shared/errors/app.error';
import { ErrorCode } from '@shared/errors/error-codes';
import type { ExcelTemplateService } from './excel-template.service';

export class ExcelTemplateController {
  constructor(private readonly templateService: ExcelTemplateService) {}

  /**
   * POST /api/{version}/excel-templates
   *
   * Expects multipart/form-data:
   *   file    — the .xlsx binary (field name: "template")
   *   name    — human-readable template name (body field)
   *   version — version string e.g. "2024-01" (body field)
   *
   * Multer is configured in the router to populate req.file.
   */
  readonly upload = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      // Multer puts the uploaded file on req.file
      const file = (req as Request & { file?: Express.Multer.File }).file;

      if (file === undefined) {
        throw new AppError(
          'No file uploaded. Send the .xlsx as multipart/form-data with field name "template".',
          StatusCodes.BAD_REQUEST,
          true,
          { code: ErrorCode.VALIDATION_ERROR },
        );
      }

      const name = typeof req.body.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : 'GFS Standard Workbook';

      const version = typeof req.body.version === 'string' && req.body.version.trim()
        ? req.body.version.trim()
        : new Date().toISOString().slice(0, 7); // "YYYY-MM"

      const uploadedBy: string =
        (req as Request & { user?: { id: string } }).user?.id ?? 'admin';

      const result = await this.templateService.upload(
        name,
        version,
        file.buffer,
        uploadedBy,
      );

      safeJson(res, StatusCodes.CREATED, result);
    },
  );

  /**
   * GET /api/{version}/excel-templates
   *
   * Lists all uploaded templates (metadata only — no binary buffer).
   */
  readonly list = asyncHandler(
    async (_req: Request, res: Response): Promise<void> => {
      const templates = await this.templateService.listAll();
      safeJson(res, StatusCodes.OK, { templates });
    },
  );
}
