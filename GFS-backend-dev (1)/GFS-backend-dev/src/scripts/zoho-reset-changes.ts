import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';

/**
 * Clears the noisy "CREATED via backfill" entries so the change feed starts
 * clean and only shows real changes going forward. Touches only our DB.
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-reset-changes.ts
 */
const main = async (): Promise<void> => {
  await connectDB();
  const { deletedCount } = await ZohoLeadChange.deleteMany({ source: 'backfill' });
  console.log(`Cleared ${deletedCount} backfill change entries. Feed is now clean.`);
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('reset failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
