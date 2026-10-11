// =============================================================================
// EXCEL TEMPLATE FEATURE — ROUTER
// =============================================================================

import { Router } from 'express';
import multer from 'multer';
import { MongooseExcelTemplateRepository } from '@repositories/mongoose/excel-template.repository';
import { ExcelTemplateService } from './excel-template.service';
import { ExcelTemplateController } from './excel-template.controller';

// ─────────────────────────────────────────────────────────────────────────────
// MULTER SETUP — memory storage (buffer goes directly to MongoDB)
// ─────────────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max (Excel files are well under this)
  },
  fileFilter: (_req, file, cb) => {
    const isXlsx =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');

    if (!isXlsx) {
      cb(new Error('Only .xlsx files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DEPENDENCY WIRING
// ─────────────────────────────────────────────────────────────────────────────

const templateRepo = new MongooseExcelTemplateRepository();
const templateService = new ExcelTemplateService(templateRepo);
const controller = new ExcelTemplateController(templateService);

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES — mounted under /api/{version}/excel-templates
// ─────────────────────────────────────────────────────────────────────────────

const excelTemplateRouter = Router();

/** Upload a new master .xlsx template */
excelTemplateRouter.post(
  '/',
  upload.single('template'),
  controller.upload,
);

/** List all uploaded templates (metadata only) */
excelTemplateRouter.get(
  '/',
  controller.list,
);

export { excelTemplateRouter };
