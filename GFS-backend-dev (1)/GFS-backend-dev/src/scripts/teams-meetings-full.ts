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
 * READ-ONLY: for every meeting in the 3 "Testing team" teams' channels, fetch
 *   - transcript (full VTT, saved to temp/meetings/)
 *   - recording (channel SharePoint Recordings folder + onlineMeetings/recordings)
 *   - meeting chat (replies under the meeting's channel message)
 *   - shared documents (channel Files)
 * Discovery via meetingReference attachments; resolve via organizer GUID.
 *
 * Run:
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-meetings-full.ts
 */

interface MeetingRef {
  joinUrl: string;
  organizerId: string;
  rootMsgId: string;
  when: string;
}

const stripHtml = (h?: string | null): string =>
  (h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const graphErr = (err: unknown): string => {
  const e = err as { statusCode?: number; message?: string; details?: unknown };
  const inner = (e?.details as { error?: { code?: string; message?: string } } | undefined)?.error;
  return `${e?.statusCode ?? '?'} ${inner?.code ?? ''} ${inner?.message ?? e?.message ?? ''}`.trim();
};

const speakers = (vtt: string): string[] => {
  const set = new Set<string>();
  for (const m of vtt.matchAll(/<v ([^>]+)>/g)) set.add(m[1]);
  return [...set];
};

const main = async (): Promise<void> => {
  const ts = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId, clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId, authority: env.teams.authority, scope: env.teams.scope,
  });
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(ts, env.teams.graphBaseUrl);

  const outDir = path.resolve('temp', 'meetings');
  fs.mkdirSync(outDir, { recursive: true });

  const allTeams = await graph.getAllPages<GraphTeam>('/teams');
  const teams = allTeams.filter((t) => /testing team/i.test(t.displayName));
  console.log(`\nProcessing ${teams.length} team(s): ${teams.map((t) => t.displayName).join(', ')}\n`);

  const summary: unknown[] = [];

  for (const team of teams) {
    console.log(`\n############ TEAM: ${team.displayName} ############`);
    const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);

    for (const ch of channels) {
      console.log(`\n=== CHANNEL: ${team.displayName} › ${ch.displayName} ===`);

      // ---- channel Recordings folder (channel-meeting recordings land here) ----
      const recordings: Array<{ name: string; size: number; downloaded?: number }> = [];
      try {
        const ff = await graph.get<{ parentReference?: { driveId?: string }; id?: string }>(
          `/teams/${team.id}/channels/${ch.id}/filesFolder`,
        );
        const driveId = ff.parentReference?.driveId;
        if (driveId && ff.id) {
          const kids = await graph.get<GraphList<{ id: string; name?: string; folder?: unknown }>>(
            `/drives/${driveId}/items/${ff.id}/children`,
          );
          const recFolder = (kids.value ?? []).find((k) => /recording/i.test(k.name ?? '') && k.folder);
          if (recFolder) {
            const recs = await graph.get<GraphList<{ id: string; name?: string; size?: number; file?: unknown }>>(
              `/drives/${driveId}/items/${recFolder.id}/children`,
            );
            for (const r of recs.value ?? []) {
              if (!r.file) continue;
              let downloaded: number | undefined;
              try {
                const buf = await graph.getBinary(`/drives/${driveId}/items/${r.id}/content`);
                downloaded = buf.length;
              } catch { /* skip download */ }
              recordings.push({ name: r.name ?? '?', size: r.size ?? 0, downloaded });
            }
          }
        }
      } catch (err) {
        console.log(`   recordings folder: ${graphErr(err)}`);
      }
      if (recordings.length) {
        console.log(`   🎥 Recordings (${recordings.length}):`);
        for (const r of recordings) console.log(`      • ${r.name} (${r.size} bytes${r.downloaded ? `, downloaded ${r.downloaded}` : ''})`);
      } else {
        console.log(`   🎥 Recordings: none`);
      }

      // ---- messages → meeting references + meeting chat (replies) ----
      const msgs = await graph.getAllPages<GraphChannelMessage>(
        `/teams/${team.id}/channels/${ch.id}/messages`,
      );
      const meetings: MeetingRef[] = [];
      for (const msg of msgs) {
        for (const att of msg.attachments ?? []) {
          if (att.contentType !== 'meetingReference' || !att.contentUrl && !(att as { content?: string }).content) continue;
          const raw = (att as { content?: string }).content ?? '';
          try {
            const j = JSON.parse(raw) as { meetingJoinUrl?: string; organizerId?: string };
            if (j.meetingJoinUrl) {
              meetings.push({
                joinUrl: j.meetingJoinUrl,
                organizerId: j.organizerId ?? '',
                rootMsgId: msg.id,
                when: (msg.createdDateTime ?? '').slice(0, 16).replace('T', ' '),
              });
            }
          } catch { /* ignore parse */ }
        }
      }
      // dedup by joinUrl
      const seen = new Set<string>();
      const uniqueMeetings = meetings.filter((m) => (seen.has(m.joinUrl) ? false : (seen.add(m.joinUrl), true)));
      console.log(`   📅 Meetings discovered: ${uniqueMeetings.length}`);

      const meetingResults: unknown[] = [];
      let idx = 0;
      for (const mt of uniqueMeetings) {
        idx += 1;
        const guid = mt.organizerId || (await graph.resolveUserId('gfs2@amberflux.in'));

        // meeting chat = replies under the root channel message
        const replyTexts: string[] = [];
        try {
          const replies = await graph.getAllPages<GraphChannelMessage>(
            `/teams/${team.id}/channels/${ch.id}/messages/${mt.rootMsgId}/replies`,
          );
          for (const r of replies) {
            const t = stripHtml(r.body?.content);
            if (t) replyTexts.push(`${r.from?.user?.displayName ?? '?'}: ${t}`);
          }
        } catch { /* ignore */ }

        // resolve onlineMeeting id
        let meetingId = '';
        for (const cand of [mt.joinUrl, decodeURIComponent(mt.joinUrl)]) {
          try {
            const om = await graph.get<GraphList<{ id: string }>>(`/users/${guid}/onlineMeetings`, {
              $filter: `JoinWebUrl eq '${cand}'`,
            });
            if (om.value?.[0]?.id) { meetingId = om.value[0].id; break; }
          } catch { /* try next */ }
        }

        let transcriptInfo = 'no meetingId resolved';
        let transcriptSpeakers: string[] = [];
        let transcriptFile = '';
        if (meetingId) {
          try {
            const tr = await graph.get<GraphList<{ id: string }>>(
              `/users/${guid}/onlineMeetings/${meetingId}/transcripts`,
            );
            const list = tr.value ?? [];
            if (list.length === 0) {
              transcriptInfo = 'meeting resolved, 0 transcripts (transcription was off)';
            } else {
              const t0 = list[list.length - 1];
              const buf = await graph.getBinary(
                `/users/${guid}/onlineMeetings/${meetingId}/transcripts/${t0.id}/content?$format=text/vtt`,
              );
              const vtt = buf.toString('utf8');
              transcriptSpeakers = speakers(vtt);
              transcriptFile = path.join(outDir, `${team.displayName}_${ch.displayName}_${idx}.vtt`.replace(/[^\w.-]+/g, '_'));
              fs.writeFileSync(transcriptFile, vtt);
              transcriptInfo = `✅ ${vtt.length} bytes, speakers=[${transcriptSpeakers.join(', ')}]`;
            }
          } catch (err) {
            transcriptInfo = `transcript err: ${graphErr(err)}`;
          }
        }

        console.log(`   ── Meeting ${idx} (${mt.when})`);
        console.log(`        chat replies : ${replyTexts.length}${replyTexts.length ? ' → ' + replyTexts.slice(0, 6).map((r) => r.slice(0, 60)).join(' | ') : ''}`);
        console.log(`        transcript   : ${transcriptInfo}`);

        meetingResults.push({
          when: mt.when,
          meetingResolved: !!meetingId,
          transcript: transcriptInfo,
          speakers: transcriptSpeakers,
          transcriptFile: transcriptFile ? path.basename(transcriptFile) : null,
          chatReplies: replyTexts,
        });
      }

      summary.push({
        team: team.displayName,
        channel: ch.displayName,
        recordings,
        meetingCount: uniqueMeetings.length,
        meetings: meetingResults,
      });
    }
  }

  const outFile = path.resolve('temp', 'teams-meetings-full.json');
  fs.writeFileSync(outFile, JSON.stringify({ tenant: env.teams.tenantId, generatedAt: new Date().toISOString(), summary }, null, 2));
  console.log(`\n\nSaved meeting report → ${outFile}`);
  console.log(`Transcripts (VTT) saved under → ${outDir}`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-meetings-full failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
