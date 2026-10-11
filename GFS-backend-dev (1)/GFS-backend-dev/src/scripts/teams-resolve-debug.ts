import axios, { AxiosInstance } from 'axios';

import { env } from '@config/index';

/**
 * Debug WHY app-only onlineMeetings resolution returns 404. For each of gfs2's
 * meetings, tries several joinWebUrl variants AND VideoTeleconferenceId, printing
 * the FULL raw Graph error for each. No Mongo.
 */
interface GList<T> {
  value: T[];
}

const raw = (err: unknown): string => {
  const e = (err as { response?: { status?: number; data?: unknown } }).response;
  return `HTTP ${e?.status ?? '?'}  ${JSON.stringify(e?.data ?? (err as Error).message)}`;
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'gfs2@amberflux.in';
  const { clientId, clientSecret, tenantId, authority, graphBaseUrl } = env.teams;

  const tok = await axios.post<{ access_token?: string }>(
    `${authority}/${tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const g: AxiosInstance = axios.create({
    baseURL: graphBaseUrl,
    headers: { Authorization: `Bearer ${tok.data.access_token}` },
    timeout: 30000,
  });

  // Resolve the user's object id (GUID) — some app-only endpoints need it, not the UPN.
  let guid = '';
  try {
    guid = (await g.get<{ id?: string }>(`/users/${encodeURIComponent(upn)}?$select=id`)).data.id ?? '';
    console.log(`Resolved GUID for ${upn}: ${guid}\n`);
  } catch (err) {
    console.log(`GUID resolve failed: ${raw(err)}\n`);
  }

  const startIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const endIso = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const cal = (
    await g.get<GList<{ subject?: string; onlineMeeting?: { joinUrl?: string } }>>(
      `/users/${encodeURIComponent(upn)}/calendarView`,
      { params: { startDateTime: startIso, endDateTime: endIso, $top: '50' } },
    )
  ).data.value.filter((e) => e.onlineMeeting?.joinUrl);

  console.log(`Testing ${cal.length} meeting(s) for ${upn}\n`);

  for (const ev of cal) {
    const subject = (ev.subject ?? '(no subject)').trim();
    const joinUrl = ev.onlineMeeting?.joinUrl ?? '';
    const stripped = joinUrl.split('?')[0];
    let decoded = joinUrl;
    try {
      decoded = decodeURIComponent(joinUrl);
    } catch {
      /* */
    }
    console.log(`\n=== "${subject}" ===`);
    console.log(`joinUrl: ${joinUrl}`);

    const variants: Array<[string, string]> = [
      ['as-is', joinUrl],
      ['decoded', decoded],
      ['stripped (no ?query)', stripped],
    ];
    const userKeys: Array<[string, string]> = [['UPN', upn]];
    if (guid) userKeys.push(['GUID', guid]);
    for (const [ukLabel, uk] of userKeys) {
      for (const [label, val] of variants) {
        try {
          const r = await g.get<GList<{ id: string }>>(
            `/users/${encodeURIComponent(uk)}/onlineMeetings`,
            { params: { $filter: `JoinWebUrl eq '${val}'` } },
          );
          console.log(`  [${ukLabel}/${label}] → HTTP 200, ${r.data.value.length} match(es)${r.data.value[0]?.id ? ` id=${r.data.value[0].id.slice(0, 40)}…` : ''}`);
        } catch (err) {
          console.log(`  [${ukLabel}/${label}] → ${raw(err)}`);
        }
      }
    }
  }
};

main().catch((err) => {
  console.error('debug failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
