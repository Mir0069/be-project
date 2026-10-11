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
  GraphList,
  GraphCallTranscript,
  GraphTranscriptListEntry,
} from '@features/teams/teams.types';

/**
 * READ-ONLY deep-dive for two specific scheduled meetings. For each it reports:
 *  - which team/channel it belongs to (channel meeting vs private meeting),
 *  - the messages (NOTE: meeting-chat messages need Chat.Read.All — blocked),
 *  - the transcript (via onlineMeetings, needs a Teams app-access-policy),
 *  - documents + the recording (pulled from OneDrive via Files.Read.All).
 *
 * GET calls only. Run:
 *   TEAMS_TEST_USER_ID=jamunesh@amberflux123.onmicrosoft.com \
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-meeting-detail.ts
 */

interface EmailAddr {
  name?: string;
  address?: string;
}
interface CalEvent {
  id: string;
  subject?: string | null;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  start?: { dateTime?: string; timeZone?: string } | null;
  end?: { dateTime?: string; timeZone?: string } | null;
  organizer?: { emailAddress?: EmailAddr } | null;
}
interface DriveItem {
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
}

const enc = encodeURIComponent;
const report: Record<string, unknown> = {};

const graphErr = (err: unknown): { status: number | null; code: string | null; message: string } => {
  const e = err as { statusCode?: number; message?: string; details?: unknown };
  const inner = (e?.details as { error?: { code?: string; message?: string } } | undefined)?.error;
  return {
    status: e?.statusCode ?? null,
    code: inner?.code ?? null,
    message: inner?.message ?? e?.message ?? String(err),
  };
};

// Channel meetings use @thread.tacv2 in the join URL; private meetings @thread.v2.
const classifyMeeting = (joinUrl: string): string => {
  const decoded = decodeURIComponent(joinUrl);
  if (decoded.includes('@thread.tacv2')) return 'CHANNEL meeting (tied to a team channel)';
  if (decoded.includes('@thread.v2')) return 'PRIVATE meeting (NOT tied to any team/channel)';
  return 'unknown meeting type';
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'];
  if (!upn) {
    console.error('Set TEAMS_TEST_USER_ID to the organizer UPN.');
    process.exit(1);
  }
  // Subjects to deep-dive (substring, case-insensitive).
  const targets = (process.env['TEAMS_TEST_SUBJECTS'] ??
    'private message|channel member to chekc|individuakl')
    .split('|')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

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

  // ---------------------------------------------------------------
  // 1) Enumerate calendar events (Calendars.Read — granted)
  // ---------------------------------------------------------------
  const startIso = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  const endIso = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  let events: CalEvent[] = [];
  try {
    const res = await graph.get<GraphList<CalEvent>>(`/users/${enc(upn)}/calendarView`, {
      startDateTime: startIso,
      endDateTime: endIso,
      $select: 'subject,isOnlineMeeting,onlineMeeting,start,end,organizer',
      $top: '200',
    });
    events = res.value ?? [];
  } catch (err) {
    console.error('calendarView failed:', graphErr(err));
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n=== ALL online meetings in calendar (${events.length} events scanned) ===`);
  for (const e of events) {
    if (!e.onlineMeeting?.joinUrl) continue;
    console.log(
      `   • "${(e.subject ?? '').trim()}"  start=${e.start?.dateTime?.slice(0, 16) ?? '?'}  organizer=${e.organizer?.emailAddress?.address ?? '?'}  type=${classifyMeeting(e.onlineMeeting.joinUrl)}`,
    );
  }

  // ---------------------------------------------------------------
  // 1b) Authoritative transcript check via getAllTranscripts(organizer).
  //     Needs User.Read.All (to resolve the GUID) + OnlineMeetingTranscript
  //     .Read.All + the Teams app-access-policy. Avoids joinUrl matching.
  // ---------------------------------------------------------------
  console.log('\n=== Transcript discovery via getAllTranscripts(organizer) ===');
  try {
    const me = await graph.get<{ id: string; displayName?: string; mail?: string }>(
      `/users/${enc(upn)}`,
      { $select: 'id,displayName,mail' },
    );
    console.log(`   organizer resolved: ${me.displayName ?? ''} <${me.mail ?? upn}>  id=${me.id}`);
    const entries: GraphTranscriptListEntry[] = await graph.getAllTranscriptsByOrganizer(me.id);
    console.log(`   transcripts found: ${entries.length}`);
    report['transcriptsFound'] = entries.length;
    for (const t of entries) {
      let bytes = 0;
      let snippet = '';
      const contentUrl = t.transcriptContentUrl
        ? `${t.transcriptContentUrl}${t.transcriptContentUrl.includes('?') ? '&' : '?'}$format=text/vtt`
        : `/users/${enc(upn)}/onlineMeetings/${t.meetingId}/transcripts/${t.id}/content?$format=text/vtt`;
      try {
        const buf = await graph.getBinary(contentUrl);
        bytes = buf.length;
        snippet = buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 220);
      } catch (dlErr) {
        snippet = `(download failed: ${graphErr(dlErr).message})`;
      }
      console.log(
        `   • transcript ${t.id}  created=${t.createdDateTime ?? '?'}  bytes=${bytes}`,
      );
      if (snippet) console.log(`       snippet: ${snippet}`);
    }
  } catch (err) {
    const e = graphErr(err);
    console.log(`   ❌ getAllTranscripts failed: ${e.status} ${e.code ?? ''} ${e.message}`);
    console.log(`   raw: ${JSON.stringify((err as { details?: unknown }).details)}`);
  }

  // ---------------------------------------------------------------
  // 2) Per target meeting: type, team/channel, transcript
  // ---------------------------------------------------------------
  const perMeeting: Array<Record<string, unknown>> = [];
  for (const subjMatch of targets) {
    const matches = events.filter((e) => (e.subject ?? '').toLowerCase().includes(subjMatch));
    if (matches.length === 0) {
      console.log(`\n=== Meeting matching "${subjMatch}" → NOT FOUND in calendar ===`);
      perMeeting.push({ subjectMatch: subjMatch, found: false });
      continue;
    }
    for (const ev of matches) {
      const subject = (ev.subject ?? '').trim();
      const joinUrl = ev.onlineMeeting?.joinUrl ?? '';
      const kind = joinUrl ? classifyMeeting(joinUrl) : 'no joinUrl (not an online meeting)';
      console.log(`\n=== Meeting: "${subject}" ===`);
      console.log(`   type         : ${kind}`);
      console.log(`   organizer    : ${ev.organizer?.emailAddress?.name ?? '?'} <${ev.organizer?.emailAddress?.address ?? '?'}>`);
      console.log(`   start / end  : ${ev.start?.dateTime ?? '?'}  →  ${ev.end?.dateTime ?? '?'}`);
      console.log(`   team/channel : ${kind.startsWith('PRIVATE') ? 'NONE — private meeting, belongs to no team/channel' : kind.startsWith('CHANNEL') ? 'a team channel (channel meeting)' : 'n/a'}`);

      const entry: Record<string, unknown> = {
        subject,
        type: kind,
        organizer: ev.organizer?.emailAddress?.address ?? null,
        start: ev.start?.dateTime ?? null,
        end: ev.end?.dateTime ?? null,
        teamChannel: kind.startsWith('PRIVATE') ? 'none (private meeting)' : kind.startsWith('CHANNEL') ? 'channel meeting' : 'n/a',
        messages: 'BLOCKED — meeting-chat messages require Chat.Read.All (app has none)',
      };

      // Transcript attempt: resolve onlineMeeting id then list transcripts.
      if (joinUrl) {
        try {
          const meetingId = await graph.getOnlineMeetingIdByJoinUrl(upn, joinUrl);
          if (!meetingId) {
            entry['transcript'] = 'onlineMeetings reachable but no meetingId matched the joinUrl';
            console.log(`   transcript   : onlineMeetings reachable but no meetingId matched`);
          } else {
            const tr = await graph.get<GraphList<GraphCallTranscript>>(
              `/users/${enc(upn)}/onlineMeetings/${meetingId}/transcripts`,
            );
            const list = tr.value ?? [];
            if (list.length === 0) {
              entry['transcript'] = 'meeting resolved, transcripts endpoint OK, 0 transcripts listed';
              console.log(`   transcript   : 0 transcripts listed (none finalized)`);
            } else {
              const t0 = list[list.length - 1];
              const buf = await graph.getBinary(
                `/users/${enc(upn)}/onlineMeetings/${meetingId}/transcripts/${t0.id}/content?$format=text/vtt`,
              );
              entry['transcript'] = `GOT IT — ${list.length} transcript(s), ${buf.length} bytes VTT`;
              console.log(`   transcript   : ✅ ${list.length} transcript(s), ${buf.length} bytes`);
              console.log(`   snippet      : ${buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 200)}`);
            }
          }
        } catch (err) {
          const e = graphErr(err);
          entry['transcript'] = `BLOCKED — ${e.status} ${e.code ?? ''} ${e.message}`.trim();
          console.log(`   transcript   : ❌ ${e.status} ${e.code ?? ''} ${e.message} (Teams app-access-policy not configured)`);
        }
      }
      perMeeting.push(entry);
    }
  }

  // ---------------------------------------------------------------
  // 3) OneDrive: recordings + documents (Files.Read.All — granted)
  // ---------------------------------------------------------------
  console.log(`\n=== OneDrive of ${upn} (Files.Read.All) — recordings & documents ===`);
  const oneDrive: Array<Record<string, unknown>> = [];
  const listChildren = async (label: string, urlPath: string): Promise<void> => {
    try {
      const res = await graph.get<GraphList<DriveItem>>(urlPath, { $top: '100' });
      const items = res.value ?? [];
      console.log(`\n   [${label}] ${items.length} item(s):`);
      for (const it of items) {
        const tag = it.folder ? `folder(${it.folder.childCount ?? 0})` : it.file?.mimeType ?? 'file';
        console.log(`     • ${it.name ?? '?'}  [${tag}]  ${it.size ?? 0} bytes  ${it.lastModifiedDateTime?.slice(0, 16) ?? ''}`);
        oneDrive.push({ where: label, name: it.name, type: tag, size: it.size ?? 0, webUrl: it.webUrl });
      }
    } catch (err) {
      const e = graphErr(err);
      console.log(`\n   [${label}] ❌ ${e.status} ${e.code ?? ''} ${e.message}`);
      oneDrive.push({ where: label, error: `${e.status} ${e.code ?? ''} ${e.message}`.trim() });
    }
  };

  await listChildren('OneDrive root', `/users/${enc(upn)}/drive/root/children`);
  await listChildren('Recordings folder', `/users/${enc(upn)}/drive/root:/Recordings:/children`);
  await listChildren('Meetings folder', `/users/${enc(upn)}/drive/root:/Meetings:/children`);
  await listChildren('Attachments folder', `/users/${enc(upn)}/drive/root:/Attachments:/children`);

  // ---------------------------------------------------------------
  report['organizer'] = upn;
  report['generatedAt'] = new Date().toISOString();
  report['meetings'] = perMeeting;
  report['oneDrive'] = oneDrive;
  const outDir = path.resolve('temp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'teams-meeting-detail-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nSaved report → ${outFile}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-meeting-detail failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
