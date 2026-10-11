import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { teamsMonitoredChannelRepository, projectRepository } from '@repositories/index';
import { teamsService } from '@features/teams/teams.router';

/**
 * One-shot local helper: pins a Teams channel to a project (CHANNEL_MAP) and
 * runs a sync — so messages, meetings, transcripts and shared docs all land on
 * the project without relying on name-matching or authed API calls.
 *
 * Usage:
 *   MAP_PROJECT_ID=<24-char mongo id> \
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-map-and-sync.ts
 *
 * Optional overrides (defaults shown):
 *   MAP_TEAM_NAME="gfs testing team"
 *   MAP_CHANNEL_NAME="103 robinson st"
 */
const main = async (): Promise<void> => {
  const projectId = process.env['MAP_PROJECT_ID'] || process.argv[2];
  const teamName = process.env['MAP_TEAM_NAME'] || 'gfs testing team';
  const channelName = process.env['MAP_CHANNEL_NAME'] || '103 robinson st';

  if (!projectId) {
    console.error('Set MAP_PROJECT_ID=<24-char mongo project id> (from the workspace URL).');
    process.exit(1);
  }

  await connectDB();

  const project = await projectRepository.findById(projectId);
  if (!project) {
    console.error(`Project ${projectId} not found in the DB. Create it first, then copy its id.`);
    process.exit(1);
  }

  const teams = await teamsService.listTeams();
  const team = teams.find((t) => (t.displayName ?? '').toLowerCase() === teamName.toLowerCase());
  if (!team) {
    console.error(
      `Team "${teamName}" not found. Available: ${teams.map((t) => t.displayName).join(', ')}`,
    );
    process.exit(1);
  }

  const channels = await teamsService.listChannels(team.id);
  const channel = channels.find(
    (c) => (c.displayName ?? '').toLowerCase() === channelName.toLowerCase(),
  );
  if (!channel) {
    console.error(
      `Channel "${channelName}" not found in "${teamName}". Available: ${channels
        .map((c) => c.displayName)
        .join(', ')}`,
    );
    process.exit(1);
  }

  // Idempotent upsert (reactivates + repins on re-run); bypasses the webhook
  // subscription hook, which is what we want for a local test.
  const monitored = await teamsMonitoredChannelRepository.upsert({
    teamId: team.id,
    teamName: team.displayName ?? teamName,
    channelId: channel.id,
    channelName: channel.displayName ?? channelName,
    projectId,
  });
  console.log(
    `Mapped "${channel.displayName}" -> project ${projectId} (monitored id ${monitored.id})`,
  );

  const summary = await teamsService.sync(monitored.id);
  console.log(`Sync summary: ${JSON.stringify(summary, null, 2)}`);
  console.log('\nNow check:');
  console.log(`  GET /api/v1/teams/messages?projectId=${projectId}`);
  console.log(`  GET /api/v1/teams/meetings?projectId=${projectId}`);
  console.log(`  GET /api/v1/projects/${projectId}/documents`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-map-and-sync failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
