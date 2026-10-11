import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';
import ExcelJS from 'exceljs';
import { ExcelTemplateModel } from '../db/models/excel-template.model';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function seedValidExcel() {
  const mongoUri = process.env['MONGODB_URI'] || process.env['MONGO_URI'];
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required');
  }
  await mongoose.connect(mongoUri);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Pricing Worksheet');
  sheet.getCell('A1').value = 'Test';
  const buffer = await workbook.xlsx.writeBuffer();

  await ExcelTemplateModel.deleteMany({});
  await ExcelTemplateModel.create({
    name: 'Valid Dummy Template',
    version: '2026-07-01',
    fileBuffer: Buffer.from(buffer),
    fileSizeBytes: buffer.byteLength,
    isActive: true,
    uploadedBy: 'system',
  });

  console.log('✅ Created valid dummy excel template.');
  process.exit(0);
}

seedValidExcel();
