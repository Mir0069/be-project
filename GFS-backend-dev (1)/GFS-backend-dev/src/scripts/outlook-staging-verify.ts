import axios from 'axios';
import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';

const MAILBOX = process.env['MAILBOX'] ?? 'gfs2@amberflux.in';

const main = async (): Promise<void> => {
  await connectDB();

  const storage = new AzureContentAddressedBlobStorage({
    connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
    containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
  });

  const emails = await OutlookEmail.find({
    mailboxUserId: MAILBOX,
    'attachments.0': { $exists: true },
  }).limit(5);

  console.log(`Emails with attachments: ${emails.length}\n`);

  for (const e of emails) {
    console.log(`✉  "${e.subject}"`);
    for (const a of e.attachments) {
      if (a.isInline) continue;
      console.log(`   • ${a.name}`);
      console.log(`     downloaded : ${a.downloaded}`);
      console.log(`     storageKey : ${a.storageKey ?? '(none)'}`);

      if (a.storageKey) {
        // Confirm the blob actually exists by generating a SAS and fetching it.
        const url = await storage.createSignedDownloadUrl(a.storageKey, 5);
        try {
          const res = await axios.get(url, { responseType: 'arraybuffer' });
          console.log(`     blob       : ✓ EXISTS (${res.data.byteLength} bytes in Azure)`);
        } catch (err: any) {
          console.log(`     blob       : ✗ NOT reachable (${err.response?.status ?? err.message})`);
        }
      }
    }
    console.log('');
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
