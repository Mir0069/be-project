import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphList } from '@features/teams/teams.types';

/**
 * READ-ONLY: settle the UPN-vs-GUID question for 1:1 (oneOnOne) chat messages.
 *
 * The earlier 403 was on `/chats/{chatId}/messages` (chat-id scoped — no user id
 * in the path, so the GUID fix can't apply). This probes the OTHER variants that
 * DO take a user id, using the resolved GUID:
 *   1. /chats/{chatId}/messages                      (tenant-scoped — control)
 *   2. /users/{GUID}/chats/{chatId}/messages         (user-GUID-scoped)
 *   3. /users/{GUID}/chats/{chatId}                  (read the chat object itself)
 *
 * Run:
 *   TEAMS_TEST_USER_ID=jamunesh@amberflux123.onmicrosoft.com \
 *   TEAMS_TEST_PEER_NAME=Pradeep \
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-1on1-guid-test.ts
 */

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
interface GraphMsg {
  messageType?: string;
  from?: { user?: { displayName?: string | null } | null } | null;
  body?: { content?: string | null } | null;
}

const enc = encodeURIComponent;
const stripHtml = (h?: string | null): string =>
  (h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const graphErr = (err: unknown): { status: number | null; code: string | null; message: string } => {
  const e = err as { statusCode?: number; message?: string; details?: unknown };
  const inner = (e?.details as { error?: { code?: string; message?: string } } | undefined)?.error;
  return { status: e?.statusCode ?? null, code: inner?.code ?? null, message: inner?.message ?? e?.message ?? String(err) };
};

const probe = async (
  graph: TeamsGraphClient,
  label: string,
  path: string,
): Promise<void> => {
  try {
    const res = await graph.get<GraphList<GraphMsg>>(path, { $top: '50' });
    const msgs = res.value ?? [];
    let texts = 0;
    for (const m of msgs) {
      if (m.messageType && m.messageType !== 'message') continue;
      const t = stripHtml(m.body?.content);
      if (!t) continue;
      texts += 1;
      console.log(`      • ${m.from?.user?.displayName ?? '(unknown)'}: ${t.slice(0, 120)}`);
    }
    console.log(`✅ [${label}] 200 — ${msgs.length} msg(s), ${texts} with text\n      PATH: ${path}\n`);
  } catch (err) {
    const e = graphErr(err);
    console.log(`❌ [${label}] status=${e.status} — ${e.code ?? ''} ${e.message}\n      PATH: ${path}\n`);
  }
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com';
  const peer = (process.env['TEAMS_TEST_PEER_NAME'] ?? 'Pradeep').toLowerCase();

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

  // 1) Resolve UPN -> GUID
  const guid = await graph.resolveUserId(upn);
  console.log(`\nUPN  : ${upn}`);
  console.log(`GUID : ${guid}\n`);

  // 2) List chats with the GUID and find the oneOnOne with the peer
  const list = await graph.get<GraphList<GraphChat>>(`/users/${guid}/chats`, {
    $expand: 'members',
    $top: '50',
  });
  const chats = list.value ?? [];
  console.log(`Discovered ${chats.length} chat(s) via /users/{GUID}/chats:`);
  for (const c of chats) {
    const who = (c.members ?? []).map((m) => m.displayName ?? m.email ?? m.userId ?? '?').join(', ');
    console.log(`   • ${c.chatType ?? '?'}  topic="${c.topic ?? ''}"  members=[${who}]  id=${c.id}`);
  }
  console.log('');

  const target =
    chats.find(
      (c) =>
        c.chatType === 'oneOnOne' &&
        (c.members ?? []).some((m) => (m.displayName ?? '').toLowerCase().includes(peer)),
    ) ?? chats.find((c) => c.chatType === 'oneOnOne');

  if (!target) {
    console.log('No oneOnOne chat found to probe.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const who = (target.members ?? []).map((m) => m.displayName ?? m.userId ?? '?').join(', ');
  console.log(`Probing oneOnOne chat: members=[${who}]  id=${target.id}\n`);

  // 3) Three endpoint variants
  await probe(graph, '1 tenant-scoped /chats/{id}/messages', `/chats/${target.id}/messages`);
  await probe(
    graph,
    '2 user-GUID-scoped /users/{GUID}/chats/{id}/messages',
    `/users/${guid}/chats/${enc(target.id)}/messages`,
  );

  // 4) Read the chat object itself via the GUID-scoped path
  try {
    const obj = await graph.get<GraphChat>(`/users/${guid}/chats/${enc(target.id)}`);
    console.log(`✅ [3 read chat object /users/{GUID}/chats/{id}] 200 — chatType=${obj.chatType}\n`);
  } catch (err) {
    const e = graphErr(err);
    console.log(`❌ [3 read chat object /users/{GUID}/chats/{id}] status=${e.status} — ${e.code ?? ''} ${e.message}\n`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-1on1-guid-test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
