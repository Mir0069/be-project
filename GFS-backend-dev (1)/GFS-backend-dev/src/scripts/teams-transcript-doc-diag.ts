import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { DocumentModel } from '@db/models/document.model';
import { TeamsTranscript } from '@db/models/teams-transcript.model';
import { TeamsMonitoredChannel } from '@db/models/teams-monitored-channel.model';

const PROJECT_ID = process.argv[2] ?? '6a4bdaf6f1c2b0f94f8a5d83';

(async () => {
  await connectDB();

  console.log(`\n=== PROJECT ${PROJECT_ID} ===\n`);

  // 1. Which monitored channels reference this project, and is it primary?
  const channels = await TeamsMonitoredChannel.find({
    $or: [{ projectIds: PROJECT_ID }, { projectId: PROJECT_ID }],
  }).lean();
  console.log(`MONITORED CHANNELS touching this project: ${channels.length}`);
  for (const c of channels as any[]) {
    const ids = c.projectIds ?? (c.projectId ? [c.projectId] : []);
    console.log(
      `  channelId=${c.channelId}  name="${c.channelName}"  projectIds=${JSON.stringify(ids)}  primary?=${String(ids[0]) === PROJECT_ID}`,
    );
  }
  const channelIds = [...new Set((channels as any[]).map((c) => c.channelId))];

  // 2. Transcript records tied to those channels / this project
  const transcripts = await TeamsTranscript.find({
    $or: [
      { projectId: PROJECT_ID },
      ...(channelIds.length ? [{ channelId: { $in: channelIds } }] : []),
    ],
  }).lean();
  console.log(`\nTEAMS_TRANSCRIPT records: ${transcripts.length}`);
  for (const t of transcripts as any[]) {
    console.log(
      `  transcriptId=${t.transcriptId}  subject="${t.meetingSubject}"  projectId=${t.projectId}  routedToPipeline=${t.routedToPipeline}  channelId=${t.channelId ?? 'null'}  bytes=${t.byteSize}`,
    );
  }

  // 3. Any pipeline documents that are transcripts (by metadata.transcriptId or name)
  const transcriptDocs = await DocumentModel.find({
    $or: [
      { 'metadata.transcriptId': { $exists: true } },
      { originalName: { $regex: /^transcript-/ } },
    ],
  }).lean();
  console.log(`\nDOCUMENT records that look like transcripts: ${transcriptDocs.length}`);
  for (const d of transcriptDocs as any[]) {
    const md = d.metadata instanceof Map ? Object.fromEntries(d.metadata) : d.metadata ?? {};
    console.log(
      `  name="${d.originalName}"  projectId=${d.projectId}  isActive=${d.isActive}  md.channelId=${md.channelId ?? 'MISSING'}  md.source=${md.source}  md.transcriptId=${md.transcriptId ?? '-'}`,
    );
  }

  // 4. What listByTeamsChannelIds would return for this project's channels
  if (channelIds.length) {
    const shared = await DocumentModel.find({
      'metadata.source': 'teams',
      'metadata.channelId': { $in: channelIds },
      'metadata.kind': { $ne: 'channel-message' },
      isActive: true,
    }).lean();
    const transcriptShared = (shared as any[]).filter((d) => {
      const md = d.metadata instanceof Map ? Object.fromEntries(d.metadata) : d.metadata ?? {};
      return md.transcriptId || String(d.originalName).startsWith('transcript-');
    });
    console.log(
      `\nlistByTeamsChannelIds(shared union) would return ${shared.length} docs; of which transcripts: ${transcriptShared.length}`,
    );
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
