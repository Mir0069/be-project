import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphChannel, GraphList, GraphTeam } from '@features/teams/teams.types';

/**
 * READ-ONLY: dumps the raw eventDetail + attachments of every message in ONE
 * channel that looks meeting-related, so we can see the exact shape to build
 * scheduled-meeting discovery against.
 *   TEAMS_CHANNEL="61 heaven view, texas" npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-meeting-shape.ts
 */
const main = async (): Promise<void> => {
  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  const wantChannel = process.env['TEAMS_CHANNEL'] ?? '61 heaven view, texas';
  const teams = await graph.getAllPages<GraphTeam>('/teams');
  let target: { teamId: string; channelId: string } | null = null;
  for (const t of teams) {
    const channels = await graph.getAllPages<GraphChannel>(`/teams/${t.id}/channels`);
    const ch = channels.find((c) => c.displayName?.includes(wantChannel.split(',')[0].trim()));
    if (ch) {
      target = { teamId: t.id, channelId: ch.id };
      break;
    }
  }
  if (!target) {
    console.error(`Channel matching "${wantChannel}" not found`);
    process.exit(1);
  }

  const msgs = await graph.get<GraphList<any>>(
    `/teams/${target.teamId}/channels/${target.channelId}/messages`,
    { $top: '50' },
  );

  for (const m of msgs.value ?? []) {
    const hasEvent = !!m.eventDetail;
    const meetingAtt = (m.attachments ?? []).filter(
      (a: any) =>
        (a.contentType ?? '').toLowerCase().includes('meeting') ||
        (a.contentType ?? '').toLowerCase().includes('reference'),
    );
    if (!hasEvent && meetingAtt.length === 0) continue;

    console.log('\n========================================');
    console.log(`messageId: ${m.id}  type=${m.messageType}  created=${m.createdDateTime}`);
    console.log(`subject: ${m.subject ?? '(none)'}`);
    if (hasEvent) console.log('eventDetail:', JSON.stringify(m.eventDetail, null, 2));
    if (meetingAtt.length) console.log('meeting attachments:', JSON.stringify(meetingAtt, null, 2));
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('shape dump failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
