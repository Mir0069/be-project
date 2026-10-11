import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { ZohoWebhookEvent } from '@db/models/zoho-webhook-event.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { ZohoLead } from '@db/models/zoho-lead.model';

/**
 * Diagnostic: where did the webhook -> sync -> change loop break?
 * Run: npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-diag.ts
 */
const main = async (): Promise<void> => {
  await connectDB();

  const leadCount = await ZohoLead.countDocuments();
  const hookCount = await ZohoWebhookEvent.countDocuments();
  const changeCount = await ZohoLeadChange.countDocuments();

  console.log('\n================ ZOHO SYNC DIAGNOSTIC ================');
  console.log(`ZohoLead docs:          ${leadCount}`);
  console.log(`ZohoWebhookEvent docs:  ${hookCount}   <- did Zoho ever call us?`);
  console.log(`ZohoLeadChange docs:    ${changeCount}   <- did sync detect changes?`);

  console.log('\n--- last 5 webhook events received ---');
  const hooks = await ZohoWebhookEvent.find().sort({ receivedAt: -1 }).limit(5).lean();
  if (hooks.length === 0) {
    console.log('  (NONE) — Zoho has never reached this server. The webhook URL is not');
    console.log('  delivering. Most likely Zoho cannot reach a localhost URL — you need a');
    console.log('  public tunnel (ngrok) and the Zoho webhook must point at it.');
  }
  for (const h of hooks) {
    console.log(`  [${new Date(h.receivedAt).toISOString()}] ${h.method}  body=${JSON.stringify(h.body).slice(0, 300)}`);
  }

  console.log('\n--- last 5 change-log entries ---');
  const changes = await ZohoLeadChange.find().sort({ changedAt: -1 }).limit(5).lean();
  if (changes.length === 0) console.log('  (NONE)');
  for (const c of changes) {
    console.log(`  [${new Date(c.changedAt).toISOString()}] ${c.type} ${c.leadName ?? ''} ${c.field ?? ''} ${c.oldValue ?? ''} -> ${c.newValue ?? ''} (via ${c.source})`);
  }
  console.log('=====================================================\n');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('diag failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
