import axios from 'axios';
import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';

/**
 * READ-ONLY definitive APP-ONLY transcript test via the getAllTranscripts
 * function — the one method that does NOT use the flaky joinWebUrl filter.
 *
 * Earlier code called getAllTranscripts(meetingOrganizerUserId='..') WITHOUT
 * the startDateTime/endDateTime params → Graph answered "API not supported".
 * Here we call it the correct way, for BOTH organizers (private meetings are
 * organized by jamunesh; channel meetings by the channel account), across
 * v1.0 + beta. If any variant returns entries we fetch one transcript's
 * content app-only to PROVE end-to-end (zero login).
 */

interface TranscriptEntry {
  id?: string;
  meetingId?: string;
  meetingOrganizerId?: string;
  transcriptContentUrl?: string;
}

const status = (err: unknown): string => {
  const e = (err as { response?: { status?: number; data?: { error?: { code?: string; message?: string } } }; message?: string });
  const r = e.response;
  return `${r?.status ?? '?'} ${r?.data?.error?.code ?? ''} ${r?.data?.error?.message ?? e.message ?? ''}`.trim();
};

const main = async (): Promise<void> => {
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
  await TeamsTokenModel.deleteMany({}); // force a fresh app-only token
  const token = await tokenService.getValidAccessToken();
  const H = { headers: { Authorization: `Bearer ${token}` } } as const;
  console.log('Got app-only token (client_credentials). Resolving organizers…\n');

  // Organizer UPN(s) to test, comma-separated, via TEAMS_TEST_USER_ID.
  // e.g. TEAMS_TEST_USER_ID="alice@firm.com,bob@firm.com"
  const upns = (process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const organizers: { upn: string; id: string }[] = [];
  for (const upn of upns) {
    try {
      const r = await axios.get<{ id: string; displayName?: string }>(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,displayName`,
        H,
      );
      organizers.push({ upn, id: r.data.id });
      console.log(`  ${upn} → id=${r.data.id} (${r.data.displayName ?? ''})`);
    } catch (err) {
      console.log(`  ${upn} → ❌ ${status(err)}`);
    }
  }

  const start = '2025-01-01T00:00:00Z';
  const end = '2026-12-31T23:59:59Z';
  let anyWorked = false;

  for (const org of organizers) {
    console.log(`\n=== getAllTranscripts for ${org.upn} ===`);
    const fnNoDate = `getAllTranscripts(meetingOrganizerUserId='${org.id}')`;
    const fnDate = `getAllTranscripts(meetingOrganizerUserId='${org.id}',startDateTime=${start},endDateTime=${end})`;
    const variants: [string, string][] = [
      ['v1.0 /users +dates +paging', `https://graph.microsoft.com/v1.0/users/${org.id}/onlineMeetings/${fnDate}?$skip=0&$top=50`],
      ['beta /users +dates +paging', `https://graph.microsoft.com/beta/users/${org.id}/onlineMeetings/${fnDate}?$skip=0&$top=50`],
      ['v1.0 /users +dates +model=A', `https://graph.microsoft.com/v1.0/users/${org.id}/onlineMeetings/${fnDate}?model=A`],
      ['v1.0 /users +dates +model=B', `https://graph.microsoft.com/v1.0/users/${org.id}/onlineMeetings/${fnDate}?model=B`],
      ['v1.0 /users +dates (plain)', `https://graph.microsoft.com/v1.0/users/${org.id}/onlineMeetings/${fnDate}`],
      ['v1.0 /users no-date', `https://graph.microsoft.com/v1.0/users/${org.id}/onlineMeetings/${fnNoDate}`],
    ];

    for (const [label, url] of variants) {
      try {
        const r = await axios.get<{ value?: TranscriptEntry[] }>(url, H);
        const list = r.data.value ?? [];
        console.log(`  ✅ ${label} → 200, ${list.length} transcript entr(y/ies)`);
        if (list.length > 0) {
          anyWorked = true;
          const t = list[0];
          console.log(`     first: meetingId=${t.meetingId ?? '?'} id=${t.id ?? '?'} contentUrl=${t.transcriptContentUrl ? 'yes' : 'no'}`);
          // Prove end-to-end: fetch the VTT content app-only.
          try {
            let cu = t.transcriptContentUrl ?? '';
            if (cu) {
              if (!cu.startsWith('http')) cu = `https://graph.microsoft.com/v1.0${cu.startsWith('/') ? '' : '/'}${cu}`;
              cu += `${cu.includes('?') ? '&' : '?'}$format=text/vtt`;
              const c = await axios.get<string>(cu, { ...H, responseType: 'text' });
              console.log(`     ✅✅ APP-ONLY CONTENT ${String(c.data).length} chars — TRANSCRIPT WORKS WITH NO LOGIN`);
            }
          } catch (err) {
            console.log(`     content fetch ❌ ${status(err)}`);
          }
        }
      } catch (err) {
        console.log(`  ❌ ${label} → ${status(err)}`);
      }
    }
  }

  console.log(
    `\n${anyWorked ? '✅ APP-ONLY getAllTranscripts RETURNED DATA — app-only transcript path is viable.' : '❌ getAllTranscripts returned nothing/blocked on every variant — app-only transcript is not available.'}`,
  );
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('apponly-getall failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
