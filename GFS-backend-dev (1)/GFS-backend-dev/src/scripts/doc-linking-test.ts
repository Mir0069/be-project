import mongoose from 'mongoose';
import crypto from 'crypto';

import { connectDB } from '@db/connection';
import { Project, ProjectType } from '@db/models/project.model';
import { DocumentModel } from '@db/models/document.model';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { documentRepository } from '@repositories/index';

/**
 * Manual test for the mail-first DOCUMENT-LINKING fix — bypasses the (broken) AI
 * classifier and the live-Zoho approve path. It reproduces the exact state the
 * poller leaves behind (a STAGING Document + an OutlookEmail whose attachment
 * carries the same storageKey), runs the linking step approveDraft() now runs,
 * then reads the documents back through the SAME query the UI Documents tab uses
 * (documentRepository.listByProject).
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/doc-linking-test.ts
 */
const main = async (): Promise<void> => {
  await connectDB();

  const stamp = Date.now();
  const storageKey = `staging/doc-linking-test/${stamp}/lead-sheet.pdf`;
  let projectId: string | null = null;
  let docId: mongoose.Types.ObjectId | null = null;
  let emailId: mongoose.Types.ObjectId | null = null;

  try {
    // 0) Prove the OLD bug: the model name the buggy code used does not exist.
    try {
      mongoose.model('DocumentRecord');
      console.log("0) mongoose.model('DocumentRecord') resolved (unexpected)");
    } catch (err) {
      console.log(`0) OLD BUG confirmed → mongoose.model('DocumentRecord') throws: ${(err as Error).name}`);
    }
    console.log(`   correct model is 'Document' → collection '${DocumentModel.collection.name}'\n`);

    // 1) Create a throwaway project (what the Zoho webhook would have created).
    const project = await Project.create({
      referenceNumber: `PRJ-TEST-${stamp}`,
      projectName: `Doc Linking Test ${stamp}`,
      customerName: 'Doc Linking Test',
      projectType: ProjectType.NEW_ESTIMATE,
    });
    projectId = project.id;
    console.log(`1) Created project ${project.referenceNumber} (_id=${projectId})`);

    // 2) Stage a Document exactly like the poller does for an email attachment:
    //    projectId=null, status=STAGING, isActive=true (default), a real storageKey.
    const doc = await DocumentModel.create({
      projectId: null,
      rootDocumentId: `root-${stamp}`,
      version: 1,
      isLatest: true,
      isActive: true,
      documentType: 'other',
      status: 'STAGING',
      originalName: 'Sabine El Hachem Lead Sheet.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      storageKey,
      blobUrl: `https://blob.example/${storageKey}`,
      sha256: crypto.createHash('sha256').update(storageKey).digest('hex'),
      byteSize: 768000,
      uploadedBy: 'doc-linking-test',
    });
    docId = doc._id as mongoose.Types.ObjectId;
    console.log(`2) Staged Document _id=${docId} status=STAGING projectId=null storageKey=${storageKey}`);

    // 3) Create a DRAFT email whose attachment references the same storageKey.
    const email = await OutlookEmail.create({
      messageId: `doc-linking-test-${stamp}`,
      mailboxUserId: 'doc-linking-test',
      receivedDateTime: new Date(),
      fromName: 'Robin Contractor',
      fromAddress: `robin+${stamp}@example.com`,
      subject: '101 robinson st',
      bodyText: 'we looking for deck in balcony',
      status: 'DRAFT',
      attachments: [{ id: `att-${stamp}`, name: 'Sabine El Hachem Lead Sheet.pdf', storageKey, blobUrl: doc.blobUrl }],
      proposed: { isProject: true, projectType: 'NEW_ESTIMATE', confidence: 0.9 },
    });
    emailId = email._id as mongoose.Types.ObjectId;

    // 4) BEFORE linking: the UI query returns nothing (projectId still null on the doc).
    const before = await documentRepository.listByProject(projectId);
    console.log(`3) UI query BEFORE linking → listByProject('${projectId}') = ${before.length} document(s)`);

    // 5) Run the exact linking step approveDraft() now performs (with the FIXED model name).
    const storageKeys = (email.attachments || []).map((a: any) => a.storageKey).filter(Boolean);
    const res = await mongoose.model('Document').updateMany(
      { storageKey: { $in: storageKeys } },
      { $set: { projectId: new mongoose.Types.ObjectId(projectId), status: 'PROCESSED', isActive: true } }
    );
    console.log(`4) Linking updateMany → matched=${res.matchedCount} modified=${res.modifiedCount}`);

    // 6) AFTER linking: the SAME UI query now returns the document.
    const after = await documentRepository.listByProject(projectId);
    console.log(`5) UI query AFTER linking → listByProject('${projectId}') = ${after.length} document(s)`);
    after.forEach(d => console.log(`      • ${d.originalName} (status=${d.status})`));

    console.log(`\nRESULT: ${before.length === 0 && after.length === 1 ? 'PASS ✅ document now visible in the project' : 'FAIL ❌'}`);
  } catch (err) {
    console.error('\nERROR during test:', err instanceof Error ? err.message : err);
  } finally {
    // Clean up all test data.
    if (docId) await DocumentModel.deleteOne({ _id: docId });
    if (emailId) await OutlookEmail.deleteOne({ _id: emailId });
    if (projectId) await Project.deleteOne({ _id: projectId });
    console.log('\nCleaned up test project / document / email.');
    await mongoose.disconnect();
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('doc-linking-test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
