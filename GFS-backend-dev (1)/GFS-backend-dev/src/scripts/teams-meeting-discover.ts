import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { MongooseTeamsTranscriptRepository } from '@repositories/mongoose/teams-transcript.repository';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import { TeamsAssociationService } from '@features/teams/teams-association.service';
import { LoggingDocumentIngestionPort } from '@features/teams/document-ingestion.port';
import { TeamsTranscriptsService } from '@features/teams/teams-transcripts.service';
import { TeamsMeetingsService } from '@features/teams/teams-meetings.service';
import { MongooseTeamsMeetingRepository } from '@repositories/mongoose/teams-meeting.repository';
import { MongooseTeamsMessageRepository } from '@repositories/mongoose/teams-message.repository';
import { MongooseTeamsMonitoredChannelRepository } from '@repositories/mongoose/teams-monitored-channel.repository';
import { MongooseDocumentRepository } from '@repositories/mongoose/document.repository';
import type { GraphChannel, GraphList, GraphTeam } from '@features/teams/teams.types';

// Diagnostic discovery script: scans all channels (root messages + replies)
// for meeting-event messages, dumps the full eventDetail JSON, extracts any
// candidates we can try as a meetingId (eventDetail.meetingId, callId, or
// joinUrl resolved via the onlineMeetings $filter), then tries each candidate
// against the transcripts endpoint.

interface RawMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  eventDetail?: Record<string, unknown> | null;
  body?: { content?: string };
  attachments?: Array<{
    id?: string;
    contentType?: string;
    content?: string | null;
    name?: string;
  }>;
}

const findJoinUrl = (text?: string): string | undefined => {
  if (!text) return undefined;
  const m = text.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/);
  return m ? m[0] : undefined;
};

const main = async (): Promise<void> => {
  const userIdEnv = process.env['TEAMS_TEST_USER_ID'];
  if (!userIdEnv) {
    console.error('Set TEAMS_TEST_USER_ID (e.g. jamunesh@amberflux123.onmicrosoft.com).');
    process.exit(1);
  }

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

  console.log(`Scanning ${teams.length} team(s)…`);

  const meetingIdCandidates = new Map<string, string>(); // id → source/where
  const joinUrlCandidates = new Set<string>();
  const organizerIds = new Set<string>();

  const inspect = (m: RawMessage, where: string): void => {
    if (m.eventDetail) {
      const t = (m.eventDetail['@odata.type'] as string | undefined) ?? '(unknown)';
      console.log(`\n[${where}] event=${t.replace('#microsoft.graph.', '')}`);
      console.log(`  raw eventDetail = ${JSON.stringify(m.eventDetail)}`);
      const mid = m.eventDetail['meetingId'] as string | undefined;
      const cid = m.eventDetail['callId'] as string | undefined;
      if (mid) meetingIdCandidates.set(mid, `${where} eventDetail.meetingId`);
      if (cid) meetingIdCandidates.set(cid, `${where} eventDetail.callId`);
      // Capture the organizer's AAD user id — needed for getAllTranscripts.
      const organizer = m.eventDetail['meetingOrganizer'] as
        | { user?: { id?: string } }
        | undefined;
      if (organizer?.user?.id) organizerIds.add(organizer.user.id);
    }

    const bodyJoinUrl = findJoinUrl(m.body?.content);
    if (bodyJoinUrl) joinUrlCandidates.add(bodyJoinUrl);

    for (const att of m.attachments ?? []) {
      const fromContent = findJoinUrl(att.content ?? undefined);
      if (fromContent) joinUrlCandidates.add(fromContent);
      if (att.contentType && /(meeting|schedule)/i.test(att.contentType)) {
        console.log(
          `  attachment[contentType=${att.contentType}] name=${att.name ?? ''} snippet=${(att.content ?? '').slice(0, 200)}`,
        );
      }
    }
  };

  for (const team of teams) {
    const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);
    for (const ch of channels) {
      console.log(`\n=== ${team.displayName} / ${ch.displayName} ===`);
      const res = await graph.get<GraphList<RawMessage>>(
        `/teams/${team.id}/channels/${ch.id}/messages`,
        { $top: '50' },
      );
      for (const m of res.value ?? []) {
        inspect(m, `root@${m.createdDateTime ?? ''}`);
        try {
          const replies = await graph.get<GraphList<RawMessage>>(
            `/teams/${team.id}/channels/${ch.id}/messages/${m.id}/replies`,
            { $top: '50' },
          );
          for (const r of replies.value ?? []) inspect(r, `reply@${r.createdDateTime ?? ''}`);
        } catch {
          /* ignore replies fetch errors */
        }
      }
    }
  }

  // ⭐ For channel meetings the only reliable way to map callId → real
  // onlineMeeting.id is via the Graph getAllTranscripts function, which lists
  // every transcript and exposes the parent meetingId directly. Try v1.0 first,
  // then fall back to beta.
  for (const orgId of organizerIds) {
    const paths = [
      `/users/${orgId}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${orgId}')`,
      `/users/${orgId}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId=%27${orgId}%27)`,
      `/communications/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${orgId}')`,
      `https://graph.microsoft.com/beta/users/${orgId}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${orgId}')`,
      `https://graph.microsoft.com/beta/communications/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${orgId}')`,
    ];
    for (const p of paths) {
      try {
        const r = await graph.get<GraphList<{ id: string; meetingId?: string; meetingOrganizerId?: string }>>(p);
        const found = r.value ?? [];
        console.log(`\ngetAllTranscripts via ${p.includes('/beta/') ? 'beta' : 'v1.0'} → ${found.length} transcript(s) for organizer ${orgId}`);
        for (const t of found) {
          if (t.meetingId) {
            meetingIdCandidates.set(t.meetingId, `getAllTranscripts (organizer=${orgId})`);
          }
        }
        if (found.length > 0) break; // first working path wins
      } catch (err) {
        const e = err as { message?: string };
        console.log(`  ! ${p.slice(0, 100)}… failed: ${e.message ?? err}`);
      }
    }
  }

  // Try to resolve any join URLs we found into proper meetingIds.
  for (const url of joinUrlCandidates) {
    try {
      const r = await graph.get<GraphList<{ id: string; subject?: string }>>(
        `/users/${encodeURIComponent(userIdEnv)}/onlineMeetings`,
        { $filter: `joinWebUrl eq '${url}'` },
      );
      for (const meeting of r.value ?? []) {
        meetingIdCandidates.set(meeting.id, `joinUrl filter (${meeting.subject ?? ''})`);
      }
    } catch (err) {
      const e = err as { message?: string };
      console.log(`  ! joinUrl filter failed for ${url.slice(0, 80)}…: ${e.message ?? err}`);
    }
  }

  console.log(`\n\n--- Candidates collected ---`);
  console.log(`joinUrls: ${joinUrlCandidates.size}`);
  for (const u of joinUrlCandidates) console.log(`  ${u}`);
  console.log(`meetingId candidates: ${meetingIdCandidates.size}`);
  for (const [id, src] of meetingIdCandidates) console.log(`  ${id}   (${src})`);

  if (meetingIdCandidates.size === 0) {
    console.log('\nNo candidates. Cannot attempt transcript fetch.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const transcriptRepo = new MongooseTeamsTranscriptRepository();
  const projectRepo = new MongooseProjectRepository();
  const association = new TeamsAssociationService(projectRepo);
  const port = new LoggingDocumentIngestionPort();
  const meetingsService = new TeamsMeetingsService(
    new MongooseTeamsMeetingRepository(),
    transcriptRepo,
    new MongooseTeamsMessageRepository(),
    new MongooseDocumentRepository(),
    new MongooseTeamsMonitoredChannelRepository(),
  );
  const service = new TeamsTranscriptsService(
    graph,
    transcriptRepo,
    projectRepo,
    association,
    port,
    meetingsService,
    true,
  );

  const userIdsToTry = Array.from(new Set([...organizerIds, userIdEnv]));
  console.log(`\nUserIds to try: ${userIdsToTry.join(', ')}`);

  console.log(`\nAttempting transcript fetch for each candidate…`);
  for (const [id, source] of meetingIdCandidates) {
    console.log(`\n=== meetingId=${id}  (${source}) ===`);
    let ok = false;
    for (const uid of userIdsToTry) {
      console.log(`  trying userId=${uid}`);
      try {
        const summary = await service.fetchAndStore({ userId: uid, meetingId: id });
        console.log(JSON.stringify(summary, null, 2));
        ok = true;
        break;
      } catch (err) {
        const e = err as { message?: string; details?: unknown };
        console.log(`    ✗ ${e.message ?? String(err)}`);
        if (e.details) console.log(`      details: ${JSON.stringify(e.details)}`);
      }
    }
    if (!ok) console.log(`  → all userIds failed for this meetingId`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('discover failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
