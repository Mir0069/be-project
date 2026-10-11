import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { MailFirstService } from '@features/mail-first/mail-first.service';
import { zohoTokenRepository, projectRepository } from '@repositories/index';
import { projectCreationService } from '@features/project-creation/project-creation.router';
import { ZohoService } from '@features/zoho/zoho.service';
import { ZohoSyncService } from '@features/zoho/zoho-sync.service';
import { ZohoProjectService } from '@features/zoho/zoho-project.service';
import { blobStorage } from '@features/document-ingestion/document-ingestion.router';

/**
 * Local test for the mail-first backend fixes (no live Zoho, no blob side effects):
 *   1. The AI's address/jobAddress now PERSISTS on the draft (schema fix).
 *   2. buildLeadPayload maps that address into the Zoho `Street` field and no
 *      longer writes a Description.
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/mail-first-fields-test.ts
 */
const main = async (): Promise<void> => {
  await connectDB();
  const stamp = Date.now();
  const ADDRESS = '101 robinson st';
  let emailId: mongoose.Types.ObjectId | null = null;

  try {
    // ── Fix #1: schema must persist proposed.address / proposed.jobAddress ─────
    const draft = await OutlookEmail.create({
      messageId: `mf-fields-${stamp}`,
      mailboxUserId: 'mf-fields-test',
      receivedDateTime: new Date(),
      fromName: 'Robin Contractor',
      fromAddress: `robin+${stamp}@example.com`,
      subject: '101 robinson',
      bodyText: 'need a deck 18x18',
      status: 'DRAFT',
      proposed: {
        isProject: true,
        customerName: 'Robin',
        projectName: '101 robinson',
        projectType: 'NEW_ESTIMATE',
        confidence: 0.9,
        address: ADDRESS,
        jobAddress: ADDRESS,
      },
    });
    emailId = draft._id as mongoose.Types.ObjectId;

    const reloaded = await OutlookEmail.findById(draft.id).lean();
    const savedAddr = reloaded?.proposed?.address ?? null;
    const savedJob = reloaded?.proposed?.jobAddress ?? null;
    console.log('1) SCHEMA — persisted proposed.address    =', savedAddr);
    console.log('   SCHEMA — persisted proposed.jobAddress =', savedJob);
    const schemaPass = savedAddr === ADDRESS && savedJob === ADDRESS;
    console.log(`   → ${schemaPass ? 'PASS ✅ (before fix these were stripped by Mongoose)' : 'FAIL ❌'}\n`);

    // ── Fix #2: buildLeadPayload → Street set, Description absent ──────────────
    const zoho = new ZohoService(zohoTokenRepository);
    const sync = new ZohoSyncService(zoho, new ZohoProjectService(projectCreationService, projectRepository));
    const mailFirst = new MailFirstService(zoho, sync, blobStorage);

    const payload = (mailFirst as any).buildLeadPayload(reloaded);
    console.log('2) LEAD PAYLOAD sent to Zoho:');
    console.log(JSON.stringify(payload, null, 2));
    const streetPass = payload['Street'] === ADDRESS;
    const noDescription = !('Description' in payload);
    console.log(`   → Street = address?      ${streetPass ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`   → Description removed?    ${noDescription ? 'PASS ✅' : 'FAIL ❌'}`);

    console.log('\nNote: createProjectFromLead then names the project after lead.street');
    console.log(`      → project would be named "${ADDRESS}" with address.street = "${ADDRESS}".`);

    console.log(`\nRESULT: ${schemaPass && streetPass && noDescription ? 'ALL PASS ✅' : 'FAIL ❌'}`);
  } catch (err) {
    console.error('\nERROR:', err instanceof Error ? err.message : err);
  } finally {
    if (emailId) await OutlookEmail.deleteOne({ _id: emailId });
    console.log('\nCleaned up test email.');
    await mongoose.disconnect();
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('mail-first-fields-test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
