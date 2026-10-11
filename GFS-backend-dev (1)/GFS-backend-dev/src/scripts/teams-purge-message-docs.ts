import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { DocumentModel } from '@db/models/document.model';

/**
 * Soft-deletes chat-message-as-document records (message-*.txt) that were
 * ingested before Teams message-ingestion was disabled. Real shared files
 * (kind != 'channel-message') are left untouched.
 *
 * Dry run:  ... teams-purge-message-docs.ts
 * Execute:  ... teams-purge-message-docs.ts --apply
 */
const main = async (): Promise<void> => {
  await connectDB();
  const apply = process.argv.includes('--apply');

  const filter = { 'metadata.source': 'teams', 'metadata.kind': 'channel-message', isActive: true };
  const docs = await DocumentModel.find(filter).select('originalName projectId').lean();

  console.log(`\nMESSAGE-DOCS to remove: ${docs.length}\n`);
  for (const d of docs) {
    console.log(`  • ${d.originalName}  (project ${d.projectId ?? 'null'})`);
  }

  if (!apply) {
    console.log('\nDRY RUN — re-run with --apply to soft-delete these.\n');
  } else {
    const res = await DocumentModel.updateMany(filter, { $set: { isActive: false } });
    console.log(`\nSoft-deleted ${res.modifiedCount} document(s).\n`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('purge failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
