// /**
//  * =============================================================================
//  * GENERATE TEST EXCEL
//  * =============================================================================
//  * Calls the internal ProposalService to generate the final Excel file, exactly
//  * as the GET /api/v1/proposals/:projectId/excel endpoint would do it.
//  * It writes the resulting file to the filesystem so you can open it locally.
//  * =============================================================================
//  */

// import mongoose from 'mongoose';
// import * as dotenv from 'dotenv';
// import path from 'path';
// import fs from 'fs';

// // Load .env from project root
// dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// import { MongooseProposalRepository } from '../repositories/mongoose/proposal.repository';
// import { MongooseExcelTemplateRepository } from '../repositories/mongoose/excel-template.repository';
// import { MongooseProjectRepository } from '../repositories/mongoose/project.repository';
// import { FormulaEngineService } from '../features/proposal/formula-engine/formula-engine.service';
// import { ProposalService } from '../features/proposal/proposal.service';

// const PROJECT_ID = 'aabbccddeeff112233445566'; // The ID we used in seed-stages.ts
// const SEED_USER_ID = '111122223333444455556666'; // The ESTIMATOR_USER_ID from seed-stages.ts
// const OUTPUT_PATH = '/home/mir/Downloads/intern/gfs/prototype/Generated-Proposal-Test.xlsx';

// async function generate() {
//   const mongoUri = process.env['MONGODB_URI'] || process.env['MONGO_URI'] || 'mongodb+srv://gfsadminamberflux:Pass!word@gfs-mongodb-cosmos.global.mongocluster.cosmos.azure.com/gfs?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000';
//   if (!mongoUri) {
//     throw new Error('MONGODB_URI is not defined in .env');
//   }

//   console.log('🔌 Connecting to MongoDB...');
//   await mongoose.connect(mongoUri);
//   console.log('✅ Connected.');

//   // Initialize services
//   const proposalRepo = new MongooseProposalRepository();
//   const excelTemplateRepo = new MongooseExcelTemplateRepository();
//   const projectRepo = new MongooseProjectRepository();
//   const formulaEngine = new FormulaEngineService();
//   const proposalService = new ProposalService(proposalRepo, excelTemplateRepo, projectRepo, formulaEngine);

//   console.log('⚙️  Generating Excel via ProposalService...');
  
//   const template = await excelTemplateRepo.findActive();
//   if (!template) throw new Error("No active template");

//   const { buffer, filename } = await proposalService.generateExcel(PROJECT_ID, SEED_USER_ID);

//   console.log(`💾 Writing generated file to disk at: ${OUTPUT_PATH}...`);
//   fs.writeFileSync(OUTPUT_PATH, buffer);
  
//   console.log(`🎉 Success!`);
//   console.log(`Original requested filename was: ${filename}`);
//   console.log(`Saved locally as: ${OUTPUT_PATH}`);

//   await mongoose.disconnect();
// }

// generate().catch((err: unknown) => {
//   console.error('❌  Generation failed:', err);
//   mongoose.disconnect().catch(() => undefined);
//   process.exit(1);
// });
