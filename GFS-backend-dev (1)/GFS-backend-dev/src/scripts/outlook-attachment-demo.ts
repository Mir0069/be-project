import crypto from 'crypto';
import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { MongooseOutlookTokenRepository } from '@repositories/mongoose/outlook-token.repository';
import { OutlookTokenService } from '@features/outlook/outlook-token.service';
import { OutlookGraphClient } from '@features/outlook/outlook.graph-client';
import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';
import { FILE_ATTACHMENT_ODATA_TYPE } from '@features/outlook/outlook.types';
import type { GraphList, GraphMailAttachment, GraphMailMessage } from '@features/outlook/outlook.types';

const MAILBOX = process.env['MAILBOX'] ?? 'gfs2@amberflux.in';

const main = async (): Promise<void> => {
  await connectDB();

  const tokenService = new OutlookTokenService(new MongooseOutlookTokenRepository(), {
    clientId: env.outlook.clientId,
    clientSecret: env.outlook.clientSecret,
    tenantId: env.outlook.tenantId,
    authority: env.outlook.authority,
    scope: env.outlook.scope,
  });
  const graph = new OutlookGraphClient(tokenService, env.outlook.graphBaseUrl);
  const storage = new AzureContentAddressedBlobStorage({
    connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
    containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
  });

  // 1) Find a recent email that has attachments.
  console.log(`① Finding an email with attachments in ${MAILBOX}…`);
  const list = await graph.get<GraphList<GraphMailMessage>>(
    `/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages`,
    { $top: '15', $select: 'subject,from,hasAttachments', $orderby: 'receivedDateTime desc' },
  );
  const withAtt = (list.value ?? []).find((m) => m.hasAttachments);
  if (!withAtt) {
    console.log('   (no recent email with attachments found)');
    await mongoose.disconnect();
    process.exit(0);
  }
  console.log(`   ✓ "${withAtt.subject}" from ${withAtt.from?.emailAddress?.address}\n`);

  // 2) List its attachments.
  const attRes = await graph.get<GraphList<GraphMailAttachment>>(
    `/users/${encodeURIComponent(MAILBOX)}/messages/${withAtt.id}/attachments`,
    { $select: 'id,name,contentType,size,isInline' },
  );
  const files = (attRes.value ?? []).filter(
    (a) => (!a['@odata.type'] || a['@odata.type'] === FILE_ATTACHMENT_ODATA_TYPE) && !a.isInline,
  );
  console.log(`② ${files.length} file attachment(s):`);

  // 3) For each: download bytes from Graph → store to Blob → SAS URL (the AI handoff).
  for (const a of files) {
    const buffer = await graph.getBinary(
      `/users/${encodeURIComponent(MAILBOX)}/messages/${withAtt.id}/attachments/${a.id}/$value`,
    );
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const stored = await storage.put({
      projectId: 'staging', // project-less staging prefix (no project yet)
      sha256,
      originalName: a.name ?? 'attachment',
      mimeType: a.contentType ?? 'application/octet-stream',
      buffer,
    });
    const sasUrl = await storage.createSignedDownloadUrl(stored.storageKey, 30);

    console.log(`\n   • ${a.name} (${a.contentType}, ${buffer.length} bytes)`);
    console.log(`     ↳ blob key : ${stored.storageKey}`);
    console.log(`     ↳ SAS url  : ${sasUrl}`);
    console.log(`       ^ this URL is what goes to AI in the job payload`);
  }

  console.log('\n✅ Mail fetched → attachments downloaded from Graph → stored in Blob → SAS URL ready for AI.');
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('\n❌ demo failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
