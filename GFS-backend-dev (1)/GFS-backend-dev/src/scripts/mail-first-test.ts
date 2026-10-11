import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { zohoTokenRepository, projectRepository } from '@repositories/index';
import { projectCreationService } from '@features/project-creation/project-creation.router';
import { ZohoService } from '@features/zoho/zoho.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';
import { MailFirstService } from '@features/mail-first/mail-first.service';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { Project } from '@db/models/project.model';
import { blobStorage } from '@features/document-ingestion/document-ingestion.router';

/**
 * Simulate a sales-manager clicking "Yes" on a mail-first DRAFT.
 *
 * Seeds a DRAFT OutlookEmail (what the AI/processAiResult would have produced),
 * then runs the real MailFirstService.approveDraft against LIVE Zoho:
 * creates a MAIL_FIRST-tagged lead at "Need to Quote" and the project.
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/mail-first-test.ts
 */
const main = async (): Promise<void> => {
  await connectDB();

  const zoho = new ZohoService(zohoTokenRepository);
  const sync = new ZohoSyncService(zoho, new ZohoProjectService(projectCreationService, projectRepository));
  const mailFirst = new MailFirstService(zoho, sync, blobStorage);

  const stamp = Date.now();
  const draft = await OutlookEmail.create({
    messageId: `mailfirst-test-${stamp}`,
    mailboxUserId: 'mailfirst-test',
    receivedDateTime: new Date(),
    fromName: 'Test Customer',
    fromAddress: `mailfirst.test+${stamp}@example.com`,
    subject: 'Quote request — storefront glass',
    bodyText: 'We would like a quote for replacing our storefront glass panels.',
    status: 'DRAFT',
    proposed: {
      isProject: true,
      customerName: 'Mailfirst Test Co',
      projectName: 'Storefront Glass',
      projectType: 'NEW_ESTIMATE',
      summary: 'Replace storefront glass panels',
      confidence: 0.95,
    },
  });

  console.log(`Seeded DRAFT OutlookEmail _id=${draft.id} (messageId=${draft.messageId})`);
  console.log('Clicking "Yes" → approveDraft ...\n');

  const result = await mailFirst.approveDraft(draft.id);

  console.log('=========== MAIL-FIRST "YES" DONE ===========');
  console.log(`  zohoLeadId:      ${result.zohoLeadId}`);
  console.log(`  projectId:       ${result.projectId}`);
  console.log(`  alreadyProcessed:${result.alreadyProcessed}`);

  if (result.projectId) {
    const project = await Project.findById(result.projectId).lean();
    console.log('  --- project ---');
    console.log(`  referenceNumber: ${project?.referenceNumber}`);
    console.log(`  projectName:     ${project?.projectName}`);
    console.log(`  customerName:    ${project?.customerName}`);
    console.log(`  creationSource:  ${project?.creationSource}`);
    console.log(`  status:          ${project?.status}`);
  }
  console.log('=============================================');
  console.log('  Check the lead in Zoho (Lead_Status="Need to Quote", Platform_Source="MAIL_FIRST").');
  console.log('  If creationSource is ZOHO_FIRST not MAIL_FIRST, the Platform_Source custom field');
  console.log('  does not exist in this Zoho account yet, so the tag did not round-trip.\n');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('mail-first-test failed:', err instanceof Error ? err.message : err);
  if (err && typeof err === 'object' && 'details' in err) {
    console.error('details:', JSON.stringify((err as { details: unknown }).details));
  }
  process.exit(1);
});
