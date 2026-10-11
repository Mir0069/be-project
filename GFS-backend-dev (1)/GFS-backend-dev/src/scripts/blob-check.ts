import 'dotenv/config';
import crypto from 'crypto';
import axios from 'axios';

import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';

(async () => {
  const storage = new AzureContentAddressedBlobStorage({
    connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
    containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
  });

  const buffer = Buffer.from(`blob-check ${new Date().toISOString()}`);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  console.log('① put()…');
  const stored = await storage.put({
    projectId: 'verify',
    sha256,
    originalName: 'blob-check.txt',
    mimeType: 'text/plain',
    buffer,
  });
  console.log('   ✓ stored at', stored.storageKey, `(${stored.byteSize} bytes)`);

  console.log('② createSignedDownloadUrl()…');
  const url = await storage.createSignedDownloadUrl(stored.storageKey, 5);
  console.log('   ✓ SAS url:', url.slice(0, 90) + '…');

  console.log('③ fetch via SAS…');
  const res = await axios.get(url, { responseType: 'text' });
  console.log('   ✓ downloaded:', JSON.stringify(res.data));

  console.log('④ delete()…');
  await storage.delete(stored.storageKey);
  console.log('   ✓ deleted');

  console.log('\n✅ Azure Blob is fully working (put + SAS download + delete).');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ blob check failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
