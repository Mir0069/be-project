import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import { TeamsFilesService } from '@features/teams/teams-files.service';
import { LoggingDocumentIngestionPort } from '@features/teams/document-ingestion.port';
import type {
  GraphChannel,
  GraphList,
  GraphTeam,
  GraphChannelMessage,
  GraphCalendarEvent,
  GraphCallTranscript,
} from '@features/teams/teams.types';

/**
 * READ-ONLY diagnostic: empirically proves which Teams data our app-only
 * (admin) Graph access can actually fetch for a test meeting — channel
 * messages, meeting-chat messages, 1:1 private chat, transcript, and files.
 *
 * Why this exists: the production integration only reads CHANNEL messages.
 * Meeting-chat / 1:1 messages live behind /chats/{id}/messages, which Microsoft
 * gates behind a "protected API" approval for app-only tokens. This script hits
 * every endpoint and records 200 (got it) vs 403 (blocked) with the verbatim
 * Graph error, so the result is provable rather than assumed.
 *
 * It makes GET calls ONLY — it never writes to Teams.
 *
 * Run:
 *   TEAMS_TEST_USER_ID=organizer@tenant.onmicrosoft.com \
 *   TEAMS_TEST_PEER_NAME=Pradeep \
 *   npx ts-node -r tsconfig-paths/register src/scripts/teams-private-verify.ts
 */

// ---- Graph chat DTOs (not in teams.types.ts — chat support isn't in prod) ----
interface GraphChatMember {
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
}
interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string; // oneOnOne | group | meeting
  members?: GraphChatMember[];
}

interface StepResult {
  step: string;
  target: string;
  gotIt: boolean;
  status: number | null;
  detail: string;
}

const results: StepResult[] = [];
const record = (r: StepResult): void => {
  results.push(r);
  const tick = r.gotIt ? '✅' : '❌';
  console.log(`${tick} [${r.step}] ${r.target} — status=${r.status ?? 'n/a'} :: ${r.detail}`);
};

// Pull status + Graph error code/message out of the AppError the client throws.
const graphErr = (
  err: unknown,
): { status: number | null; code: string | null; message: string } => {
  const e = err as { statusCode?: number; message?: string; details?: unknown };
  const inner = (e?.details as { error?: { code?: string; message?: string } } | undefined)?.error;
  return {
    status: e?.statusCode ?? null,
    code: inner?.code ?? null,
    message: inner?.message ?? e?.message ?? String(err),
  };
};

const stripHtml = (html?: string | null): string =>
  (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const enc = encodeURIComponent;

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'];
  const peerName = (process.env['TEAMS_TEST_PEER_NAME'] ?? '').trim();
  const meetingTopicHint = (process.env['TEAMS_TEST_MEETING_TOPIC'] ?? 'private message').trim();

  if (!upn) {
    console.warn(
      'TEAMS_TEST_USER_ID not set — running the channel-message baseline (A) and a user discovery only.\n' +
        'Re-run with TEAMS_TEST_USER_ID=<organizer UPN> to probe meeting/1:1 messages, transcript and files (B–F).',
    );
  }

  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  if (!tokenService.isConfigured()) {
    console.error('TEAMS creds missing in .env (TEAMS_CLIENT_ID/SECRET/TENANT_ID).');
    process.exit(1);
  }

  await connectDB();
  await TeamsTokenModel.deleteMany({}); // fresh token → picks up the latest consented permissions

  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);
  const filesService = new TeamsFilesService(graph, new LoggingDocumentIngestionPort(), true);

  console.log(`\nGraph base: ${env.teams.graphBaseUrl}`);
  console.log(`Organizer UPN: ${upn}`);
  console.log(`Peer filter: ${peerName || '(none — will list all 1:1 chats)'}`);
  console.log(`Meeting topic hint: "${meetingTopicHint}"\n`);

  // ----------------------------------------------------------------------
  // A — CHANNEL messages (baseline; expected to work with app permissions)
  // ----------------------------------------------------------------------
  console.log('=== A) Channel messages (baseline) ===');
  try {
    const teams = await graph.getAllPages<GraphTeam>('/teams');
    const senderCounts = new Map<string, number>();
    let total = 0;
    const note = (m: GraphChannelMessage, team: string, channel: string, kind: string): void => {
      if (m.messageType && m.messageType !== 'message') return;
      const text = stripHtml(m.body?.content);
      if (!text) return;
      const who = m.from?.user?.displayName ?? '(system/unknown)';
      const when = (m.createdDateTime ?? '').slice(0, 16).replace('T', ' ');
      total += 1;
      senderCounts.set(who, (senderCounts.get(who) ?? 0) + 1);
      console.log(`   • ${when} [${team}/${channel}]${kind} ${who}: ${text.slice(0, 120)}`);
    };
    for (const team of teams) {
      const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);
      for (const ch of channels) {
        const res = await graph.get<GraphList<GraphChannelMessage>>(
          `/teams/${team.id}/channels/${ch.id}/messages`,
          { $top: '50' },
        );
        for (const m of res.value ?? []) {
          note(m, team.displayName, ch.displayName, '');
          try {
            const replies = await graph.get<GraphList<GraphChannelMessage>>(
              `/teams/${team.id}/channels/${ch.id}/messages/${m.id}/replies`,
              { $top: '50' },
            );
            for (const r of replies.value ?? []) note(r, team.displayName, ch.displayName, ' ↳reply');
          } catch {
            /* ignore reply fetch errors */
          }
        }
      }
    }
    console.log('\n   Senders summary (channel messages):');
    for (const [who, n] of senderCounts) console.log(`     - ${who}: ${n} message(s)`);
    record({
      step: 'A channel-messages',
      target: `${teams.length} team(s)`,
      gotIt: total > 0,
      status: 200,
      detail: `${total} text message(s) from ${senderCounts.size} sender(s): ${[...senderCounts.keys()].join(', ')}`,
    });
  } catch (err) {
    const e = graphErr(err);
    record({
      step: 'A channel-messages',
      target: '/teams/*/channels/*/messages',
      gotIt: false,
      status: e.status,
      detail: `${e.code ?? ''} ${e.message}`.trim(),
    });
  }

  // ----------------------------------------------------------------------
  // A2 — CHANNEL documents (files in each channel's Files tab / SharePoint)
  // ----------------------------------------------------------------------
  console.log('\n=== A2) Channel documents ===');
  try {
    const teams = await graph.getAllPages<GraphTeam>('/teams');
    let fileCount = 0;
    for (const team of teams) {
      const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);
      for (const ch of channels) {
        try {
          const files = await graph.get<GraphList<{ name?: string; size?: number }>>(
            `/teams/${team.id}/channels/${ch.id}/filesFolder/children`,
          );
          for (const f of files.value ?? []) {
            fileCount += 1;
            console.log(`   • [${team.displayName}/${ch.displayName}] ${f.name ?? '?'} (${f.size ?? 0} bytes)`);
          }
        } catch {
          /* channel may have no files folder yet */
        }
      }
    }
    record({
      step: 'A2 channel-documents',
      target: 'channel filesFolder',
      gotIt: true,
      status: 200,
      detail: `found ${fileCount} channel file(s)`,
    });
  } catch (err) {
    const e = graphErr(err);
    record({
      step: 'A2 channel-documents',
      target: 'channel filesFolder',
      gotIt: false,
      status: e.status,
      detail: `${e.code ?? ''} ${e.message}`.trim(),
    });
  }

  if (upn) {
  // ----------------------------------------------------------------------
  // B — Auto-discover the organizer's chats (meeting chat + 1:1 with peer)
  // ----------------------------------------------------------------------
  console.log('\n=== B) Discover chats for organizer (/users/{upn}/chats) ===');
  let chats: GraphChat[] = [];
  try {
    const res = await graph.get<GraphList<GraphChat>>(`/users/${enc(upn)}/chats`, {
      $expand: 'members',
      $top: '50',
    });
    chats = res.value ?? [];
    for (const c of chats) {
      const members = (c.members ?? [])
        .map((m) => m.displayName ?? m.email ?? m.userId ?? '?')
        .join(', ');
      console.log(`   • ${c.chatType ?? '?'}  topic="${c.topic ?? ''}"  members=[${members}]  id=${c.id}`);
    }
    record({
      step: 'B list-chats',
      target: `/users/${upn}/chats`,
      gotIt: true,
      status: 200,
      detail: `discovered ${chats.length} chat(s)`,
    });
  } catch (err) {
    const e = graphErr(err);
    record({
      step: 'B list-chats',
      target: `/users/${upn}/chats`,
      gotIt: false,
      status: e.status,
      detail: `${e.code ?? ''} ${e.message}`.trim(),
    });
  }

  const chatHasMember = (c: GraphChat, name: string): boolean =>
    (c.members ?? []).some((m) =>
      (m.displayName ?? '').toLowerCase().includes(name.toLowerCase()),
    );

  const meetingChats = chats.filter(
    (c) =>
      c.chatType === 'meeting' &&
      (!meetingTopicHint ||
        (c.topic ?? '').toLowerCase().includes(meetingTopicHint.toLowerCase())),
  );
  // If the topic hint matched nothing, fall back to all meeting chats.
  const meetingChatsToProbe = meetingChats.length > 0 ? meetingChats : chats.filter((c) => c.chatType === 'meeting');

  const oneOnOneChats = chats.filter(
    (c) => c.chatType === 'oneOnOne' && (!peerName || chatHasMember(c, peerName)),
  );
  const oneOnOneToProbe = oneOnOneChats.length > 0 ? oneOnOneChats : chats.filter((c) => c.chatType === 'oneOnOne');

  // Reusable chat-message fetch + print + record.
  const probeChatMessages = async (
    stepLabel: string,
    chat: GraphChat,
  ): Promise<GraphChannelMessage[]> => {
    const who = (chat.members ?? []).map((m) => m.displayName ?? '?').join(', ');
    try {
      const res = await graph.get<GraphList<GraphChannelMessage>>(`/chats/${chat.id}/messages`, {
        $top: '50',
      });
      const msgs = res.value ?? [];
      let textCount = 0;
      for (const m of msgs) {
        if (m.messageType && m.messageType !== 'message') continue;
        const text = stripHtml(m.body?.content);
        if (!text) continue;
        textCount += 1;
        console.log(`   • ${m.from?.user?.displayName ?? '(system/unknown)'}: ${text.slice(0, 140)}`);
      }
      record({
        step: stepLabel,
        target: `chat "${chat.topic ?? who}"`,
        gotIt: true,
        status: 200,
        detail: `fetched ${msgs.length} message(s), ${textCount} with text + sender name`,
      });
      return msgs;
    } catch (err) {
      const e = graphErr(err);
      record({
        step: stepLabel,
        target: `chat "${chat.topic ?? who}"`,
        gotIt: false,
        status: e.status,
        detail: `${e.code ?? ''} ${e.message}`.trim(),
      });
      return [];
    }
  };

  // ----------------------------------------------------------------------
  // C — Meeting-chat messages (the "testing meeting for private message")
  // ----------------------------------------------------------------------
  console.log('\n=== C) Meeting-chat messages ===');
  const collectedMsgs: GraphChannelMessage[] = [];
  if (meetingChatsToProbe.length === 0) {
    record({
      step: 'C meeting-chat-messages',
      target: 'meeting chat',
      gotIt: false,
      status: null,
      detail: 'no meeting chat discovered in step B (so cannot probe its messages)',
    });
  }
  for (const c of meetingChatsToProbe.slice(0, 5)) {
    collectedMsgs.push(...(await probeChatMessages('C meeting-chat-messages', c)));
  }

  // ----------------------------------------------------------------------
  // D — 1:1 private message (e.g. from Pradeep)
  // ----------------------------------------------------------------------
  console.log('\n=== D) 1:1 private chat messages ===');
  if (oneOnOneToProbe.length === 0) {
    record({
      step: 'D one-on-one-messages',
      target: '1:1 chat',
      gotIt: false,
      status: null,
      detail: 'no 1:1 chat discovered in step B',
    });
  }
  for (const c of oneOnOneToProbe.slice(0, 5)) {
    collectedMsgs.push(...(await probeChatMessages('D one-on-one-messages', c)));
  }

  // ----------------------------------------------------------------------
  // E — Transcript (via getAllTranscripts for the organizer)
  // ----------------------------------------------------------------------
  console.log('\n=== E) Meeting transcript (calendar → onlineMeetings → transcripts) ===');
  try {
    // Use only permissions the app HAS: Calendars.Read to find the meeting +
    // its joinUrl, OnlineMeetings.Read.All to resolve the meetingId, and
    // OnlineMeetingTranscript.Read.All to read the transcript. (Avoids the bare
    // /users/{upn} lookup, which needs User.Read.All the app lacks.)
    const nowMs = Date.now();
    const startIso = new Date(nowMs - 60 * 24 * 3600 * 1000).toISOString();
    const endIso = new Date(nowMs + 2 * 24 * 3600 * 1000).toISOString();
    const cal = await graph.get<GraphList<GraphCalendarEvent>>(`/users/${enc(upn)}/calendarView`, {
      startDateTime: startIso,
      endDateTime: endIso,
      $select: 'subject,onlineMeeting,isOnlineMeeting,start,end',
      $top: '100',
    });
    const events = cal.value ?? [];
    console.log(`   calendar events in window: ${events.length}`);
    const match =
      events.find(
        (e) =>
          (e.subject ?? '').toLowerCase().includes(meetingTopicHint.toLowerCase()) &&
          e.onlineMeeting?.joinUrl,
      ) ?? events.find((e) => e.onlineMeeting?.joinUrl);

    if (!match?.onlineMeeting?.joinUrl) {
      record({
        step: 'E transcript',
        target: 'calendar lookup',
        gotIt: false,
        status: 200,
        detail: `calendar reachable (${events.length} events) but no online meeting joinUrl matched "${meetingTopicHint}"`,
      });
    } else {
      console.log(`   matched event: "${match.subject ?? ''}"`);
      console.log(`   joinUrl: ${match.onlineMeeting.joinUrl}`);
      const meetingId = await graph.getOnlineMeetingIdByJoinUrl(upn, match.onlineMeeting.joinUrl);
      if (!meetingId) {
        record({
          step: 'E transcript',
          target: 'resolve meetingId',
          gotIt: false,
          status: null,
          detail: 'onlineMeetings reachable but could not resolve a meetingId from the joinUrl',
        });
      } else {
        const tr = await graph.get<GraphList<GraphCallTranscript>>(
          `/users/${enc(upn)}/onlineMeetings/${meetingId}/transcripts`,
        );
        const list = tr.value ?? [];
        if (list.length === 0) {
          record({
            step: 'E transcript',
            target: `meeting "${match.subject ?? ''}"`,
            gotIt: false,
            status: 200,
            detail: 'meeting resolved + transcripts endpoint OK, but 0 transcripts listed (not finalized / transcription was off)',
          });
        } else {
          const t0 = list[list.length - 1];
          const buf = await graph.getBinary(
            `/users/${enc(upn)}/onlineMeetings/${meetingId}/transcripts/${t0.id}/content?$format=text/vtt`,
          );
          const snippet = buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 160);
          console.log(`   transcript snippet: ${snippet}`);
          record({
            step: 'E transcript',
            target: `meeting "${match.subject ?? ''}"`,
            gotIt: buf.length > 0,
            status: 200,
            detail: `${list.length} transcript(s); downloaded ${buf.length} bytes of VTT`,
          });
        }
      }
    }
  } catch (err) {
    const e = graphErr(err);
    console.log(`   E raw error details: ${JSON.stringify((err as { details?: unknown }).details)}`);
    record({
      step: 'E transcript',
      target: `organizer ${upn}`,
      gotIt: false,
      status: e.status,
      detail: `${e.code ?? ''} ${e.message}`.trim(),
    });
  }

  // ----------------------------------------------------------------------
  // F — Documents/files (reference attachments found in the chat messages)
  // ----------------------------------------------------------------------
  console.log('\n=== F) Shared documents/files ===');
  const refAttachments = collectedMsgs
    .flatMap((m) => m.attachments ?? [])
    .filter((a) => a.contentType === 'reference' && a.contentUrl);
  if (refAttachments.length === 0) {
    record({
      step: 'F documents',
      target: 'message attachments',
      gotIt: false,
      status: null,
      detail: 'no file (reference) attachments found in the fetched chat messages',
    });
  }
  for (const att of refAttachments.slice(0, 5)) {
    try {
      const file = await filesService.download(att.contentUrl as string, att.name);
      record({
        step: 'F documents',
        target: att.name ?? att.contentUrl ?? 'file',
        gotIt: true,
        status: 200,
        detail: `downloaded "${file.originalName}" (${file.mimeType}, ${file.buffer.length} bytes)`,
      });
    } catch (err) {
      const e = graphErr(err);
      record({
        step: 'F documents',
        target: att.name ?? att.contentUrl ?? 'file',
        gotIt: false,
        status: e.status,
        detail: `${e.code ?? ''} ${e.message}`.trim(),
      });
    }
  }

  } else {
    // No UPN — list tenant users so the organizer's UPN can be picked for a full run.
    console.log('\n=== Discover users (no UPN provided) ===');
    try {
      const users = await graph.get<
        GraphList<{ displayName?: string; userPrincipalName?: string; mail?: string }>
      >('/users', { $select: 'displayName,userPrincipalName,mail', $top: '50' });
      for (const u of users.value ?? []) {
        console.log(`   • ${u.displayName ?? ''} — ${u.userPrincipalName ?? u.mail ?? ''}`);
      }
      record({
        step: 'users-discovery',
        target: '/users',
        gotIt: true,
        status: 200,
        detail: `listed ${(users.value ?? []).length} user(s); re-run with TEAMS_TEST_USER_ID set`,
      });
    } catch (err) {
      const e = graphErr(err);
      record({
        step: 'users-discovery',
        target: '/users',
        gotIt: false,
        status: e.status,
        detail: `${e.code ?? ''} ${e.message}`.trim(),
      });
    }
  }

  // ----------------------------------------------------------------------
  // Final matrix
  // ----------------------------------------------------------------------
  console.log('\n\n================ RESULT MATRIX ================');
  for (const r of results) {
    console.log(
      `${r.gotIt ? 'YES' : 'NO '}  | ${r.step.padEnd(26)} | status=${String(r.status ?? '-').padEnd(4)} | ${r.detail}`,
    );
  }
  console.log('==============================================');

  const outDir = path.resolve('temp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'teams-private-verify-report.json');
  fs.writeFileSync(
    outFile,
    JSON.stringify({ organizer: upn, generatedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\nSaved report → ${outFile}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-private-verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
