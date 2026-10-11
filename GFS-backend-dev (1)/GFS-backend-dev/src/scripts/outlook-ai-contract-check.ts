import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { projectRepository } from '@repositories/index';
import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';

const MAILBOX = process.env['MAILBOX'] ?? 'gfs2@amberflux.in';

const main = async (): Promise<void> => {
  await connectDB();

  const storage = new AzureContentAddressedBlobStorage({
    connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
    containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
  });

  // Pick a real ingested email that has an attachment.
  const doc = await OutlookEmail.findOne({
    mailboxUserId: MAILBOX,
    'attachments.0': { $exists: true },
  });
  if (!doc) {
    console.log('no email with attachments found');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Candidate projects come from the projects collection, not the email.
  const projects = await projectRepository.listActive();

  // Build the AI request EXACTLY per the contract, from Mongo data.
  const job = {
    correlationId: `outlookEmail:${doc._id.toString()}`,
    source: 'OUTLOOK',
    mailbox: doc.mailboxUserId,
    email: {
      messageId: doc.messageId,
      conversationId: doc.conversationId ?? null,
      from: { name: doc.fromName ?? null, address: doc.fromAddress ?? null },
      to: doc.toRecipients ?? [],
      subject: doc.subject ?? null,
      bodyText: doc.bodyText ?? '',
      receivedDateTime: doc.receivedDateTime?.toISOString(),
    },
    attachments: await Promise.all(
      doc.attachments
        .filter((a) => !a.isInline)
        .map(async (a) => ({
          name: a.name ?? null,
          contentType: a.contentType ?? null,
          size: a.size ?? null,
          // SAS is generated on demand from storageKey (NOT the stored blobUrl).
          downloadUrl: a.storageKey ? await storage.createSignedDownloadUrl(a.storageKey, 30) : null,
        })),
    ),
    candidateProjects: projects.map((p) => ({
      projectId: p.id,
      referenceNumber: p.referenceNumber,
      projectName: p.projectName,
      customerName: p.customerName,
      status: p.status,
    })),
  };

  // Field-presence checklist.
  const check = (label: string, ok: boolean): void =>
    console.log(`   ${ok ? '✓' : '✗'} ${label}`);

  console.log(`\nContract REQUEST built from Mongo email ${doc._id}\n`);
  check('correlationId', !!job.correlationId);
  check('source', job.source === 'OUTLOOK');
  check('mailbox', !!job.mailbox);
  check('email.messageId', !!job.email.messageId);
  check('email.conversationId', job.email.conversationId !== undefined);
  check('email.from.address', job.email.from.address !== undefined);
  check('email.to[]', Array.isArray(job.email.to));
  check('email.subject', job.email.subject !== undefined);
  check('email.bodyText', typeof job.email.bodyText === 'string');
  check('email.receivedDateTime', !!job.email.receivedDateTime);
  check('attachments[].name', job.attachments.every((a) => a.name !== undefined));
  check('attachments[].contentType', job.attachments.every((a) => a.contentType !== undefined));
  check('attachments[].size', job.attachments.every((a) => a.size !== undefined));
  check(
    'attachments[].downloadUrl (SAS resolvable)',
    job.attachments.length === 0 || job.attachments.every((a) => !!a.downloadUrl),
  );
  check('candidateProjects[]', Array.isArray(job.candidateProjects));

  console.log('\n--- sample job (truncated) ---');
  console.log(
    JSON.stringify(
      {
        ...job,
        email: { ...job.email, bodyText: (job.email.bodyText || '').slice(0, 40) + '…' },
        attachments: job.attachments.map((a) => ({
          ...a,
          downloadUrl: a.downloadUrl ? a.downloadUrl.slice(0, 80) + '…' : null,
        })),
        candidateProjects: job.candidateProjects.slice(0, 2),
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
