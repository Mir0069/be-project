import axios, { AxiosInstance } from 'axios';

import { env } from '@config/index';

/**
 * No-DB peek into a channel by name: messages (+ replies = meeting chat),
 * files (= shared documents), and any recording links. App-only.
 *
 * Run (channel name via arg or default "Testing"):
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-channel-peek.ts "Testing"
 */

interface GList<T> {
  value: T[];
}
interface GMsg {
  id: string;
  messageType?: string;
  body?: { content?: string };
  from?: { user?: { displayName?: string } | null } | null;
  createdDateTime?: string;
  eventDetail?: { '@odata.type'?: string } | null;
}
interface GFile {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
}

const strip = (html?: string): string =>
  (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const errInfo = (err: unknown): string => {
  const e = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })
    .response;
  return `${e?.status ?? ''} ${e?.data?.error?.message ?? (err as Error).message}`.trim();
};

const main = async (): Promise<void> => {
  const wanted = (process.argv[2] ?? 'Testing').toLowerCase();
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

  // Find the channel by name across all teams.
  const teams = (await g.get<GList<{ id: string; displayName?: string }>>('/teams')).data.value ?? [];
  let teamId = '';
  let channelId = '';
  let channelName = '';
  let teamName = '';
  for (const t of teams) {
    const chans =
      (await g.get<GList<{ id: string; displayName?: string }>>(`/teams/${t.id}/channels`)).data
        .value ?? [];
    const match = chans.find((c) => (c.displayName ?? '').toLowerCase().includes(wanted));
    if (match) {
      teamId = t.id;
      channelId = match.id;
      channelName = match.displayName ?? '';
      teamName = t.displayName ?? '';
      break;
    }
  }
  if (!channelId) {
    console.log(`No channel matching "${wanted}" found.`);
    return;
  }
  console.log(`\n=== CHANNEL: "${channelName}"  (team: "${teamName}") ===\n`);

  // Messages + replies (meeting chat lives here for channel meetings).
  const msgs =
    (await g.get<GList<GMsg>>(`/teams/${teamId}/channels/${channelId}/messages`, {
      params: { $top: '50' },
    })).data.value ?? [];

  console.log(`--- MESSAGES (${msgs.length}) + replies ---`);
  for (const m of msgs) {
    const isEvent = !!m.eventDetail;
    const who = m.from?.user?.displayName ?? (isEvent ? '(system event)' : '(unknown)');
    const text = isEvent ? `[meeting/system event: ${m.eventDetail?.['@odata.type']}]` : strip(m.body?.content);
    if (text || isEvent) console.log(`  • ${who}: ${text}`);
    try {
      const replies =
        (await g.get<GList<GMsg>>(
          `/teams/${teamId}/channels/${channelId}/messages/${m.id}/replies`,
        )).data.value ?? [];
      for (const r of replies) {
        const rt = strip(r.body?.content);
        if (rt) console.log(`       ↳ ${r.from?.user?.displayName ?? '(unknown)'}: ${rt}`);
      }
    } catch {
      /* no replies */
    }
  }

  // Files (shared documents) via filesFolder → drive children.
  console.log(`\n--- DOCUMENTS ---`);
  try {
    const ff = (await g.get<{ id?: string; parentReference?: { driveId?: string } }>(
      `/teams/${teamId}/channels/${channelId}/filesFolder`,
    )).data;
    const driveId = ff.parentReference?.driveId;
    const itemId = ff.id;
    if (driveId && itemId) {
      const files =
        (await g.get<GList<GFile>>(`/drives/${driveId}/items/${itemId}/children`)).data.value ?? [];
      if (files.length === 0) console.log('  (none)');
      for (const f of files) {
        if (f.folder) {
          console.log(`  📁 ${f.name}/  (${f.folder.childCount ?? 0} items)`);
          try {
            const sub =
              (await g.get<GList<GFile>>(`/drives/${driveId}/items/${f.id}/children`)).data.value ??
              [];
            for (const s of sub) {
              const kind = /\.(mp4|mov)$/i.test(s.name ?? '') ? '🎥 RECORDING' : '📄';
              console.log(`       ${kind}  ${s.name}  (${Math.round((s.size ?? 0) / 1024)} KB)`);
            }
          } catch (e) {
            console.log(`       (could not list ${f.name}: ${errInfo(e)})`);
          }
        } else {
          const kind = /\.(mp4|mov)$/i.test(f.name ?? '') ? '🎥 RECORDING' : '📄';
          console.log(`  ${kind}  ${f.name}  (${Math.round((f.size ?? 0) / 1024)} KB)`);
        }
      }
    } else {
      console.log('  could not resolve channel drive');
    }
  } catch (err) {
    console.log(`  files error: ${errInfo(err)}`);
  }
};

main().catch((err) => {
  console.error('peek failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
