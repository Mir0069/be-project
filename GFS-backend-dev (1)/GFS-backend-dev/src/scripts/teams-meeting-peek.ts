import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { TeamsMeeting } from '@db/models/teams-meeting.model';

(async () => {
  await connectDB();
  const docs = await TeamsMeeting.find({}).sort({ updatedAt: -1 }).lean();
  console.log(`\nMEETINGS: ${docs.length}\n`);
  for (const d of docs as any[]) {
    console.log(`  subject="${d.subject}"  channel=${d.channelId}  meetingId=${d.meetingId ?? 'null'}  hasTranscript=${d.hasTranscript}  docs=${d.documentCount}  msgs=${d.messageCount}  project=${d.projectId}`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
