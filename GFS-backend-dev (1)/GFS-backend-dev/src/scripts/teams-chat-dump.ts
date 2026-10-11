import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphChannelMessage, GraphList } from '@features/teams/teams.types';

/** READ-ONLY: dump meeting-chat + 1:1 chat for a user (resolves UPN->GUID). */

interface GraphChatMember { displayName?: string | null; email?: string | null; userId?: string | null }
interface GraphChat { id: string; topic?: string | null; chatType?: string; members?: GraphChatMember[] }

const stripHtml = (h?: string | null): string =>
  (h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const graphErr = (err: unknown): { status: number | null; msg: string } => {
  const e = err as { statusCode?: number; message?: string; details?: unknown };
  const inner = (e?.details as { error?: { code?: string; message?: string } } | undefined)?.error;
  return { status: e?.statusCode ?? null, msg: `${inner?.code ?? ''} ${inner?.message ?? e?.message ?? String(err)}`.trim() };
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'gfs2@amberflux.in';
  const ts = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId, clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId, authority: env.teams.authority, scope: env.teams.scope,
  });
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(ts, env.teams.graphBaseUrl);

  const guid = await graph.resolveUserId(upn);
  console.log(`\nUser: ${upn}  (GUID ${guid})\n`);
  const res = await graph.get<GraphList<GraphChat>>(`/users/${guid}/chats`, { $expand: 'members', $top: '50' });
  const chats = res.value ?? [];
  console.log(`Discovered ${chats.length} chat(s):\n`);

  for (const c of chats) {
    const who = (c.members ?? []).map((m) => m.displayName ?? m.email ?? m.userId ?? '?').join(', ');
    console.log(`▶ ${c.chatType ?? '?'}  topic="${c.topic ?? ''}"  members=[${who}]`);
    try {
      const cm = await graph.get<GraphList<GraphChannelMessage>>(`/chats/${c.id}/messages`, { $top: '50' });
      const texts = (cm.value ?? []).filter((m) => (!m.messageType || m.messageType === 'message') && stripHtml(m.body?.content));
      console.log(`   ✅ ${texts.length} text message(s):`);
      for (const m of texts) {
        const when = (m.createdDateTime ?? '').slice(0, 16).replace('T', ' ');
        console.log(`      • ${when}  ${m.from?.user?.displayName ?? '(unknown)'}: ${stripHtml(m.body?.content).slice(0, 120)}`);
      }
    } catch (err) {
      const e = graphErr(err);
      console.log(`   ❌ ${e.status} ${e.msg}`);
    }
    console.log('');
  }
  await mongoose.disconnect();
  process.exit(0);
};
main().catch((e) => { console.error('chat-dump failed:', e instanceof Error ? e.message : e); process.exit(1); });
