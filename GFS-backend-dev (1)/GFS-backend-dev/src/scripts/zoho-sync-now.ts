import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { zohoTokenRepository, projectRepository } from '@repositories/index';
import { projectCreationService } from '@features/project-creation/project-creation.router';
import { ZohoService } from '@features/zoho/zoho.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';

/**
 * Manually trigger the SAME sync the webhook would run — but over a wider,
 * configurable look-back so we reliably catch recent edits during testing.
 * This simulates Zoho's webhook call without needing a public URL.
 *
 * Read-only to Zoho. Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-sync-now.ts
 *   LOOKBACK_HOURS=24 npx ts-node ... (override the window)
 */
const LOOKBACK_HOURS = Number(process.env['LOOKBACK_HOURS'] ?? '12');

const main = async (): Promise<void> => {
  await connectDB();
  const zoho = new ZohoService(zohoTokenRepository);
  const sync = new ZohoSyncService(zoho, new ZohoProjectService(projectCreationService, projectRepository));

  const since = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  console.log(`Syncing leads modified in the last ${LOOKBACK_HOURS}h (simulating a webhook)...\n`);

  const summary = await sync.syncModifiedSince(since, 'poll');

  console.log('=========== SYNC-NOW DONE ===========');
  console.log(`  scanned (modified in window): ${summary.scanned}`);
  console.log(`  ignored (junk/won):           ${summary.ignored}`);
  console.log(`  new leads created in our DB:  ${summary.created}`);
  console.log(`  existing leads updated:       ${summary.updated}`);
  console.log(`  change-log entries written:   ${summary.changeEntries}`);
  console.log('=====================================');
  if (summary.changeEntries === 0) {
    console.log('  (No changes detected — edit a lead in Zoho, then re-run with a window');
    console.log('   that covers it, e.g. LOOKBACK_HOURS=24.)');
  } else {
    console.log('  >> Refresh the test UI — these changes should now appear in the feed.');
  }
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('sync-now failed:', err instanceof Error ? err.message : err);
  if (err && typeof err === 'object' && 'details' in err) {
    console.error('details:', JSON.stringify((err as { details: unknown }).details));
  }
  process.exit(1);
});
