import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { ZohoTokenModel } from '@db/models/zoho-token.model';

const main = async (): Promise<void> => {
  await connectDB();
  const conn = mongoose.connection;
  console.log(`DB host: ${conn.host}  name: ${conn.name}`);

  const [leads, changes, tokens] = await Promise.all([
    ZohoLead.countDocuments(),
    ZohoLeadChange.countDocuments(),
    ZohoTokenModel.countDocuments(),
  ]);

  console.log(`zoho_leads:        ${leads}`);
  console.log(`zoho_lead_changes: ${changes}`);
  console.log(`zoho_tokens:       ${tokens}  (need >=1 for sync to authenticate)`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('peek failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
