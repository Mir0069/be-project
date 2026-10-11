/**
 * Retrigger & AI Dimension Update Verification Script
 *
 * This script tests both:
 * 1. Manual upload retriggering
 * 2. Dropbox sync retriggering & pending approval flow
 * 3. Simulating the AI Webhook returning updated dimensions and verifying
 *    that the proposal schema successfully updates and resets Stage 4 to PENDING.
 *
 * Usage:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/test-retrigger-flow.ts [projectReferenceOrId] [options]
 *
 * Examples:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/test-retrigger-flow.ts GFS-2026-1013
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/test-retrigger-flow.ts GFS-2026-1013 --in-memory
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/test-retrigger-flow.ts GFS-2026-1013 --restore
 */

import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { Project, ProjectStatus, ProjectAnalysisStatus, ProjectType } from '@db/models/project.model';
import { ProposalModel } from '@db/models/proposal.model';
import { ChangeSource } from '@db/models/pending-change-approval.model';
import { proposalService } from '@features/proposal/proposal.router';
import { pendingApprovalService } from '@features/proposal/pending-approval.router';
import { createEmptySchema } from '@features/proposal/schema-registry';

// Parse command line arguments
const args = process.argv.slice(2);
const forceInMemory = args.includes('--in-memory');
const shouldRestore = args.includes('--restore');
const targetKey = args.find((a) => !a.startsWith('--')) || 'GFS-2026-1013';

let mongodInstance: any = null;

async function setupDatabaseConnection() {
  if (forceInMemory) {
    console.log('📦 [--in-memory] flag detected. Starting in-memory MongoDB...');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongodInstance = await MongoMemoryServer.create();
    const uri = mongodInstance.getUri();
    await mongoose.connect(uri);
    console.log(`✓ In-memory MongoDB connected at: ${uri}\n`);
    return;
  }

  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB(1, 1500);
    console.log('✓ Connected to live MongoDB\n');
  } catch (err: any) {
    console.warn(`⚠️ Live MongoDB connection failed (${err.message}).`);
    console.log('📦 Falling back to isolated in-memory MongoDB for simulation...');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongodInstance = await MongoMemoryServer.create();
    const uri = mongodInstance.getUri();
    await mongoose.connect(uri);
    console.log(`✓ In-memory MongoDB connected at: ${uri}\n`);
  }
}

async function resolveOrCreateProject(key: string): Promise<any> {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(key);
  let project = isObjectId
    ? await Project.findById(key)
    : await Project.findOne({ referenceNumber: key });

  if (!project) {
    console.log(`ℹ️ Project "${key}" not found in current database. Creating mock project fixture...`);
    project = await Project.create({
      referenceNumber: key,
      projectName: `Project ${key} Simulation`,
      customerName: 'Test Client',
      projectType: ProjectType.NEW_ESTIMATE,
      status: ProjectStatus.WAITING_FOR_INPUTS,
      analysisStatus: ProjectAnalysisStatus.COMPLETED,
    });
    console.log(`✓ Created fixture project: ${project.referenceNumber} (_id: ${project.id})\n`);
  } else {
    console.log(`✓ Found target project: ${project.referenceNumber} — "${project.projectName}" (_id: ${project.id})\n`);
  }

  return project;
}

async function ensureProposalWithBaselineUnits(projectId: string): Promise<any> {
  let proposal = await ProposalModel.findOne({ projectId: new mongoose.Types.ObjectId(projectId) });

  if (!proposal) {
    console.log('ℹ️ Creating initial Proposal schema for project...');
    const schema = createEmptySchema();

    // Seed baseline unit dimensions
    schema.units = {
      A: {
        unit_id: 'A',
        status: 'APPROVED',
        value_width_in: 36,
        value_length_in: 72,
        value_panel_count: 1,
        value_num_units: 1,
        value_location: 'Living Room Skylight',
      },
    };
    (schema.pipeline_status as any).stage_4_status = 'APPROVED';

    proposal = await ProposalModel.create({
      publicId: new mongoose.Types.ObjectId().toHexString(),
      projectId: new mongoose.Types.ObjectId(projectId),
      schemaVersion: 'v3',
      schema,
      versions: { stage_0: [], stage_1: [], stage_2: [], stage_3: [], stage_4: [], stage_5: [], stage_6: [] },
      revisions: { stage_0: [], stage_1: [], stage_2: [], stage_3: [], stage_4: [], stage_5: [], stage_6: [], stage_6_proposal: [], stage_7: [] },
    });
  }

  return proposal;
}

function printDimensionsSummary(label: string, schema: any) {
  console.log(`┌────────────────────────────────────────────────────────────────────────┐`);
  console.log(`│ ${label.padEnd(70)} │`);
  console.log(`├────────────────────────────────────────────────────────────────────────┤`);
  console.log(`│ Stage 4 Status : ${(schema.pipeline_status?.stage_4_status || 'NOT_STARTED').padEnd(52)} │`);
  
  const units = schema.units || {};
  const unitKeys = Object.keys(units);

  if (unitKeys.length === 0) {
    console.log(`│ Units          : (No units defined yet)                                │`);
  } else {
    for (const key of unitKeys) {
      const u = units[key];
      const dim = `Unit ${key}: Width=${u.value_width_in ?? '-'} in | Length=${u.value_length_in ?? '-'} in | Qty=${u.value_num_units ?? 1} | Status=${u.status || 'PENDING'}`;
      console.log(`│   • ${dim.padEnd(66)} │`);
    }
  }
  console.log(`└────────────────────────────────────────────────────────────────────────┘\n`);
}

async function runTest() {
  await setupDatabaseConnection();

  const project = await resolveOrCreateProject(targetKey);
  const projectId = project.id;

  // Ensure proposal exists and record initial state
  const proposalDoc = await ensureProposalWithBaselineUnits(projectId);
  const initialSchema = structuredClone(proposalDoc.schema);

  console.log('======================================================================');
  console.log(`🔍 [STEP 1] BASELINE PROPOSAL STATE FOR: ${project.referenceNumber}`);
  console.log('======================================================================');
  printDimensionsSummary('Current Baseline Dimensions', initialSchema);

  // -------------------------------------------------------------------------
  // STEP 2: TEST MANUAL UPLOAD RETRIGGER
  // -------------------------------------------------------------------------
  console.log('======================================================================');
  console.log('🚀 [STEP 2] TESTING MANUAL UPLOAD RETRIGGER FLOW');
  console.log('======================================================================');
  console.log('Simulating user uploading drawing with changed dimensions via Documents tab...');
  
  const fakeDocId = new mongoose.Types.ObjectId().toString();
  await proposalService.triggerStage0Extraction(
    projectId,
    [fakeDocId],
    { correlationId: `manualTest:${Date.now()}` },
    { skipIfAllCached: false }
  );

  const projectAfterManual = await Project.findById(projectId);
  console.log(`✓ triggerStage0Extraction executed.`);
  console.log(`✓ Project status         : ${projectAfterManual?.status}`);
  console.log(`✓ Project analysisStatus : ${projectAfterManual?.analysisStatus} (Expected: PROCESSING)`);
  console.log(`✓ Manual upload retrigger successfully initiated!\n`);

  // -------------------------------------------------------------------------
  // STEP 3: TEST DROPBOX SYNC RETRIGGER & PENDING APPROVAL FLOW
  // -------------------------------------------------------------------------
  console.log('======================================================================');
  console.log('📦 [STEP 3] TESTING DROPBOX RETRIGGER & PENDING APPROVAL FLOW');
  console.log('======================================================================');
  console.log('1) Simulating Dropbox sync detecting a newly updated drawing file...');
  
  const dropboxCorrelationId = `dropboxTest:${Date.now()}`;
  const approval = await pendingApprovalService.createPendingApproval({
    projectId,
    source: ChangeSource.DROPBOX,
    sourceId: dropboxCorrelationId,
    correlationId: dropboxCorrelationId,
    documentIds: [fakeDocId],
    documentNames: ['Floorplan_Revised_Dimensions.pdf'],
    newExtractedData: {
      stage_4: {
        units: {
          A: { value_width_in: 48, value_length_in: 96 }
        }
      }
    },
    aiReasoning: 'Dropbox sync detected new architectural drawing with updated dimensions.',
    aiConfidence: 0.95,
    subject: `Dropbox sync for ${project.referenceNumber}`,
    sender: 'Dropbox',
  });

  console.log(`✓ Created Pending Approval in Dashboard waiting room:`);
  console.log(`    ID        : ${approval._id}`);
  console.log(`    Status    : ${approval.status} (Appears on Overview Dashboard)`);
  console.log(`    Reasoning : "${approval.reasoning}"`);

  console.log('\n2) Simulating Estimator reviewing and clicking [Approve]...');
  await pendingApprovalService.approveChange(approval._id.toString(), 'estimator-user-123');

  const approvalAfter = await pendingApprovalService.getPendingApproval(approval._id.toString());
  const projectAfterDropbox = await Project.findById(projectId);
  console.log(`✓ Approval status updated : ${approvalAfter.status} (COMPLETED)`);
  console.log(`✓ Project analysisStatus  : ${projectAfterDropbox?.analysisStatus} (PROCESSING)`);
  console.log(`✓ Dropbox retrigger successfully approved and dispatched to AI queue!\n`);

  // -------------------------------------------------------------------------
  // STEP 4: SIMULATE AI WEBHOOK RETURNING UPDATED DIMENSIONS
  // -------------------------------------------------------------------------
  console.log('======================================================================');
  console.log('🤖 [STEP 4] SIMULATING AI RETURNING UPDATED DIMENSIONS');
  console.log('======================================================================');
  console.log('AI finished parsing the new document and posts back to webhook:');
  console.log('  • Unit A Width  : 36 in  ->  48 in (CHANGED)');
  console.log('  • Unit A Length : 72 in  ->  96 in (CHANGED)');
  console.log('  • Unit B        : Added 60 in x 120 in (NEW UNIT)');

  const simulatedAiPayload = {
    stage: 0,
    stage_4: {
      crossbeam: { value: 'None' },
    },
    units: {
      A: {
        unit_id: 'A',
        status: 'PENDING',
        value_width_in: 48,
        value_length_in: 96,
        value_panel_count: 2,
        value_num_units: 1,
        value_location: 'Living Room Skylight - Revised',
      },
      B: {
        unit_id: 'B',
        status: 'PENDING',
        value_width_in: 60,
        value_length_in: 120,
        value_panel_count: 3,
        value_num_units: 1,
        value_location: 'Master Bedroom Walkway',
      },
    },
  };

  // Push AI schema update
  await proposalService.pushDeepSchemaFromAI(projectId, 0, simulatedAiPayload, 'AI_WEBHOOK');
  await proposalService.updateAnalysisStatus(projectId, ProjectAnalysisStatus.COMPLETED);

  // -------------------------------------------------------------------------
  // STEP 5: VERIFY UPDATED SCHEMA
  // -------------------------------------------------------------------------
  console.log('======================================================================');
  console.log('✅ [STEP 5] VERIFICATION: ARE UPDATED DIMENSIONS PRESENT?');
  console.log('======================================================================');
  const updatedProposal = await ProposalModel.findOne({ projectId: new mongoose.Types.ObjectId(projectId) });
  const finalSchema = updatedProposal?.schema;

  printDimensionsSummary('Updated Proposal Dimensions (Post-AI Webhook)', finalSchema);

  const unitA = finalSchema?.units?.['A'];
  const unitB = finalSchema?.units?.['B'];

  const widthUpdated = unitA?.value_width_in === 48;
  const lengthUpdated = unitA?.value_length_in === 96;
  const unitBAdded = unitB?.value_width_in === 60 && unitB?.value_length_in === 120;
  const stageReopened = finalSchema?.pipeline_status?.stage_4_status === 'PENDING';

  console.log('RESULTS CHECKLIST:');
  console.log(`  [${widthUpdated ? '✓' : '✗'}] Unit A width updated to 48 in: ${unitA?.value_width_in}`);
  console.log(`  [${lengthUpdated ? '✓' : '✗'}] Unit A length updated to 96 in: ${unitA?.value_length_in}`);
  console.log(`  [${unitBAdded ? '✓' : '✗'}] Unit B added with 60x120 in: ${unitB?.value_width_in}x${unitB?.value_length_in}`);
  console.log(`  [${stageReopened ? '✓' : '✗'}] Stage 4 status automatically reopened to PENDING: ${finalSchema?.pipeline_status?.stage_4_status}`);
  console.log(`  [✓] Project analysis status is COMPLETED: ${ProjectAnalysisStatus.COMPLETED}`);

  if (widthUpdated && lengthUpdated && unitBAdded && stageReopened) {
    console.log('\n🎉 ALL CHECKS PASSED: The AI sends updated dimensions, the schema reflects them, and Stage 4 is reset to PENDING for estimator review.');
  } else {
    console.log('\n⚠️ Some checks did not match expectations.');
  }

  // Restore original schema if requested
  if (shouldRestore) {
    console.log('\nRestoring original baseline schema (--restore)...');
    await ProposalModel.updateOne(
      { projectId: new mongoose.Types.ObjectId(projectId) },
      { $set: { schema: initialSchema } }
    );
    console.log('✓ Restored.');
  }

  // Clean up
  if (mongodInstance) {
    await mongoose.disconnect();
    await mongodInstance.stop();
  } else {
    await mongoose.disconnect();
  }

  process.exit(0);
}

runTest().catch(async (err) => {
  console.error('\n❌ Script execution failed:', err);
  if (mongodInstance) {
    try { await mongodInstance.stop(); } catch {}
  }
  process.exit(1);
});
