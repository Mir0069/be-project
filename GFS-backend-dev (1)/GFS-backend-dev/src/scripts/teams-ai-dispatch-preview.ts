/**
 * Print the REAL Teams → AI payload for a channel/project from live DB data,
 * WITHOUT publishing or marking anything sent. This is the concrete sample to
 * hand the AI team + a way to eyeball the shape against real records.
 *
 *   by channel db id:  npx ts-node ... src/scripts/teams-ai-dispatch-preview.ts --channelId <monitoredChannelDbId>
 *   by project id:     npx ts-node ... src/scripts/teams-ai-dispatch-preview.ts --projectId <projectId>
 * (flags avoid ts-node's reserved --project / -P option)
 */
import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import {
  documentRepository,
  teamsMessageRepository,
  teamsMeetingRepository,
  teamsMonitoredChannelRepository,
  teamsAiJobRepository,
} from '@repositories/index';
import { blobStorage } from '@features/document-ingestion/document-ingestion.router';
import { TeamsAiDispatchService } from '@features/teams/teams-ai-dispatch.service';
import type { IQueueAdapter } from '@shared/queues/queue.types';
import type { TeamsAiPayload } from '@features/teams/teams-ai.types';

const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// Preview never publishes — a no-op queue keeps the dispatcher self-contained.
const noopQueue: IQueueAdapter<TeamsAiPayload> = {
  publish: async () => undefined,
  subscribe: async () => undefined,
  close: async () => undefined,
};

(async () => {
  await connectDB();

  const channelDbId = argOf('--channelId');
  const projectId = argOf('--projectId');

  let channel = channelDbId ? await teamsMonitoredChannelRepository.findById(channelDbId) : null;
  if (!channel && projectId) {
    const channels = await teamsMonitoredChannelRepository.listByProjectId(projectId);
    channel = channels[0] ?? null;
  }
  if (!channel) {
    console.error('No channel found. Pass --channelId <monitoredChannelDbId> or --projectId <projectId>.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const dispatch = new TeamsAiDispatchService(
    noopQueue,
    blobStorage,
    documentRepository,
    teamsMessageRepository,
    teamsMeetingRepository,
    teamsAiJobRepository,
    true,
  );

  const payload = await dispatch.previewPayload(channel);
  if (!payload) {
    console.log(`\nChannel "${channel.channelName}" has no chat/meeting content to send.\n`);
  } else {
    console.log(`\n=== Teams → AI payload for channel "${channel.channelName}" (project ${channel.projectIds[0]}) ===\n`);
    console.log(JSON.stringify(payload, null, 2));
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
