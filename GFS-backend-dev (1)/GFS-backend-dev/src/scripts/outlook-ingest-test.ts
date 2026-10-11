// import mongoose from 'mongoose';

// import { env } from '@config/index';
// import { connectDB } from '@db/connection';
// import {
//   outlookTokenRepository,
//   outlookMonitoredMailboxRepository,
//   outlookEmailRepository,
//   projectRepository,
// } from '@repositories/index';
// import { OutlookTokenService } from '@features/outlook/outlook-token.service';
// import { OutlookGraphClient } from '@features/outlook/outlook.graph-client';
// import { OutlookAssociationService } from '@features/outlook/outlook-association.service';
// import { OutlookService } from '@features/outlook/outlook.service';
// import { LoggingDocumentIngestionPort } from '@features/outlook/document-ingestion.port';
// import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';

// const MAILBOX = process.env['MAILBOX'] ?? 'gfs2@amberflux.in';

// const main = async (): Promise<void> => {
//   await connectDB();

//   const tokenService = new OutlookTokenService(outlookTokenRepository, {
//     clientId: env.outlook.clientId,
//     clientSecret: env.outlook.clientSecret,
//     tenantId: env.outlook.tenantId,
//     authority: env.outlook.authority,
//     scope: env.outlook.scope,
//   });
//   const graphClient = new OutlookGraphClient(tokenService, env.outlook.graphBaseUrl);
//   const associationService = new OutlookAssociationService(projectRepository);
//   // Stub the email-package handoff (logging) but use REAL blob storage so
//   // attachments are actually staged to Azure Blob and storageKey is saved.
//   const port = new LoggingDocumentIngestionPort();
//   const blobStorage = new AzureContentAddressedBlobStorage({
//     connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
//     containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
//   });

//   const service = new OutlookService(
//     graphClient,
//     tokenService,
//     outlookMonitoredMailboxRepository,
//     outlookEmailRepository,
//     associationService,
//     projectRepository,
//     port,
//     blobStorage,
//   );

//   console.log(`\n① Registering monitored mailbox ${MAILBOX}…`);
//   const mailbox = await outlookMonitoredMailboxRepository.upsert({
//     userId: MAILBOX,
//     displayName: MAILBOX,
//   });
//   // RESET=1 clears the delta cursor so all mail is re-ingested (re-stages attachments).
//   if (process.env['RESET']) {
//     await outlookMonitoredMailboxRepository.updateDeltaLink(mailbox.id, null);
//     console.log('   ↺ delta cursor reset (full re-ingest)');
//   }
//   console.log(`   ✓ id=${mailbox.id}, folder=${mailbox.folderId}\n`);

//   console.log('② Running syncAll() (delta ingest)…');
//   const summary = await service.syncAll();
//   for (const m of summary.mailboxes) {
//     console.log(`   ✓ ${m.mailboxUserId}: ingested ${m.ingested}`);
//   }
//   for (const e of summary.errors) {
//     console.log(`   ✗ ${e.mailboxUserId}: ${e.message}`);
//   }

//   console.log('\n③ Stored emails for this mailbox:');
//   const page = await service.listEmails({ mailboxUserId: MAILBOX, limit: 20 });
//   console.log(`   total stored: ${page.total}`);
//   for (const e of page.emails) {
//     const link = e.projectId ? `→ project ${e.projectId} (${e.linkMethod})` : `(${e.linkMethod})`;
//     const att = e.attachments?.length ? ` 📎${e.attachments.length}` : '';
//     console.log(`   • ${e.subject ?? '(no subject)'} — from ${e.fromAddress ?? '?'} ${link}${att}`);
//   }

//   console.log('\n✅ Ingestion test complete.');
//   await mongoose.disconnect();
//   process.exit(0);
// };

// main().catch((err) => {
//   console.error('\n❌ ingest test failed:', err instanceof Error ? err.message : err);
//   process.exit(1);
// });
