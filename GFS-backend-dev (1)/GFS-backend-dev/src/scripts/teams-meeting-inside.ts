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
 * READ-ONLY: pulls everything INSIDE one channel meeting — the in-meeting chat
 * (channel thread), documents shared during it, the recording, and reports the
 * transcript status. App-only.
 *   TEAMS_CHANNEL="jemu testing one" TEAMS_MEETING="schedule  meeting final testing" \
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-meeting-inside.ts
 */
interface MsgEx extends GraphChannelMessage {
  subject?: string | null;
}
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
  const meetingFilter = (process.env['TEAMS_MEETING'] ?? 'schedule  meeting final testing')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

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
    console.error(`Channel "${channelFilter}" not found.`);
    process.exit(1);
  }
  console.log(`\n=== Meeting "${meetingFilter}" in ${team.displayName} / ${channel.displayName} ===\n`);

  // Dump every recent thread (root + replies) so we can see where the in-meeting
  // chat + shared docs landed. Channel-meeting chat posts to the channel.
  const since = process.env['TEAMS_SINCE'] ?? '2026-06-20';
  const roots = await graph.getAllPages<MsgEx>(
    `/teams/${team.id}/channels/${channel.id}/messages`,
    { $top: '50' },
  );
  const recent = roots
    .filter((r) => (r.createdDateTime ?? '') >= since)
    .sort((a, b) => (a.createdDateTime ?? '').localeCompare(b.createdDateTime ?? ''));
  console.log(`Recent threads since ${since}: ${recent.length}\n`);
  const docsInMeeting: string[] = [];
  for (const root of recent) {
    const evt = root.eventDetail
      ? String((root.eventDetail as Record<string, unknown>)['@odata.type'] ?? '').replace(
          '#microsoft.graph.',
          '',
        )
      : '';
    const rtext = stripHtml(root.body?.content);
    const utc = (root.createdDateTime ?? '').slice(0, 16).replace('T', ' ');
    console.log(
      `[ROOT ${utc} UTC] ${root.subject ? `subject="${root.subject}" ` : ''}${evt ? `event=${evt} ` : ''}${rtext ? `"${rtext.slice(0, 90)}"` : ''}`,
    );
    const noteAtt = (m: MsgEx, prefix: string): void => {
      for (const att of m.attachments ?? []) {
        if (att.name || att.contentUrl) {
          console.log(`${prefix}📎 ${att.name ?? att.contentUrl}`);
          if (att.name) docsInMeeting.push(att.name);
        }
      }
    };
    noteAtt(root, '      ');
    const replies = await graph.getAllPages<MsgEx>(
      `/teams/${team.id}/channels/${channel.id}/messages/${root.id}/replies`,
      { $top: '50' },
    );
    const ordered = replies.sort((a, b) =>
      (a.createdDateTime ?? '').localeCompare(b.createdDateTime ?? ''),
    );
    for (const m of ordered) {
      const text = stripHtml(m.body?.content);
      const who = m.from?.user?.displayName ?? '(system)';
      const rutc = (m.createdDateTime ?? '').slice(11, 16);
      if (text) console.log(`    ${rutc}  ${who}: ${text}`);
      noteAtt(m, '      ');
    }
    console.log('');
  }

  // Recording + transcript file for this meeting (channel SharePoint).
  console.log('--- RECORDING & TRANSCRIPT (channel SharePoint) ---');
  try {
    const folder = await graph.get<DriveItem>(
      `/teams/${team.id}/channels/${channel.id}/filesFolder`,
    );
    const driveId = folder.parentReference?.driveId ?? '';
    const top = await graph.get<GraphList<DriveItem>>(
      `/drives/${driveId}/items/${folder.id}/children`,
      { $top: '200' },
    );
    const recFolder = (top.value ?? []).find(
      (it) => it.folder && (it.name ?? '').toLowerCase() === 'recordings',
    );
    if (recFolder) {
      const recs = await graph.get<GraphList<DriveItem>>(
        `/drives/${driveId}/items/${recFolder.id}/children`,
        { $top: '200' },
      );
      const mine = (recs.value ?? []).filter((r) =>
        (r.name ?? '').toLowerCase().replace(/\s+/g, ' ').includes(meetingFilter),
      );
      for (const r of mine) {
        const isVtt = /\.(vtt|srt)$/i.test(r.name ?? '');
        console.log(`  ${isVtt ? '📝 transcript file' : '🎥 recording'}: ${r.name} (${r.size ?? 0} bytes)`);
      }
      if (mine.length === 0) console.log('  (no recording matched that name)');
      const hasVtt = mine.some((r) => /\.(vtt|srt)$/i.test(r.name ?? ''));
      console.log(
        hasVtt
          ? '\n  ✅ A transcript FILE exists — downloadable app-only.'
          : '\n  ⚠️ No transcript FILE in SharePoint — the transcript is Stream-only (needs delegated fetch or transcribe-the-recording).',
      );
    }
  } catch (err) {
    console.log(`  files read failed: ${(err as { message?: string }).message}`);
  }

  console.log(`\n  Documents shared in this meeting: ${docsInMeeting.length}`);
  for (const d of docsInMeeting) console.log(`     - ${d}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('meeting-inside failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
