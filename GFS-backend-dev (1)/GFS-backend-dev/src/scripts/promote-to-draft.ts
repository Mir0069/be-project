import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { OutlookEmail } from '@db/models/outlook-email.model';

/**
 * Manually promote a PENDING email to DRAFT so it appears in the Drafts list,
 * bypassing ONLY the (broken) AI classifier. This lets us exercise the real
 * "Approve & Create Project" flow (Zoho lead + project + document linking) with
 * a real staged attachment.
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/promote-to-draft.ts "98 robinson"
 */
const main = async (): Promise<void> => {
  await connectDB();
  const subjectQuery = process.argv[2] || '98 robinson';

  const email = await OutlookEmail.findOne({
    subject: { $regex: subjectQuery, $options: 'i' },
    status: 'PENDING',
  }).sort({ createdAt: -1 });

  if (!email) {
    console.log(`No PENDING email found matching "${subjectQuery}".`);
    await mongoose.disconnect();
    process.exit(0);
  }

  await OutlookEmail.updateOne(
    { _id: email._id },
    {
      $set: {
        status: 'DRAFT',
        proposed: {
          isProject: true,
          customerName: email.fromName || '98 robinson',
          projectName: email.subject || '98 robinson',
          projectType: 'NEW_ESTIMATE',
          summary: email.bodyText || 'Deck request',
          confidence: 0.9,
        },
      },
    }
  );

  console.log(`Promoted email _id=${email._id} (subject="${email.subject}") to DRAFT.`);
  console.log('It should now appear in the Drafts list. Approve it from the UI and check the Documents tab.');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('promote-to-draft failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
