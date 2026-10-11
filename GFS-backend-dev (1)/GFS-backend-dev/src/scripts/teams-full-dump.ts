import fs from 'fs';
import path from 'path';

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
 * READ-ONLY full inventory of every team + channel the app-only token can see:
 *   - team name, id, description, member list (names/emails/roles)
 *   - each channel: name, description, membership type
 *   - channel messages + replies (sender, time, text)
 *   - channel documents (Files tab)
 *   - meeting activity detected in the channel (meetingReference / call events)
 *   - per-organizer chats (meeting chat + 1:1) — 1:1 with externals returns 403
 *
 * Saves a structured JSON report to temp/teams-full-dump.json.
 *
 * Run:
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-full-dump.ts
 *   (optional) TEAMS_TEST_USER_ID=<organizer upn> to also dump that user's chats
 */

interface GraphTeamMember {
  id?: string;
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
  roles?: string[];
}
interface GraphChatMember {
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
}
interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  members?: GraphChatMember[];
}
interface GraphChannelFull extends GraphChannel {
  membershipType?: string;
}

const stripHtml = (h?: string | null): string =>
  (h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const enc = encodeURIComponent;

const graphErr = (err: unknown): { status: number | null; msg: string } => {
  const e = err as { statusCode?: number; message?: string; details?: unknown };
  const inner = (e?.details as { error?: { code?: string; message?: string } } | undefined)?.error;
  return {
    status: e?.statusCode ?? null,
    msg: `${inner?.code ?? ''} ${inner?.message ?? e?.message ?? String(err)}`.trim(),
  };
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID']; // optional, for chat dump

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
  await TeamsTokenModel.deleteMany({}); // fresh token → latest consented perms
  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  console.log(`\nGraph base: ${env.teams.graphBaseUrl}`);
  console.log(`Tenant    : ${env.teams.tenantId}\n`);

  const report: unknown[] = [];

  const teams = await graph.getAllPages<GraphTeam>('/teams');
  console.log(`================  ${teams.length} TEAM(S) FOUND  ================\n`);

  for (const team of teams) {
    console.log(`\n############################################################`);
    console.log(`# TEAM: ${team.displayName}`);
    console.log(`#   id          : ${team.id}`);
    console.log(`#   description : ${team.description ?? '(none)'}`);

    // ---- members ----
    const members: GraphTeamMember[] = [];
    try {
      const m = await graph.getAllPages<GraphTeamMember>(`/teams/${team.id}/members`);
      members.push(...m);
      console.log(`#   members     : ${members.length}`);
      for (const mem of members) {
        console.log(
          `#      - ${mem.displayName ?? '(no name)'}  <${mem.email ?? 'no-email'}>  roles=[${(mem.roles ?? []).join(',') || 'member'}]`,
        );
      }
    } catch (err) {
      const e = graphErr(err);
      console.log(`#   members     : ❌ ${e.status} ${e.msg}`);
    }
    console.log(`############################################################`);

    // ---- channels ----
    const channels = await graph.getAllPages<GraphChannelFull>(`/teams/${team.id}/channels`);
    console.log(`\n   >>> ${channels.length} channel(s) in "${team.displayName}":\n`);

    const channelReports: unknown[] = [];

    for (const ch of channels) {
      console.log(`   ───────────────────────────────────────────────`);
      console.log(`   CHANNEL: ${ch.displayName}   [${ch.membershipType ?? 'standard'}]`);
      console.log(`      id          : ${ch.id}`);
      console.log(`      description : ${ch.description ?? '(none)'}`);

      // messages + replies
      const msgRecords: Array<{ when: string; who: string; text: string; replies: number }> = [];
      let meetingActivity = 0;
      const docsFromMsgs: string[] = [];
      try {
        const msgs = await graph.getAllPages<GraphChannelMessage>(
          `/teams/${team.id}/channels/${ch.id}/messages`,
        );
        let textCount = 0;
        for (const msg of msgs) {
          // detect meeting activity
          const odata = (msg.eventDetail as { '@odata.type'?: string } | null)?.['@odata.type'];
          if (odata && odata.toLowerCase().includes('call')) meetingActivity += 1;
          for (const att of msg.attachments ?? []) {
            if (att.contentType === 'meetingReference') meetingActivity += 1;
            if (att.contentType === 'reference' && att.name) docsFromMsgs.push(att.name);
          }
          if (msg.messageType && msg.messageType !== 'message') continue;
          const text = stripHtml(msg.body?.content);
          if (!text) continue;

          let replyCount = 0;
          try {
            const replies = await graph.getAllPages<GraphChannelMessage>(
              `/teams/${team.id}/channels/${ch.id}/messages/${msg.id}/replies`,
            );
            replyCount = replies.filter((r) => stripHtml(r.body?.content)).length;
          } catch {
            /* ignore */
          }

          textCount += 1;
          const who = msg.from?.user?.displayName ?? '(system/unknown)';
          const when = (msg.createdDateTime ?? '').slice(0, 16).replace('T', ' ');
          msgRecords.push({ when, who, text, replies: replyCount });
        }
        console.log(`      messages    : ${textCount} text message(s), ${meetingActivity} meeting event(s)`);
        for (const r of msgRecords) {
          console.log(`         • ${r.when}  ${r.who}: ${r.text.slice(0, 120)}${r.replies ? `  (${r.replies} repl)` : ''}`);
        }
      } catch (err) {
        const e = graphErr(err);
        console.log(`      messages    : ❌ ${e.status} ${e.msg}`);
      }

      // documents (Files tab → filesFolder → driveId → children)
      const docs: Array<{ name: string; size: number }> = [];
      try {
        const ff = await graph.get<{ parentReference?: { driveId?: string }; id?: string }>(
          `/teams/${team.id}/channels/${ch.id}/filesFolder`,
        );
        const driveId = ff.parentReference?.driveId;
        const itemId = ff.id;
        if (driveId && itemId) {
          const children = await graph.get<GraphList<{ name?: string; size?: number }>>(
            `/drives/${driveId}/items/${itemId}/children`,
          );
          for (const f of children.value ?? []) {
            docs.push({ name: f.name ?? '?', size: f.size ?? 0 });
          }
        }
        console.log(`      documents   : ${docs.length}`);
        for (const d of docs) console.log(`         • ${d.name} (${d.size} bytes)`);
      } catch (err) {
        const e = graphErr(err);
        console.log(`      documents   : ❌ ${e.status} ${e.msg}`);
      }

      channelReports.push({
        name: ch.displayName,
        id: ch.id,
        membershipType: ch.membershipType ?? 'standard',
        description: ch.description ?? null,
        messageCount: msgRecords.length,
        meetingActivity,
        messages: msgRecords,
        documents: docs,
        docNamesFromMessages: docsFromMsgs,
      });
    }

    report.push({
      team: team.displayName,
      id: team.id,
      description: team.description ?? null,
      memberCount: members.length,
      members: members.map((m) => ({
        name: m.displayName ?? null,
        email: m.email ?? null,
        roles: m.roles ?? [],
      })),
      channels: channelReports,
    });
  }

  // ---- optional: per-organizer chats (meeting chat + 1:1) ----
  if (upn) {
    console.log(`\n\n================  CHATS for ${upn}  ================`);
    try {
      const guid = await graph.resolveUserId(upn);
      const res = await graph.get<GraphList<GraphChat>>(`/users/${guid}/chats`, {
        $expand: 'members',
        $top: '50',
      });
      for (const c of res.value ?? []) {
        const who = (c.members ?? []).map((m) => m.displayName ?? m.userId ?? '?').join(', ');
        let msgStatus = '';
        try {
          const cm = await graph.get<GraphList<GraphChannelMessage>>(`/chats/${c.id}/messages`, {
            $top: '20',
          });
          const texts = (cm.value ?? []).filter((m) => stripHtml(m.body?.content)).length;
          msgStatus = `✅ ${texts} text msg(s)`;
        } catch (err) {
          const e = graphErr(err);
          msgStatus = `❌ ${e.status} ${e.msg}`;
        }
        console.log(`   • ${c.chatType ?? '?'}  topic="${c.topic ?? ''}"  members=[${who}]  → ${msgStatus}`);
      }
    } catch (err) {
      const e = graphErr(err);
      console.log(`   ❌ chats: ${e.status} ${e.msg}`);
    }
  } else {
    console.log(
      `\n(Set TEAMS_TEST_USER_ID=<organizer upn> to also dump meeting-chat + 1:1 chat for that user.)`,
    );
  }

  const outDir = path.resolve('temp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'teams-full-dump.json');
  fs.writeFileSync(outFile, JSON.stringify({ tenant: env.teams.tenantId, generatedAt: new Date().toISOString(), teams: report }, null, 2));
  console.log(`\n\nSaved full report → ${outFile}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-full-dump failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
