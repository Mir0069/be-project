import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type {
  GraphChannel,
  GraphChannelMessage,
  GraphList,
  GraphTeam,
} from '@features/teams/teams.types';

/**
 * READ-ONLY analysis of ONE channel: counts messages (text vs system/meeting
 * events, with senders), lists documents + recordings, and the distinct
 * meetings. App-only (no login).
 *   TEAMS_CHANNEL="jemu testing one" npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-channel-analyze.ts
 */
interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
}

const stripHtml = (h?: string | null): string =>
  (h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const main = async (): Promise<void> => {
  const channelFilter = (process.env['TEAMS_CHANNEL'] ?? 'jemu testing one').toLowerCase();

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

  // Locate the channel.
  const teams = await graph.getAllPages<GraphTeam>('/teams');
  let team: GraphTeam | undefined;
  let channel: GraphChannel | undefined;
  for (const t of teams) {
    const chs = await graph.getAllPages<GraphChannel>(`/teams/${t.id}/channels`);
    const hit = chs.find((c) => c.displayName.toLowerCase().includes(channelFilter));
    if (hit) {
      team = t;
      channel = hit;
      break;
    }
  }
  if (!team || !channel) {
    console.error(`Channel matching "${channelFilter}" not found.`);
    process.exit(1);
  }
  console.log(`\n=== Analyzing: ${team.displayName} / ${channel.displayName} ===\n`);

  // ---- Messages (root + replies) ----
  const roots = await graph.getAllPages<GraphChannelMessage>(
    `/teams/${team.id}/channels/${channel.id}/messages`,
    { $top: '50' },
  );
  let textCount = 0;
  let systemCount = 0;
  let meetingEvents = 0;
  let replyCount = 0;
  const senders = new Map<string, number>();
  const tally = (m: GraphChannelMessage): void => {
    if (m.eventDetail) {
      meetingEvents += 1;
    }
    const isSystem = m.messageType && m.messageType !== 'message';
    if (isSystem) {
      systemCount += 1;
      return;
    }
    const text = stripHtml(m.body?.content);
    if (!text) return;
    textCount += 1;
    const who = m.from?.user?.displayName ?? '(unknown)';
    senders.set(who, (senders.get(who) ?? 0) + 1);
  };
  for (const r of roots) {
    tally(r);
    const replies = await graph.getAllPages<GraphChannelMessage>(
      `/teams/${team.id}/channels/${channel.id}/messages/${r.id}/replies`,
      { $top: '50' },
    );
    for (const rep of replies) {
      replyCount += 1;
      tally(rep);
    }
  }

  console.log('--- MESSAGES ---');
  console.log(`  root messages: ${roots.length}`);
  console.log(`  replies: ${replyCount}`);
  console.log(`  text messages (real chat): ${textCount}`);
  console.log(`  system/event messages: ${systemCount}`);
  console.log(`  meeting-related events (scheduled/started/ended): ${meetingEvents}`);
  console.log('  senders:');
  for (const [who, n] of senders) console.log(`     - ${who}: ${n}`);

  // ---- Documents + recordings (channel SharePoint) ----
  let docs = 0;
  let recordings = 0;
  const meetingNames = new Set<string>();
  const docNames: string[] = [];
  try {
    const folder = await graph.get<DriveItem>(
      `/teams/${team.id}/channels/${channel.id}/filesFolder`,
    );
    const driveId = folder.parentReference?.driveId ?? '';
    const top = await graph.get<GraphList<DriveItem>>(
      `/drives/${driveId}/items/${folder.id}/children`,
      { $top: '200' },
    );
    for (const it of top.value ?? []) {
      if (it.folder && (it.name ?? '').toLowerCase() === 'recordings') {
        const recs = await graph.get<GraphList<DriveItem>>(
          `/drives/${driveId}/items/${it.id}/children`,
          { $top: '200' },
        );
        for (const rec of recs.value ?? []) {
          if (/\.(mp4|webm)$/i.test(rec.name ?? '')) {
            recordings += 1;
            // distinct meeting = name before the -YYYYMMDD_ timestamp
            const base = (rec.name ?? '').replace(/-\d{8}[_T].*$/i, '').replace(/-\d{8}UTC.*$/i, '').trim();
            meetingNames.add(base);
          }
        }
      } else if (!it.folder) {
        docs += 1;
        docNames.push(it.name ?? '?');
      }
    }
  } catch (err) {
    console.log(`  (files read failed: ${(err as { message?: string }).message})`);
  }

  console.log('\n--- DOCUMENTS (channel Files, excl. Recordings) ---');
  console.log(`  documents: ${docs}`);
  for (const n of docNames) console.log(`     - ${n}`);

  console.log('\n--- MEETINGS ---');
  console.log(`  recordings (total sessions recorded): ${recordings}`);
  console.log(`  distinct meetings (by name): ${meetingNames.size}`);
  for (const n of meetingNames) console.log(`     - ${n}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('analyze failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
