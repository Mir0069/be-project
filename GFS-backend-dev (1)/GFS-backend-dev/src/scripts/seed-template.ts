/**
 * =============================================================================
 * SEED SCRIPT — Upload Master Excel Template
 * =============================================================================
 * Reads the specified .xlsx file from disk and uploads it as the active 
 * Excel Template in the database.
 * 
 * Usage:
 *   npx ts-node --require tsconfig-paths/register src/scripts/seed-template.ts
 * =============================================================================
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ExcelTemplateModel } from '../db/models/excel-template.model';

const EXCEL_FILE_PATH = path.resolve(__dirname, '../../tests/fixtures/dummy-template.xlsx');

async function seedTemplate() {
  const mongoUri = process.env['MONGODB_URI'] || process.env['MONGO_URI'];
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not defined in .env');
  }

  if (!fs.existsSync(EXCEL_FILE_PATH)) {
    throw new Error(`File not found at: ${EXCEL_FILE_PATH}`);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected.');

  console.log('📂 Reading Excel file from disk...');
  const fileBuffer = fs.readFileSync(EXCEL_FILE_PATH);
  const fileSizeBytes = fileBuffer.length;
  console.log(`✅ File read successfully. Size: ${(fileSizeBytes / 1024).toFixed(2)} KB`);

  // Deactivate existing templates
  console.log('⏳ Deactivating any existing templates...');
  await ExcelTemplateModel.updateMany(
    { isActive: true },
    { $set: { isActive: false } }
  );

  // Create the new active template
  console.log('⏳ Uploading new template to database...');
  await ExcelTemplateModel.create({
    name: 'Glass Flooring Systems Master',
    version: '2024-03-27-Seed',
    fileBuffer: fileBuffer,
    fileSizeBytes: fileSizeBytes,
    isActive: true,
    uploadedBy: 'seed-template-script',
  });

  console.log('🎉 Successfully uploaded and activated the Excel template!');
  
  await mongoose.disconnect();
}

seedTemplate().catch((err: unknown) => {
  console.error('❌  Template Seed failed:', err);
  mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
