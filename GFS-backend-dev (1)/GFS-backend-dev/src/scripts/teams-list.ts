import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphChannel, GraphTeam } from '@features/teams/teams.types';

/**
 * READ-ONLY: lists every Team and its Channels (app-only, no login).
 * Run: npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-list.ts
 */
const main = async (): Promise<void> => {
  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  if (!tokenService.isConfigured()) {
    console.error('TEAMS creds missing in .env');
    process.exit(1);
  }
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  const teams = await graph.getAllPages<GraphTeam>('/teams');
  let totalChannels = 0;
  console.log(`\nTEAMS FOUND: ${teams.length}\n`);
  for (const [i, team] of teams.entries()) {
    const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);
    totalChannels += channels.length;
    console.log(`${i + 1}. TEAM: ${team.displayName}   (id: ${team.id})`);
    console.log(`   channels: ${channels.length}`);
    for (const ch of channels) {
      console.log(`      • ${ch.displayName}   (id: ${ch.id})`);
    }
    console.log('');
  }
  console.log(`TOTAL: ${teams.length} team(s), ${totalChannels} channel(s).`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-list failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
