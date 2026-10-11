import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { zohoTokenRepository, projectRepository } from '@repositories/index';
import { projectCreationService } from '@features/project-creation/project-creation.router';
import { ZohoService } from '@features/zoho/zoho.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';

/**
 * Safe change-detection test that NEVER modifies Zoho.
 *
 * It simulates "a field changed" by editing OUR stored copy in our DB, then
 * re-fetches the real (unchanged) lead from Zoho and runs the diff. The diff
 * sees our stale value vs Zoho's real value and logs an UPDATED change — proving
 * the whole webhook diff path works. Afterwards our DB is back in sync with the
 * real Zoho value, so nothing is left polluted. Zoho stays read-only throughout.
 *
 * Run: npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-test-diff.ts
 */
const SIM_OLD = '__SIMULATED_OLD_VALUE__';

const main = async (): Promise<void> => {
  await connectDB();
  const zoho = new ZohoService(zohoTokenRepository);
  const sync = new ZohoSyncService(zoho, new ZohoProjectService(projectCreationService, projectRepository));

  const lead = await ZohoLead.findOne().lean();
  if (!lead) {
    console.log('No leads in our DB. Run the backfill first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const id = lead.zohoLeadId;
  const originalRaw = (lead.raw ?? {}) as Record<string, unknown>;
  const realStatus = originalRaw['Lead_Status'] ?? lead.leadStatus ?? '(none)';
  console.log(`Test lead: ${lead.fullName ?? id}`);
  console.log(`  real Lead_Status in Zoho: "${realStatus}"`);

  try {
    // 1. Make OUR stored copy look stale (as if Zoho changed since our last sync).
    await ZohoLead.updateOne(
      { zohoLeadId: id },
      { $set: { 'raw.Lead_Status': SIM_OLD, leadStatus: SIM_OLD } },
    );
    console.log(`  simulated our stored copy as stale: "${SIM_OLD}"`);

    // 2. Re-fetch the REAL lead from Zoho (read-only) and run the diff.
    console.log('  fetching real lead from Zoho and running diff (read-only)...');
    const result = await sync.syncLeadById(id, 'poll');
    console.log(`  sync result: ${JSON.stringify(result)}`);

    // 3. Show the change the diff produced.
    const change = await ZohoLeadChange.findOne({ zohoLeadId: id, field: 'Lead_Status' })
      .sort({ changedAt: -1 })
      .lean();

    console.log('\n=========== CHANGE DETECTION TEST ===========');
    if (change) {
      console.log(`  ✓ UPDATED detected on "${lead.fullName ?? id}"`);
      console.log(`    Lead_Status: "${change.oldValue}" -> "${change.newValue}"`);
      console.log(`    at ${new Date(change.changedAt).toLocaleString()} (via ${change.source})`);
      console.log('\n  >> Refresh the test UI — this UPDATED card is now in the feed.');
    } else {
      console.log('  ✗ No change entry was produced — something is off in the diff.');
    }
    console.log('=============================================');
    console.log('  Our DB is now back in sync with the real Zoho value. Zoho untouched.\n');
  } catch (err) {
    // On any failure, restore our stored copy so we don't leave it polluted.
    await ZohoLead.updateOne(
      { zohoLeadId: id },
      { $set: { 'raw.Lead_Status': realStatus, leadStatus: realStatus } },
    );
    console.error('test failed, restored original value:', err instanceof Error ? err.message : err);
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('zoho-test-diff failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
