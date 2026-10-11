import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { TeamsMonitoredChannel } from '@db/models/teams-monitored-channel.model';
import { TeamsMeeting } from '@db/models/teams-meeting.model';

// One-off DEV helper: seeds dummy AI summaries so the "Chat Summary" and
// "Meeting Summaries" sections render without the AI worker/queue round-trip.
//   npx ts-node -r tsconfig-paths/register src/scripts/teams-seed-ai-summaries.ts <projectId>
// Re-runnable and reversible (pass --clear to null everything out again).

const projectId = process.argv[2] || '6a4be357f1c2b0f94f8a5dc8';
const clear = process.argv.includes('--clear');

const now = new Date();

const chatSummary = {
  summary:
    'Client is planning a walkable glass staircase for the California site and wants a quote. ' +
    'Team is collecting stair diagrams and confirming the load rating before pricing.',
  keyPoints: [
    'Walkable tempered-glass staircase requested',
    'Awaiting stair diagrams from the client',
    'Load rating must be confirmed before quoting',
  ],
  requirements: [
    'Client to share staircase diagrams',
    'Structural load rating to be verified',
  ],
  confidence: 0.82,
  updatedAt: now,
};

// A few distinct meeting summaries; cycled across however many meetings exist so
// each card looks different.
const meetingSummaries = [
  {
    summary:
      'Kickoff discussion on the glass staircase scope. Client walked through the layout and ' +
      'agreed tempered glass with an anti-slip finish.',
    keyPoints: ['Tempered glass with anti-slip finish', 'Client to send diagrams'],
    requirements: ['Confirm tread dimensions'],
    confidence: 0.78,
    updatedAt: now,
  },
  {
    summary:
      'Follow-up on materials and pricing. Reviewed load rating expectations and timeline for the quote.',
    keyPoints: ['Load rating ~400 kg/m² target', 'Quote expected next week'],
    requirements: ['Structural sign-off before quote'],
    confidence: 0.71,
    updatedAt: now,
  },
  {
    summary: 'Short sync to confirm site measurements and access for installation.',
    keyPoints: ['Site measurements confirmed', 'Install access via rear entrance'],
    requirements: [],
    confidence: 0.65,
    updatedAt: now,
  },
];

const main = async (): Promise<void> => {
  if (!mongoose.isValidObjectId(projectId)) {
    console.error(`Invalid projectId: ${projectId}`);
    process.exit(1);
  }
  await connectDB();
  const oid = new mongoose.Types.ObjectId(projectId);

  const channels = await TeamsMonitoredChannel.find({
    $or: [{ projectIds: oid }, { projectId: oid }],
  });
  if (channels.length === 0) {
    console.error(`No monitored channels linked to project ${projectId}.`);
    process.exit(1);
  }
  const channelIds = [...new Set(channels.map((c) => c.channelId))];
  const meetings = await TeamsMeeting.find({ channelId: { $in: channelIds } }).sort({
    startDateTime: -1,
  });

  if (clear) {
    await TeamsMonitoredChannel.updateMany(
      { _id: { $in: channels.map((c) => c._id) } },
      { aiChatSummary: null },
    );
    await TeamsMeeting.updateMany(
      { _id: { $in: meetings.map((m) => m._id) } },
      { aiSummary: null },
    );
    console.log(`Cleared summaries on ${channels.length} channel(s) and ${meetings.length} meeting(s).`);
    await mongoose.disconnect();
    return;
  }

  // Chat summary → the channel(s).
  await TeamsMonitoredChannel.updateMany(
    { _id: { $in: channels.map((c) => c._id) } },
    { aiChatSummary: chatSummary },
  );
  console.log(`Set chat summary on ${channels.length} channel(s): ${channelIds.join(', ')}`);

  // Distinct meeting summary → each meeting.
  let i = 0;
  for (const m of meetings) {
    const summary = meetingSummaries[i % meetingSummaries.length];
    await TeamsMeeting.updateOne({ _id: m._id }, { aiSummary: summary });
    console.log(`  meeting ${m._id.toString()} "${m.subject ?? 'Untitled'}" → summary set`);
    i += 1;
  }
  if (meetings.length === 0) {
    console.log('No meetings found for these channels — only the chat summary was seeded.');
  }

  console.log('\nDone. Refresh the Project Workspace → Teams tab to see the summaries.');
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
