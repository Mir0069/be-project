import axios, { AxiosInstance } from 'axios';

import { env } from '@config/index';

/**
 * Find a channel meet-now meeting (no calendar event) and fetch its transcript.
 * Discovery via the channel "call started" event message instead of calendarView.
 * Channel name match via arg (default "jemu"). App-only, no Mongo.
 */
interface GList<T> {
  value: T[];
}
interface GMsg {
  id: string;
  subject?: string | null;
  body?: { content?: string };
  eventDetail?: Record<string, unknown> | null;
  attachments?: Array<{ contentType?: string; content?: string; contentUrl?: string }>;
  from?: { user?: { displayName?: string } | null } | null;
}

const main = async (): Promise<void> => {
  const wanted = (process.argv[2] ?? 'jemu').toLowerCase();
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com';
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
  const errInfo = (err: unknown): string => {
    const e = (err as { response?: { status?: number; data?: unknown } }).response;
    return `${e?.status ?? '?'} ${JSON.stringify(e?.data ?? (err as Error).message)}`;
  };

  // Resolve UPN → GUID (onlineMeetings needs the GUID).
  const userId =
    (await g.get<{ id?: string }>(`/users/${encodeURIComponent(upn)}?$select=id`)).data.id ?? upn;

  // Find the channel by name.
  const teams = (await g.get<GList<{ id: string; displayName?: string }>>('/teams')).data.value ?? [];
  let teamId = '';
  let channelId = '';
  let label = '';
  for (const t of teams) {
    const chans =
      (await g.get<GList<{ id: string; displayName?: string }>>(`/teams/${t.id}/channels`)).data
        .value ?? [];
    const m = chans.find((c) => (c.displayName ?? '').toLowerCase().includes(wanted));
    if (m) {
      teamId = t.id;
      channelId = m.id;
      label = `${t.displayName} › ${m.displayName}`;
      break;
    }
  }
  if (!channelId) {
    console.log(`No channel matching "${wanted}".`);
    return;
  }
  console.log(`Channel: ${label}\nUser GUID: ${userId}\n`);

  const msgs =
    (await g.get<GList<GMsg>>(`/teams/${teamId}/channels/${channelId}/messages`, {
      params: { $top: '50' },
    })).data.value ?? [];

  // Find call/meeting events (meet-now posts an event message).
  const callEvents = msgs.filter(
    (m) =>
      m.eventDetail ||
      /meet now|call|texting/i.test(m.subject ?? '') ||
      (m.attachments ?? []).some((a) => /meeting/i.test(a.contentType ?? '')),
  );
  console.log(`Found ${callEvents.length} candidate call/meeting message(s):\n`);

  for (const m of callEvents) {
    console.log(`— message ${m.id}  subject="${(m.subject ?? '').trim()}"`);
    if (m.eventDetail) console.log(`   eventDetail: ${JSON.stringify(m.eventDetail)}`);
    for (const a of m.attachments ?? []) {
      console.log(`   attachment[${a.contentType}]: ${(a.content ?? a.contentUrl ?? '').slice(0, 400)}`);
    }

    // Try to extract a joinUrl from the attachment content (meeting card).
    let joinUrl = '';
    for (const a of m.attachments ?? []) {
      const blob = a.content ?? a.contentUrl ?? '';
      const match = blob.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^"'\\\s]+/);
      if (match) {
        joinUrl = match[0].replace(/\\u002f/g, '/');
        break;
      }
    }
    if (!joinUrl) {
      console.log(`   → no joinUrl in this message\n`);
      continue;
    }
    console.log(`   → joinUrl: ${joinUrl}`);

    // Resolve onlineMeeting (GUID) + fetch transcript.
    try {
      for (const cand of [joinUrl, decodeURIComponent(joinUrl)]) {
        const om = await g.get<GList<{ id: string }>>(
          `/users/${encodeURIComponent(userId)}/onlineMeetings`,
          { params: { $filter: `JoinWebUrl eq '${cand}'` } },
        );
        const meetingId = om.data.value?.[0]?.id;
        if (!meetingId) continue;
        console.log(`   → resolved meetingId ✅`);
        const tr = (
          await g.get<GList<{ id: string }>>(
            `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/transcripts`,
          )
        ).data.value ?? [];
        if (tr.length === 0) {
          console.log(`   → meeting resolved but 0 transcripts (recorded without transcription?)\n`);
          break;
        }
        const t0 = tr[tr.length - 1];
        const buf = await g.get<string>(
          `/users/${encodeURIComponent(userId)}/onlineMeetings/${meetingId}/transcripts/${t0.id}/content?$format=text/vtt`,
          { responseType: 'text' },
        );
        const txt = String(buf.data ?? '');
        console.log(`   → ✅ MEET-NOW TRANSCRIPT ${txt.length} bytes:`);
        console.log(`      ${txt.replace(/\s+/g, ' ').slice(0, 300)}\n`);
        break;
      }
    } catch (err) {
      console.log(`   → resolve/transcript error: ${errInfo(err)}\n`);
    }
  }
};

main().catch((err) => {
  console.error('meetnow failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
