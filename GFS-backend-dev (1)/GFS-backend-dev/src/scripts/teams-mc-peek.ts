import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { TeamsMonitoredChannel } from '@db/models/teams-monitored-channel.model';

(async () => {
  await connectDB();
  const docs = await TeamsMonitoredChannel.find({}).sort({ updatedAt: -1 }).lean();
  console.log(`\nMONITORED CHANNELS: ${docs.length}\n`);
  for (const d of docs) {
    console.log(
      `isActive=${d.isActive}  team="${d.teamName}"  channel="${d.channelName}"  ` +
        `projectId=${d.projectId ?? 'null'}  channelId=${d.channelId}  _id=${d._id}`,
    );
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
