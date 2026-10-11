import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphCalendarEvent, GraphCallTranscript, GraphList } from '@features/teams/teams.types';

/**
 * READ-ONLY: tests whether APP-ONLY transcript access works now (no login).
 * Distinguishes the real cause of failure:
 *   403 on /users/{upn}/onlineMeetings  → access policy NOT active
 *   404 on the joinWebUrl filter         → no match (URL encoding) — retries decoded
 *   200 + transcript                     → APP-ONLY WORKS
 */
const enc = encodeURIComponent;
const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const errInfo = (err: unknown): string => {
  const e = err as { statusCode?: number; details?: { error?: { code?: string; message?: string } } };
  return `${e.statusCode ?? '?'} ${e.details?.error?.code ?? ''} ${e.details?.error?.message ?? ''}`.trim();
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com';
  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  if (!tokenService.isConfigured()) {
    console.error('creds missing');
    process.exit(1);
  }
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  // CRITICAL: /users/{id}/onlineMeetings needs the user's GUID, NOT the UPN/email.
  // With the UPN it returns 404 UnknownError; with the GUID it resolves (HTTP 200).
  const me = await graph.get<{ id?: string }>(`/users/${enc(upn)}`, { $select: 'id' });
  const userId = me.id ?? upn;
  console.log(`Resolved user GUID: ${userId}\n`);

  const startIso = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  const endIso = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  let cal: GraphList<GraphCalendarEvent>;
  try {
    cal = await graph.get<GraphList<GraphCalendarEvent>>(`/users/${enc(upn)}/calendarView`, {
      startDateTime: startIso,
      endDateTime: endIso,
      $select: 'subject,isOnlineMeeting,onlineMeeting,start,end',
      $top: '200',
    });
  } catch (err) {
    console.error(`calendarView ERROR: ${errInfo(err)}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const raw = cal.value ?? [];
  console.log(`calendarView raw events: ${raw.length}`);
  for (const e of raw.slice(0, 10)) {
    console.log(`   - "${(e.subject ?? '').trim()}"  joinUrl=${e.onlineMeeting?.joinUrl ? 'yes' : 'no'}`);
  }
  const events = raw.filter((e) => e.onlineMeeting?.joinUrl);
  console.log(`\nApp-only transcript test for ${upn} — ${events.length} meeting(s) with joinUrl.\n`);

  let got = 0;
  for (const ev of events) {
    const subject = (ev.subject ?? '(no subject)').trim();
    const joinUrl = ev.onlineMeeting?.joinUrl ?? '';
    let meetingId: string | undefined;
    let lastErr = '';
    for (const cand of [joinUrl, safeDecode(joinUrl)]) {
      try {
        const om = await graph.get<GraphList<{ id: string }>>(
          `/users/${enc(userId)}/onlineMeetings`,
          { $filter: `JoinWebUrl eq '${cand}'` },
        );
        meetingId = om.value?.[0]?.id;
        if (meetingId) break;
      } catch (err) {
        lastErr = errInfo(err);
        // 403 = policy not active; stop early and report it clearly.
        if (lastErr.startsWith('403')) break;
      }
    }
    if (!meetingId) {
      console.log(`• "${subject}" — ❌ could not resolve onlineMeeting  (${lastErr || 'no match / empty'})`);
      continue;
    }
    try {
      const tr = await graph.get<GraphList<GraphCallTranscript>>(
        `/users/${enc(userId)}/onlineMeetings/${meetingId}/transcripts`,
      );
      const list = tr.value ?? [];
      if (list.length === 0) {
        console.log(`• "${subject}" — meeting resolved, 0 transcripts`);
        continue;
      }
      const t0 = list[list.length - 1];
      const buf = await graph.getBinary(
        `/users/${enc(userId)}/onlineMeetings/${meetingId}/transcripts/${t0.id}/content?$format=text/vtt`,
      );
      got += 1;
      console.log(`• "${subject}" — ✅ APP-ONLY TRANSCRIPT ${buf.length} bytes`);
      console.log(`    ${buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 140)}`);
    } catch (err) {
      console.log(`• "${subject}" — transcript fetch failed: ${errInfo(err)}`);
    }
  }

  console.log(
    `\n${got > 0 ? `✅ APP-ONLY WORKS — got ${got} transcript(s) with NO login.` : '❌ App-only still not returning transcripts (see errors above: 403 = policy inactive, 404/empty = lookup miss).'}`,
  );

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('apponly-transcript failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
