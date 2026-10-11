import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { DocumentModel } from '@db/models/document.model';
import { Project } from '@db/models/project.model';
import { documentRepository } from '@repositories/index';

/**
 * READ-ONLY diagnostic for the mail-first document-linking flow.
 * Point it at a draft/email by subject substring and it shows, end-to-end,
 * whether that email's attachments made it into the project's Documents tab.
 *
 * Run (default subject match = "robinson"):
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/doc-linking-inspect.ts "98 robinson"
 */
const main = async (): Promise<void> => {
  await connectDB();
  const subjectQuery = process.argv[2] || 'robinson';

  const email = await OutlookEmail.findOne({ subject: { $regex: subjectQuery, $options: 'i' } })
    .sort({ createdAt: -1 })
    .lean();

  if (!email) {
    console.log(`No OutlookEmail found with subject matching "${subjectQuery}".`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('=== EMAIL ===');
  console.log(`  subject:     ${email.subject}`);
  console.log(`  status:      ${email.status}`);
  console.log(`  linkMethod:  ${(email as any).linkMethod ?? '(none)'}`);
  console.log(`  projectId:   ${email.projectId ?? '(none)'}`);
  const atts = email.attachments || [];
  console.log(`  attachments: ${atts.length}`);
  atts.forEach((a: any, i) => console.log(`    [${i}] name=${a.name} storageKey=${a.storageKey ?? '(NULL)'}`));

  if (atts.length === 0) {
    console.log('\n⚠️  Email has NO attachments → nothing to link. (Attachment was not staged by the poller.)');
  }

  // For each attachment storageKey, find the staged Document(s).
  const storageKeys = atts.map((a: any) => a.storageKey).filter(Boolean);
  if (storageKeys.length > 0) {
    console.log('\n=== DOCUMENTS matching those storageKeys ===');
    const docs = await DocumentModel.find({ storageKey: { $in: storageKeys } }).lean();
    if (docs.length === 0) {
      console.log('  ⚠️  NONE found → attachment blobs were never turned into Document records.');
    }
    docs.forEach(d => console.log(
      `  • ${d.originalName} | status=${d.status} | isActive=${d.isActive} | projectId=${d.projectId ?? '(NULL — not linked)'}`
    ));
  }

  // What the UI Documents tab would actually show for this project.
  if (email.projectId) {
    const projectId = String(email.projectId);
    const project = await Project.findById(projectId).lean();
    console.log('\n=== PROJECT ===');
    console.log(`  ${project?.referenceNumber} — ${project?.projectName}`);
    const visible = await documentRepository.listByProject(projectId);
    console.log(`\n=== UI Documents tab (listByProject) → ${visible.length} document(s) ===`);
    visible.forEach(d => console.log(`  • ${d.originalName} (status=${d.status})`));
    console.log(`\nVERDICT: ${visible.length > 0 ? 'documents ARE visible ✅' : 'NO documents visible ❌'}`);
  } else {
    console.log('\nEmail has no projectId yet → not approved/linked, so the project would show no docs.');
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('doc-linking-inspect failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
