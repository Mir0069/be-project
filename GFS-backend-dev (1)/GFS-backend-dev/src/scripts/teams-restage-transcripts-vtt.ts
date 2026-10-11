/**
 * Re-stage already-ingested Teams transcript documents from plain-text ".txt"
 * to real ".vtt" files, so the Documents tab shows the same VTT artifact the
 * Meetings view serves. Re-uploads the raw VTT (from the linked TeamsTranscript)
 * to blob and updates the document record (name/extension/mime/storageKey/
 * blobUrl/sha256/byteSize). Deletes the superseded .txt blob (best-effort).
 *
 * Idempotent: skips documents already stored as .vtt.
 *
 *   dry-run (default):  npx ts-node ... src/scripts/teams-restage-transcripts-vtt.ts
 *   apply:              npx ts-node ... src/scripts/teams-restage-transcripts-vtt.ts --apply
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { DocumentModel } from '@db/models/document.model';
import { TeamsTranscript } from '@db/models/teams-transcript.model';
import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';

const APPLY = process.argv.includes('--apply');

const blobStorage = new AzureContentAddressedBlobStorage({
  connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
  containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
});

const mdOf = (d: any): any =>
  d.metadata instanceof Map ? Object.fromEntries(d.metadata) : d.metadata ?? {};

// Mirrors the naming in TeamsTranscriptsService.maybeRouteToPipeline.
const vttName = (subject: string | null, meetingId: string, transcriptId: string): string => {
  const slug =
    (subject ?? meetingId).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'meeting';
  const shortId = crypto.createHash('sha256').update(transcriptId).digest('hex').slice(0, 8);
  return `${slug}-transcript-${shortId}.vtt`;
};

(async () => {
  await connectDB();

  const docs = await DocumentModel.find({
    'metadata.source': 'teams',
    'metadata.transcriptId': { $exists: true },
  }).exec();

  console.log(`\nTranscript documents: ${docs.length}  (mode: ${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);

  let restaged = 0;
  let skipped = 0;
  for (const doc of docs) {
    const d: any = doc;
    if (d.extension === '.vtt') {
      skipped++;
      continue;
    }
    const md = mdOf(d);
    const transcript = await TeamsTranscript.findOne({ transcriptId: md.transcriptId }).lean<any>();
    if (!transcript?.contentVtt) {
      console.log(`  SKIP (no VTT on transcript)  doc=${d._id}  name="${d.originalName}"`);
      skipped++;
      continue;
    }

    const projectId = d.projectId ? d.projectId.toString() : null;
    if (!projectId) {
      console.log(`  SKIP (no projectId)  doc=${d._id}  name="${d.originalName}"`);
      skipped++;
      continue;
    }

    const buffer = Buffer.from(transcript.contentVtt, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const originalName = vttName(transcript.meetingSubject ?? null, transcript.meetingId, transcript.transcriptId);
    const oldStorageKey: string = d.storageKey;

    console.log(
      `  ${APPLY ? 'RESTAGE' : 'WOULD RESTAGE'}  doc=${d._id}  proj=${projectId}  "${d.originalName}" -> "${originalName}"  (${buffer.length} B)`,
    );

    if (APPLY) {
      const stored = await blobStorage.put({
        projectId,
        sha256,
        originalName,
        mimeType: 'text/vtt',
        buffer,
      });
      d.originalName = originalName;
      d.extension = '.vtt';
      d.mimeType = 'text/vtt';
      d.storageKey = stored.storageKey;
      d.blobUrl = stored.blobUrl;
      d.sha256 = sha256;
      d.byteSize = stored.byteSize;
      d.updatedAt = new Date();
      await d.save();

      if (oldStorageKey && oldStorageKey !== stored.storageKey) {
        try {
          await blobStorage.delete(oldStorageKey);
        } catch {
          /* best-effort */
        }
      }
    }
    restaged++;
  }

  console.log(`\nDone. ${APPLY ? 'restaged' : 'would restage'}=${restaged}  skipped=${skipped}\n`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
