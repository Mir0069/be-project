import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { outlookMonitoredMailboxRepository } from '@repositories/index';

const MAILBOX = (
  process.env['MAILBOX'] ||
  process.env['OUTLOOK_CENTRALIZED_MAILBOX'] ||
  'malhaarlalitmirchandani@outlook.com'
).trim();

async function main() {
  await connectDB();
  console.log(`Connecting to database to seed/reset delta cursor for mailbox: ${MAILBOX}...`);
  
  const mailboxes = await outlookMonitoredMailboxRepository.listActive();
  let target = mailboxes.find(m => m.userId.toLowerCase() === MAILBOX.toLowerCase());
  
  if (!target) {
    console.log(`⚠️ Monitored mailbox for ${MAILBOX} not found in database. Seeding it now...`);
    target = await outlookMonitoredMailboxRepository.upsert({
      userId: MAILBOX,
      displayName: MAILBOX,
      folderId: 'inbox',
    });
    console.log(`✅ Successfully seeded monitored mailbox for ${target.userId} (id: ${target.id}).`);
  }
  
  await outlookMonitoredMailboxRepository.updateDeltaLink(target.id, null);
  console.log(`✅ Success: Delta cursor for ${target.userId} (id: ${target.id}) has been reset to null.`);
  console.log('The next sync/polling tick will perform a full re-sync and ingest skipped emails.');
  
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
