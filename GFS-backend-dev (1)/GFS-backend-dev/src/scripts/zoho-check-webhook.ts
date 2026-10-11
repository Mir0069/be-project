import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { zohoTokenRepository } from '@repositories/index';
import { ZohoService } from '@features/zoho/zoho.service';

/**
 * Read-only check: is any instant-notification (webhook) subscription
 * configured in Zoho, and where does it point? GET only — touches nothing.
 *
 * Run: npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-check-webhook.ts
 */
const main = async (): Promise<void> => {
  await connectDB();
  const zoho = new ZohoService(zohoTokenRepository);

  console.log('\nChecking Zoho instant-notification subscriptions (GET /crm/v2/actions/watch)...\n');
  try {
    const resp = await zoho.fetchFromZoho<{ watch?: Array<Record<string, unknown>> } | string>(
      '/crm/v2/actions/watch',
    );
    if (typeof resp !== 'object' || resp === null) {
      console.log('No subscriptions returned (empty response). => No API webhook is configured.');
    } else {
      const watch = resp.watch ?? [];
      console.log(`Found ${watch.length} subscription(s):`);
      for (const w of watch) {
        console.log(`  channel=${w['channel_id']}  events=${JSON.stringify(w['events'])}`);
        console.log(`    notify_url = ${w['notify_url']}`);
        console.log(`    enabled    = ${w['_delete'] ? false : true}`);
      }
      if (watch.length === 0) {
        console.log('  => No instant-notification webhook is set up via the API.');
      }
    }
  } catch (err) {
    const e = err as { message?: string; details?: unknown };
    console.log('Could not read notification subscriptions.');
    console.log(`  reason: ${e.message ?? err}`);
    if (e.details) console.log(`  details: ${JSON.stringify(e.details)}`);
    console.log('\n  If this is a SCOPE error, it means no Notification-API webhook exists');
    console.log('  for our app (our token lacks the notifications scope). Any webhook you');
    console.log('  set up would then be a Workflow-Rule webhook in the Zoho UI instead.');
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
