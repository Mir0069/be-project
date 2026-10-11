import fs from 'fs';
import path from 'path';

import axios from 'axios';

import { env } from '@config/index';

/**
 * DELEGATED (user sign-in) transcript fetch — reproduces the flow that worked
 * before: a Microsoft login screen appears, you sign in as the meeting
 * organizer (jamunesh), and we read that user's OWN meetings' transcripts.
 *
 * Delegated access does NOT require the Teams application-access-policy that
 * app-only (client-credentials) access needs — which is why this works while
 * the app-only scripts return 404.
 *
 * Uses the OAuth 2.0 DEVICE CODE flow (no redirect URI / web server needed):
 *   1. We request a device code → print a URL + short code.
 *   2. You open the URL, enter the code, sign in as jamunesh.
 *   3. We poll for the token, then call Graph as that user.
 *
 * App-registration prerequisites (Entra → your Teams app c59168ad-…):
 *   • Authentication → "Allow public client flows" = Yes.
 *   • API permissions → add DELEGATED: OnlineMeetings.Read,
 *     OnlineMeetingTranscript.Read.All, User.Read (+ Chat.Read optional).
 *
 * Run:
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-delegated-transcript.ts
 */

const TENANT = env.teams.tenantId;
const CLIENT_ID = env.teams.clientId;
const AUTHORITY = env.teams.authority; // https://login.microsoftonline.com
const GRAPH = env.teams.graphBaseUrl; // https://graph.microsoft.com/v1.0

const SCOPES =
  process.env['TEAMS_DELEGATED_SCOPES'] ??
  [
    'offline_access',
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Calendars.Read',
    'https://graph.microsoft.com/OnlineMeetings.Read',
    'https://graph.microsoft.com/OnlineMeetingTranscript.Read.All',
  ].join(' ');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const safeFileName = (s: string): string =>
  (s.trim() || 'meeting').replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 80);

// Convert WebVTT → readable, speaker-attributed plain text ("Name: words").
// Drops the WEBVTT header, cue numbers and timestamps; merges consecutive lines
// from the same speaker.
const vttToText = (vtt: string): string => {
  const out: string[] = [];
  let lastSpeaker = '';
  for (const raw of vtt.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t === 'WEBVTT' || t.includes('-->') || /^\d+$/.test(t)) continue;
    const m = t.match(/<v\s+([^>]+)>([\s\S]*?)<\/v>/);
    if (m) {
      const speaker = (m[1] ?? '').trim();
      const text = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
      if (!text) continue;
      if (speaker === lastSpeaker && out.length) out[out.length - 1] += ` ${text}`;
      else {
        out.push(`${speaker}: ${text}`);
        lastSpeaker = speaker;
      }
    } else {
      const text = t.replace(/<[^>]+>/g, '').trim();
      if (text) {
        out.push(text);
        lastSpeaker = '';
      }
    }
  }
  return out.join('\n');
};

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message?: string;
}
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface GraphList<T> {
  value: T[];
}
interface CalEvent {
  subject?: string | null;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  start?: { dateTime?: string } | null;
}

const main = async (): Promise<void> => {
  if (!CLIENT_ID || !TENANT) {
    console.error('TEAMS_CLIENT_ID / TEAMS_TENANT_ID missing in .env');
    process.exit(1);
  }

  // Reuse a cached delegated token if it's still valid — so re-runs within the
  // hour skip the login entirely.
  const TOKEN_CACHE = path.join(path.resolve('temp'), '.delegated-token.json');
  const saveToken = (at: string, rt: string, expiresIn: number): void => {
    try {
      fs.mkdirSync(path.resolve('temp'), { recursive: true });
      fs.writeFileSync(
        TOKEN_CACHE,
        JSON.stringify({
          accessToken: at,
          refreshToken: rt,
          expiresAt: Date.now() + expiresIn * 1000,
        }),
      );
    } catch {
      /* cache is best-effort */
    }
  };
  let accessToken = '';
  let refreshToken = '';
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')) as {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
    refreshToken = c.refreshToken ?? '';
    if (c.accessToken && (c.expiresAt ?? 0) - 120000 > Date.now()) {
      accessToken = c.accessToken;
      console.log('♻️  Reusing cached sign-in (still valid) — no login needed.\n');
    }
  } catch {
    /* no cache yet */
  }

  // Access token stale but we have a refresh token → renew silently, no login.
  if (!accessToken && refreshToken) {
    try {
      const r = await axios.post<TokenResponse>(
        `${AUTHORITY}/${TENANT}/oauth2/v2.0/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
          scope: SCOPES,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      if (r.data.access_token) {
        accessToken = r.data.access_token;
        refreshToken = r.data.refresh_token ?? refreshToken; // tokens rotate — keep the new one
        saveToken(accessToken, refreshToken, r.data.expires_in ?? 3600);
        console.log('♻️  Renewed sign-in silently (refresh token) — no login needed.\n');
      }
    } catch {
      console.log('Refresh token expired/invalid — falling back to sign-in.\n');
      refreshToken = '';
    }
  }

  if (!accessToken) {
    // 1) Request a device code.
    const dcRes = await axios.post<DeviceCodeResponse>(
      `${AUTHORITY}/${TENANT}/oauth2/v2.0/devicecode`,
      new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const dc = dcRes.data;

    console.log('\n==================================================================');
    console.log('  SIGN IN TO GET TRANSCRIPTS (delegated)');
    console.log('==================================================================');
    console.log(`  1. Open:  ${dc.verification_uri}`);
    console.log(`  2. Enter code:  ${dc.user_code}`);
    console.log(`  3. Sign in as the meeting organizer (jamunesh@amberflux123.onmicrosoft.com)`);
    console.log('==================================================================\n');
    console.log('Waiting for you to complete sign-in…');

    // 2) Poll for the token until the user signs in (or it expires).
    let interval = (dc.interval ?? 5) * 1000;
    let expiresIn = 3600;
    const deadline = Date.now() + (dc.expires_in ?? 900) * 1000;
    while (Date.now() < deadline) {
      await sleep(interval);
      try {
        // Device-code is a PUBLIC-client flow: no client_secret is sent. The app
        // must have "Allow public client flows = Yes" in Entra for this to work.
        const tok = await axios.post<TokenResponse>(
          `${AUTHORITY}/${TENANT}/oauth2/v2.0/token`,
          new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: CLIENT_ID,
            device_code: dc.device_code,
          }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );
        if (tok.data.access_token) {
          accessToken = tok.data.access_token;
          refreshToken = tok.data.refresh_token ?? '';
          expiresIn = tok.data.expires_in ?? 3600;
          break;
        }
      } catch (err) {
        const e = (err as { response?: { data?: TokenResponse } }).response?.data;
        if (e?.error === 'authorization_pending') continue; // keep waiting
        if (e?.error === 'slow_down') {
          interval += 5000;
          continue;
        }
        console.error(`\nSign-in failed: ${e?.error} — ${e?.error_description ?? ''}`);
        process.exit(1);
      }
    }
    if (!accessToken) {
      console.error('\nTimed out waiting for sign-in.');
      process.exit(1);
    }
    // Cache the token (+ refresh token) so future runs skip the login entirely.
    saveToken(accessToken, refreshToken, expiresIn);
  }
  console.log('\n✅ Signed in. Reading your meetings & transcripts…\n');
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64').toString('utf8'),
    ) as { scp?: string };
    console.log(`Token scopes: ${payload.scp ?? '(none found)'}\n`);
  } catch {
    console.log('(could not decode token scopes)\n');
  }

  const g = axios.create({
    baseURL: GRAPH,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
  });
  const getErr = (err: unknown): string => {
    const e = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })
      .response;
    return `${e?.status ?? ''} ${e?.data?.error?.message ?? (err as Error).message}`.trim();
  };

  // Who am I?
  let upn = process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com';
  try {
    const me = await g.get<{ displayName?: string; userPrincipalName?: string }>(
      '/me?$select=displayName,userPrincipalName',
    );
    if (me.data.userPrincipalName) upn = me.data.userPrincipalName;
    console.log(`Signed in as: ${me.data.displayName} <${me.data.userPrincipalName}>\n`);
  } catch (err) {
    console.error('Could not read /me:', getErr(err));
  }

  // Discover meetings via an APP-ONLY token (Calendars.Read application — this
  // reliably returns the meetings; the delegated /me/calendarView came back
  // empty). We only use it to get join URLs; transcripts are read with the
  // DELEGATED token below (which needs no app-access-policy).
  const startIso = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  const endIso = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  let events: CalEvent[] = [];
  try {
    const appTok = await axios.post<TokenResponse>(
      `${AUTHORITY}/${TENANT}/oauth2/v2.0/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: env.teams.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const gApp = axios.create({
      baseURL: GRAPH,
      headers: { Authorization: `Bearer ${appTok.data.access_token}` },
      timeout: 30000,
    });
    const calRes = await gApp.get<GraphList<CalEvent>>(
      `/users/${encodeURIComponent(upn)}/calendarView`,
      {
        params: {
          startDateTime: startIso,
          endDateTime: endIso,
          $select: 'subject,onlineMeeting,isOnlineMeeting,start',
          $top: '500',
        },
      },
    );
    const all = calRes.data.value ?? [];
    console.log(`Calendar (app-only) returned ${all.length} event(s):`);
    for (const e of all) {
      console.log(
        `   - "${(e.subject ?? '').trim()}"  start=${e.start?.dateTime?.slice(0, 16) ?? '?'}  joinUrl=${e.onlineMeeting?.joinUrl ? 'yes' : 'no'}`,
      );
    }
    events = all.filter((e) => e.onlineMeeting?.joinUrl);
  } catch (err) {
    console.error('calendar discovery failed:', getErr(err));
  }
  console.log(`\nFound ${events.length} online meeting(s) with a join link.\n`);

  const txtDir = path.join(path.resolve('temp'), 'transcripts');
  fs.mkdirSync(txtDir, { recursive: true });

  const out: Array<Record<string, unknown>> = [];
  for (const [index, ev] of events.entries()) {
    const subject = (ev.subject ?? '(no subject)').trim();
    const joinUrl = ev.onlineMeeting?.joinUrl ?? '';
    console.log(`→ "${subject}" — resolving meeting + transcript…`);
    try {
      // Resolve the onlineMeeting id (delegated — your own meeting, no policy
      // needed). Try the join URL as-is then decoded, to dodge encoding misses.
      let meetingId: string | undefined;
      for (const candidate of [joinUrl, safeDecode(joinUrl)]) {
        const omRes = await g.get<GraphList<{ id: string }>>('/me/onlineMeetings', {
          params: { $filter: `JoinWebUrl eq '${candidate}'` },
        });
        meetingId = omRes.data.value?.[0]?.id;
        if (meetingId) break;
      }
      if (!meetingId) {
        console.log(`• "${subject}" — no onlineMeeting matched (you may not be the organizer)`);
        out.push({ subject, transcript: 'no onlineMeeting match' });
        continue;
      }
      const trRes = await g.get<GraphList<{ id: string; transcriptContentUrl?: string }>>(
        `/me/onlineMeetings/${meetingId}/transcripts`,
      );
      const list = trRes.data.value ?? [];
      if (list.length === 0) {
        console.log(`• "${subject}" — 0 transcripts (recorded without transcription?)`);
        out.push({ subject, transcript: '0 transcripts' });
        continue;
      }
      const t0 = list[list.length - 1];
      if (!t0) continue;
      const contentRes = await g.get<string>(
        `/me/onlineMeetings/${meetingId}/transcripts/${t0.id}/content?$format=text/vtt`,
        { responseType: 'text' },
      );
      const vtt = String(contentRes.data ?? '');
      const plain = vttToText(vtt);
      const fname = safeFileName(subject || `meeting-${index + 1}`);
      const txtPath = path.join(txtDir, `${fname}.txt`);
      fs.writeFileSync(txtPath, plain, 'utf8');
      console.log(`• "${subject}" — ✅ TRANSCRIPT ${vtt.length} chars → ${txtPath}`);
      out.push({ subject, transcript: 'GOT IT', chars: vtt.length, txtFile: txtPath });
    } catch (err) {
      console.log(`• "${subject}" — ❌ ${getErr(err)}`);
      out.push({ subject, transcript: `error: ${getErr(err)}` });
    }
  }

  const outDir = path.resolve('temp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'teams-delegated-transcripts.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`Saved transcripts → ${outFile}`);
  process.exit(0);
};

main().catch((err) => {
  console.error('delegated transcript fetch failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
