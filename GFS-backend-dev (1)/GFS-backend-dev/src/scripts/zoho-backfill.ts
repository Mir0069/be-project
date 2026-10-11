import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { zohoTokenRepository, projectRepository } from '@repositories/index';
import { projectCreationService } from '@features/project-creation/project-creation.router';
import { ZohoService } from '@features/zoho/zoho.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';

/**
 * One-shot backfill: pull leads CREATED in the window (ignored statuses
 * dropped) from Zoho and upsert them into our ZohoLead collection so the test
 * UI starts with data.
 *
 * Read-only to Zoho (GET only). Writes only to our MongoDB.
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-backfill.ts
 */

// Last ~1 month (.in account → +05:30).
const FROM = '2026-05-16T00:00:00+05:30';
const TO = '2026-06-16T23:59:59+05:30';

const main = async (): Promise<void> => {
  await connectDB();

  const zoho = new ZohoService(zohoTokenRepository);
  const sync = new ZohoSyncService(zoho, new ZohoProjectService(projectCreationService, projectRepository));

  console.log(`Backfilling leads created ${FROM} .. ${TO} (ignored statuses dropped)...`);
  const summary = await sync.backfill(FROM, TO);

  console.log('\n=========== BACKFILL DONE ===========');
  console.log(`  scanned in window:   ${summary.scanned}`);
  console.log(`  ignored (junk/won):  ${summary.ignored}`);
  console.log(`  created in our DB:   ${summary.created}`);
  console.log(`  updated in our DB:   ${summary.updated}`);
  console.log(`  change-log entries:  ${summary.changeEntries}`);
  console.log('=====================================\n');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('\nzoho-backfill failed:', err instanceof Error ? err.message : err);
  if (err && typeof err === 'object' && 'details' in err) {
    console.error('details:', JSON.stringify((err as { details: unknown }).details));
  }
  process.exit(1);
});
