import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { MongooseProposalRepository } from '../repositories/mongoose/proposal.repository';
import { MongooseProjectRepository } from '../repositories/mongoose/project.repository';
import { ProposalService } from '../features/proposal/proposal.service';
import { FormulaEngineService } from '../features/proposal/formula-engine/formula-engine.service';
import { Project } from '../db/models/project.model';
import { ProposalModel } from '../db/models/proposal.model';
import { User, UserRole } from '../db/models/user.model';
import { ExcelTemplateModel } from '../db/models/excel-template.model';
import { blobStorage } from '@features/document-ingestion/document-ingestion.router';

const SEED_PROJECT_ID = '666666666666666666666666';

async function seed() {
  const mongoUri = process.env['MONGODB_URI'] || process.env['MONGO_URI'];
  if (!mongoUri) throw new Error('MONGODB_URI is not defined in .env');

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected.');

  console.log('🧹 Clearing old seed data...');
  await Project.deleteOne({ _id: SEED_PROJECT_ID });
  await ProposalModel.deleteOne({ projectId: SEED_PROJECT_ID });

  const estimator = await User.findOne({ role: UserRole.ESTIMATOR });
  if (!estimator) throw new Error('No ESTIMATOR user found in DB');
  
  const template = await ExcelTemplateModel.findOne({ isActive: true });
  if (!template) console.warn('⚠️ No active Excel Template found. Excel generation will fail.');

  const projectRepo = new MongooseProjectRepository();
  const proposalRepo = new MongooseProposalRepository();
  const formulaEngine = new FormulaEngineService();
  const proposalService = new ProposalService(proposalRepo, projectRepo, formulaEngine, blobStorage);

  console.log('🏗️ Creating new Project document...');
  await Project.create({
    _id: SEED_PROJECT_ID,
    projectName: '4 Jane Street',
    customerName: 'Sabine El Hachem',
    customerEmail: 'selhachem@acidprojects.com',
    customerPhone: '9293172555',
    address: {
      street: '4 Jane Street',
      city: 'New York',
      state: 'NY'
    },
    referenceNumber: '17722',
    status: 'READY_FOR_ESTIMATOR',
    projectType: 'NEW_ESTIMATE',
    creationSource: 'MANUAL',
    assignedEstimators: [estimator._id],
  });

  console.log('📝 Seeding empty Proposal document...');
  await proposalRepo.ensureProposalExists(SEED_PROJECT_ID);

  console.log('🤖 AI pushing Stage 1 fields...');
  await proposalService.pushStageFromAI(SEED_PROJECT_ID, 1, [
    { fieldPath: 'stage_1.project_name', value: '4 Jane Street' },
    { fieldPath: 'stage_1.project_address', value: '4 Jane Street, New York, NY' },
    { fieldPath: 'stage_1.contact_name', value: 'Sabine El Hachem' },
    { fieldPath: 'stage_1.contact_phone', value: '9293172555' },
    { fieldPath: 'stage_1.contact_email', value: 'selhachem@acidprojects.com' },
    { fieldPath: 'stage_1.project_type', value: 'RESIDENTIAL' },
    { fieldPath: 'stage_1.architect', value: 'Malloch Taylor' },
  ], 'AI_SEED');

  console.log('✅ Estimator approving Stage 1...');
  await proposalService.approveStage(SEED_PROJECT_ID, 1, estimator._id.toString());

  console.log('🤖 AI pushing Stage 2 fields...');
  await proposalService.pushStageFromAI(SEED_PROJECT_ID, 2, [
    { fieldPath: 'stage_2._signals.is_walkable', value: true },
    { fieldPath: 'stage_2._signals.is_exterior', value: true },
    { fieldPath: 'stage_2.glass_type', value: 'GLASS_WITH_IGU' },
  ], 'AI_SEED');

  console.log('✅ Estimator approving Stage 2...');
  await proposalService.approveStage(SEED_PROJECT_ID, 2, estimator._id.toString());

  console.log('🤖 AI pushing Stage 3 fields...');
  await proposalService.pushStageFromAI(SEED_PROJECT_ID, 3, [
    { fieldPath: 'stage_3.decision.frame_type', value: 'DECK_PERIMETER' },
    { fieldPath: 'stage_3.decision.assembly_type', value: 'FA' },
    { fieldPath: 'stage_3.decision.proposal_number', value: 1 },
  ], 'AI_SEED');

  console.log('✅ Estimator approving Stage 3...');
  await proposalService.approveStage(SEED_PROJECT_ID, 3, estimator._id.toString());

  console.log('🤖 AI pushing Stage 4 fields...');
  await proposalService.pushStageFromAI(SEED_PROJECT_ID, 4, [
    { fieldPath: 'stage_4.crossbeam', value: 'T_SECTION_NTB' },
    { fieldPath: 'units.A.value_width_in', value: 25.6 },
    { fieldPath: 'units.A.value_length_in', value: 37.4 },
    { fieldPath: 'units.A.value_panel_count', value: 14 },
    { fieldPath: 'units.A.status', value: 'APPROVED' },
  ], 'AI_SEED');

  console.log('✅ Estimator approving Stage 4...');
  await proposalService.approveStage(SEED_PROJECT_ID, 4, estimator._id.toString());

  console.log('🤖 AI pushing Stage 5 fields...');
  await proposalService.pushStageFromAI(SEED_PROJECT_ID, 5, [
    { fieldPath: 'stage_5.addons.duty', value: 'y' },
    { fieldPath: 'stage_5.addons.nanodot', value: 'n' },
  ], 'AI_SEED');

  console.log('✅ Estimator approving Stage 5...');
  await proposalService.approveStage(SEED_PROJECT_ID, 5, estimator._id.toString());

  let excelPath = '';
  if (template) {
    console.log('📊 Generating Excel file...');
    const { buffer, fileName } = await proposalService.generateExcel(SEED_PROJECT_ID, estimator._id.toString());
    const outDir = path.resolve(__dirname, '../../tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    excelPath = path.join(outDir, `seed-output-${SEED_PROJECT_ID}-${fileName}`);
    fs.writeFileSync(excelPath, buffer);
    console.log(`✅ Excel written to: ${excelPath}`);
  }

  const finalProposal = await ProposalModel.findOne({ projectId: SEED_PROJECT_ID });

  console.log('\n======================================================');
  console.log('🎉 SCHEMA-DRIVEN SEED COMPLETE');
  console.log('======================================================');
  console.log(`Project ID     : ${SEED_PROJECT_ID}`);
  console.log(`Pipeline Status:`, finalProposal?.schema?.pipeline_status);
  console.log(`Total Versions :`, finalProposal?.versions ? Object.keys(finalProposal.versions).length : 0);
  if (excelPath) {
    console.log(`Excel Output   : ${excelPath}`);
  }
  console.log('======================================================\n');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  });
