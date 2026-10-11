import axios from 'axios';

import { env } from '@config/index';

/**
 * Checks WHICH app-only (Application) Graph permissions are actually consented
 * for the configured Teams app — by reading the `roles` claim inside the
 * client-credentials access token. No meeting data needed; works instantly.
 *
 * Run:
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-check-permissions.ts
 */

const REQUIRED = [
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Read.All',
  'Chat.Read.All',
  'Files.Read.All',
  'OnlineMeetings.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'OnlineMeetingRecording.Read.All',
  'Calendars.Read',
  'User.Read.All',
  // Needed when TEAMS_AUTO_ADD_MEMBERS_ENABLED=true (add members, invite guests).
  'TeamMember.ReadWrite.All',
  'User.Invite.All',
];

const main = async (): Promise<void> => {
  const { clientId, clientSecret, tenantId, authority } = env.teams;
  if (!clientId || !clientSecret || !tenantId) {
    console.error('TEAMS_CLIENT_ID / TEAMS_CLIENT_SECRET / TEAMS_TENANT_ID missing in .env');
    process.exit(1);
  }

  console.log(`Tenant : ${tenantId}`);
  console.log(`App    : ${clientId}\n`);

  let token = '';
  try {
    const res = await axios.post<{ access_token?: string }>(
      `${authority}/${tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    token = res.data.access_token ?? '';
  } catch (err) {
    const e = (err as { response?: { data?: { error?: string; error_description?: string } } })
      .response?.data;
    console.error(`❌ Could not get app-only token — creds wrong or app misconfigured.`);
    console.error(`   ${e?.error ?? ''}: ${e?.error_description ?? (err as Error).message}`);
    process.exit(1);
  }
  if (!token) {
    console.error('❌ No access_token returned.');
    process.exit(1);
  }
  console.log('✅ App-only token acquired (creds are valid).\n');

  // Decode the JWT payload (middle segment) to read the consented roles.
  let roles: string[] = [];
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'),
    ) as { roles?: string[] };
    roles = payload.roles ?? [];
  } catch {
    console.error('Could not decode token payload.');
    process.exit(1);
  }

  if (roles.length === 0) {
    console.log(
      '⚠️  Token has NO `roles` — no Application permissions are consented (or admin consent not granted).',
    );
  } else {
    console.log(`Consented Application permissions (${roles.length}):`);
    roles.slice().sort().forEach((r) => console.log(`   • ${r}`));
  }

  console.log('\n=== Required-permission check ===');
  let missing = 0;
  for (const p of REQUIRED) {
    const ok = roles.includes(p);
    if (!ok) missing += 1;
    console.log(`   ${ok ? '✅' : '❌ MISSING'}  ${p}`);
  }

  const extra = roles.filter((r) => !REQUIRED.includes(r));
  if (extra.length) {
    console.log(`\n(also granted, not required: ${extra.join(', ')})`);
  }

  console.log(
    missing === 0
      ? '\n🎉 All 10 required permissions are enabled + consented.'
      : `\n⚠️  ${missing} required permission(s) MISSING — add them in Entra → API permissions → Application → Grant admin consent.`,
  );
};

main().catch((err) => {
  console.error('check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
