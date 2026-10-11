import axios from 'axios';

import { env } from '@config/index';

/**
 * Quick, no-DB discovery: does this tenant actually HAVE any Teams data?
 * Lists teams + channel counts, and (if TEAMS_TEST_USER_ID is set) counts that
 * user's recent online meetings. Uses a direct app-only token — no MongoDB.
 *
 * Run:
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-discover-quick.ts
 */

interface GList<T> {
  value: T[];
}

const main = async (): Promise<void> => {
  const { clientId, clientSecret, tenantId, authority, graphBaseUrl } = env.teams;
  if (!clientId || !clientSecret || !tenantId) {
    console.error('TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET / TEAMS_TENANT_ID missing in .env');
    process.exit(1);
  }

  // 1. App-only token
  const tokenRes = await axios.post<{ access_token?: string }>(
    `${authority}/${tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const token = tokenRes.data.access_token ?? '';
  const g = axios.create({
    baseURL: graphBaseUrl,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
  const errInfo = (err: unknown): string => {
    const e = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })
      .response;
    return `${e?.status ?? ''} ${e?.data?.error?.message ?? (err as Error).message}`.trim();
  };

  // 2. List teams
  console.log(`Tenant: ${tenantId}\n`);
  let teams: { id: string; displayName?: string }[] = [];
  try {
    const res = await g.get<GList<{ id: string; displayName?: string }>>('/teams');
    teams = res.data.value ?? [];
  } catch (err) {
    console.error(`❌ /teams failed: ${errInfo(err)}`);
    process.exit(1);
  }

  console.log(`=== TEAMS FOUND: ${teams.length} ===`);
  if (teams.length === 0) {
    console.log('⚠️  No teams in this tenant — nobody is using Microsoft Teams here (no data to fetch).');
  }

  // 3. Channels per team
  for (const t of teams) {
    let channels: { id: string; displayName?: string }[] = [];
    try {
      const res = await g.get<GList<{ id: string; displayName?: string }>>(
        `/teams/${t.id}/channels`,
      );
      channels = res.data.value ?? [];
    } catch (err) {
      console.log(`  • ${t.displayName} — channels error: ${errInfo(err)}`);
      continue;
    }
    console.log(`  • ${t.displayName}  (${channels.length} channels)`);
    for (const c of channels) console.log(`       - ${c.displayName}`);
  }

  // 4. Optional: meetings for a given organizer
  const upn = process.env['TEAMS_TEST_USER_ID'];
  if (upn) {
    console.log(`\n=== Recent online meetings for ${upn} (last 30 days) ===`);
    const startIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const endIso = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
    try {
      const res = await g.get<GList<{ subject?: string; isOnlineMeeting?: boolean }>>(
        `/users/${encodeURIComponent(upn)}/calendarView`,
        { params: { startDateTime: startIso, endDateTime: endIso, $top: '50' } },
      );
      const events = res.data.value ?? [];
      const online = events.filter((e) => e.isOnlineMeeting);
      console.log(`   ${events.length} calendar events, ${online.length} online meetings`);
      online.slice(0, 20).forEach((e) => console.log(`     - ${e.subject || '(no subject)'}`));
    } catch (err) {
      console.log(`   ❌ calendarView failed: ${errInfo(err)}`);
    }
  } else {
    console.log('\n(set TEAMS_TEST_USER_ID to also count an organizer\'s meetings)');
  }
};

main().catch((err) => {
  console.error('discover failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
