/**
 * =============================================================================
 * TEST REGENERATE EXCEL (read-only, local file output)
 * =============================================================================
 * Reads a project's current schema straight from Mongo and runs it through
 * the same buildMergedCells()/generateProposalExcelWithFallback() pipeline
 * used in production, then writes the result to a local file. Does NOT
 * issue a quote number, upload to blob storage, sync to Dropbox, or persist
 * any document — purely for eyeballing whether a generator fix behaves.
 *
 * Usage: PROJECT_ID=<id> npx ts-node -r tsconfig-paths/register src/scripts/test-regen-excel.ts
 * (defaults to the 464 Greenwich St project if PROJECT_ID is not set)
 * =============================================================================
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { MongooseProposalRepository } from '../repositories/mongoose/proposal.repository';
import { generateProposalExcelWithFallback, buildPricingWorksheetUnitCells } from '../features/proposal/excel/graph.generator';

const PROJECT_ID = process.env['PROJECT_ID'] || '6a94780b6be1ad15e4ff0fef'; // 464 Greenwich St
const OUTPUT_PATH = path.resolve(__dirname, `../../${PROJECT_ID}-test-regen.xlsx`);

async function main() {
  const mongoUri = process.env['MONGODB_URI'];
  if (!mongoUri) throw new Error('MONGODB_URI is not defined in .env');

  console.log('Connecting to MongoDB (read-only usage)...');
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  const proposalRepo = new MongooseProposalRepository();
  const schema = await proposalRepo.getCurrentSchema(PROJECT_ID);

  console.log('\nUnit take-off cells that will be written (post-fix):');
  console.log(buildPricingWorksheetUnitCells(schema));

  const quoteNumber = 'TEST-REGEN-DO-NOT-USE';
  const { buffer } = await generateProposalExcelWithFallback(schema, quoteNumber);

  fs.writeFileSync(OUTPUT_PATH, buffer);
  console.log(`\nSaved to: ${OUTPUT_PATH}`);

  await mongoose.disconnect();
}

main().catch((err: unknown) => {
  console.error('Generation failed:', err);
  mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
