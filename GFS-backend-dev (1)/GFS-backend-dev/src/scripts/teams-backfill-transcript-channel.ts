/**
 * Backfill `metadata.channelId` (+teamId) onto already-staged Teams transcript
 * documents. These were ingested before the transcript upload stamped the
 * channel, so they only appear in the PRIMARY project's Documents tab and are
 * invisible to other projects the channel is shared with. Stamping the channel
 * lets `listByTeamsChannelIds` surface them everywhere the channel is linked.
 *
 * Idempotent + additive: only sets channelId/teamId when currently missing.
 *
 *   dry-run (default):  npx ts-node ... src/scripts/teams-backfill-transcript-channel.ts
 *   apply:              npx ts-node ... src/scripts/teams-backfill-transcript-channel.ts --apply
 */
import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { DocumentModel } from '@db/models/document.model';
import { TeamsTranscript } from '@db/models/teams-transcript.model';

const APPLY = process.argv.includes('--apply');

const mdOf = (d: any): any =>
  d.metadata instanceof Map ? Object.fromEntries(d.metadata) : d.metadata ?? {};

(async () => {
  await connectDB();

  const docs = await DocumentModel.find({
    'metadata.source': 'teams',
    'metadata.transcriptId': { $exists: true },
  }).lean();

  console.log(`\nTranscript documents found: ${docs.length}  (mode: ${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);

  let patched = 0;
  let skipped = 0;
  for (const d of docs as any[]) {
    const md = mdOf(d);
    if (md.channelId) {
      skipped++;
      continue;
    }
    const transcript = await TeamsTranscript.findOne({ transcriptId: md.transcriptId }).lean<any>();
    if (!transcript?.channelId) {
      console.log(`  SKIP (no channel on transcript)  doc=${d._id}  name="${d.originalName}"`);
      skipped++;
      continue;
    }

    const set: Record<string, string> = { 'metadata.channelId': transcript.channelId };
    if (transcript.teamId) set['metadata.teamId'] = transcript.teamId;

    console.log(
      `  ${APPLY ? 'PATCH' : 'WOULD PATCH'}  doc=${d._id}  proj=${d.projectId}  name="${d.originalName}"  -> channelId=${transcript.channelId}`,
    );
    if (APPLY) {
      await DocumentModel.updateOne({ _id: d._id }, { $set: set }).exec();
    }
    patched++;
  }

  console.log(`\nDone. ${APPLY ? 'patched' : 'would patch'}=${patched}  skipped=${skipped}\n`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
