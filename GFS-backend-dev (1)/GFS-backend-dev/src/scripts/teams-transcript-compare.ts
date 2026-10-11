import fs from 'fs';
import path from 'path';

import axios from 'axios';
import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';

/**
 * READ-ONLY: the definitive app-only-vs-delegated transcript test.
 * Uses the CACHED delegated token to resolve each meeting's real internal id,
 * then calls the transcript endpoint BOTH ways with that same id.
 *   - delegated /me/onlineMeetings/{id}/transcripts        (known to work)
 *   - app-only  /users/{upn}/onlineMeetings/{id}/transcripts  ← THE test
 * 200 = app-only WORKS (no login needed in prod) · 403 = policy inactive · 404/other = something else.
 */
const GRAPH = env.teams.graphBaseUrl;
const enc = encodeURIComponent;
const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const status = (err: unknown): string => {
  const e = (err as { response?: { status?: number; data?: { error?: { code?: string; message?: string } } } })
    .response;
  return `${e?.status ?? '?'} ${e?.data?.error?.code ?? ''} ${(e?.data?.error?.message ?? '').slice(0, 80)}`.trim();
};

interface CalEvent {
  subject?: string | null;
  onlineMeeting?: { joinUrl?: string } | null;
}

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com';

  // Delegated token from cache (written by teams-delegated-transcript.ts).
  const cachePath = path.resolve('temp', '.delegated-token.json');
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { accessToken: string; expiresAt: number };
  if (!cache.accessToken || cache.expiresAt < Date.now()) {
    console.error('Cached delegated token missing/expired — run teams-delegated-transcript.ts first.');
    process.exit(1);
  }
  const gDel = axios.create({
    baseURL: GRAPH,
    headers: { Authorization: `Bearer ${cache.accessToken}` },
    timeout: 30000,
  });

  // App-only token.
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  const appToken = await tokenService.getValidAccessToken();
  const gApp = axios.create({
    baseURL: GRAPH,
    headers: { Authorization: `Bearer ${appToken}` },
    timeout: 30000,
  });

  // Discover meetings via app-only calendar — flaky in this tenant (returns 0
  // intermittently), so retry until it yields events.
  const startIso = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  const endIso = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let events: CalEvent[] = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const cal = await gApp.get<{ value: CalEvent[] }>(`/users/${enc(upn)}/calendarView`, {
      params: {
        startDateTime: startIso,
        endDateTime: endIso,
        $select: 'subject,isOnlineMeeting,onlineMeeting,start',
        $top: '200',
      },
    });
    const raw = cal.data.value ?? [];
    events = raw.filter((e) => e.onlineMeeting?.joinUrl);
    console.log(`  calendar attempt ${attempt}: ${raw.length} raw, ${events.length} with joinUrl`);
    if (events.length > 0) break;
    await sleep(2500);
  }
  console.log(`\n${events.length} meeting(s). Comparing delegated vs app-only transcript per meeting:\n`);

  let appWorks = 0;
  for (const ev of events) {
    const subject = (ev.subject ?? '(no subject)').trim() || '(no subject)';
    const joinUrl = ev.onlineMeeting?.joinUrl ?? '';

    // Resolve the REAL internal meetingId via delegated (this works).
    let meetingId: string | undefined;
    for (const cand of [joinUrl, safeDecode(joinUrl)]) {
      try {
        const om = await gDel.get<{ value: Array<{ id?: string }> }>('/me/onlineMeetings', {
          params: { $filter: `JoinWebUrl eq '${cand}'` },
        });
        meetingId = om.data.value?.[0]?.id;
        if (meetingId) break;
      } catch {
        /* try next */
      }
    }
    if (!meetingId) {
      console.log(`• "${subject}" — delegated couldn't resolve a meetingId, skipping`);
      continue;
    }

    let del = '';
    try {
      const t = await gDel.get<{ value: unknown[] }>(`/me/onlineMeetings/${meetingId}/transcripts`);
      del = `200 (${(t.data.value ?? []).length} transcript(s))`;
    } catch (err) {
      del = status(err);
    }

    let app = '';
    try {
      const t = await gApp.get<{ value: unknown[] }>(
        `/users/${enc(upn)}/onlineMeetings/${enc(meetingId)}/transcripts`,
      );
      app = `✅ 200 (${(t.data.value ?? []).length} transcript(s)) — APP-ONLY WORKS`;
      appWorks += 1;
    } catch (err) {
      app = `❌ ${status(err)}`;
    }

    console.log(`• "${subject}"`);
    console.log(`     delegated: ${del}`);
    console.log(`     app-only : ${app}`);
  }

  console.log(
    `\n==== ${appWorks > 0 ? `✅ APP-ONLY transcripts WORK for ${appWorks} meeting(s) — NO LOGIN needed in production!` : '❌ App-only still blocked (403 = policy inactive / other). Delegated remains the path.'} ====`,
  );

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('compare failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
