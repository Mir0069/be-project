import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { ZohoWebhookEvent } from '@db/models/zoho-webhook-event.model';

const main = async (): Promise<void> => {
  await connectDB();
  const r1 = await ZohoLead.deleteMany({});
  const r2 = await ZohoLeadChange.deleteMany({});
  const r3 = await ZohoWebhookEvent.deleteMany({});
  console.log(`Wiped: ${r1.deletedCount} leads, ${r2.deletedCount} changes, ${r3.deletedCount} webhook events`);
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('wipe failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
