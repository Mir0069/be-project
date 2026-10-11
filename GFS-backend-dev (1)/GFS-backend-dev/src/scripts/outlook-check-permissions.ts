import axiosInstance from 'axios';
import { env } from '@config/index';

/**
 * Checks WHICH app-only (Application) Graph permissions are actually consented
 * for the configured Outlook app — by reading the `roles` claim inside the
 * client-credentials access token.
 *
 * Run:
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/outlook-check-permissions.ts
 */

const REQUIRED = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Files.Read.All',
  'Sites.Read.All'
];

const main = async (): Promise<void> => {
  const { clientId, clientSecret, tenantId } = env.outlook;
  if (!clientId || !clientSecret || !tenantId) {
    console.error('OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET / OUTLOOK_TENANT_ID missing in .env');
    process.exit(1);
  }

  console.log(`Tenant : ${tenantId}`);
  console.log(`App    : ${clientId}\n`);

  let token = '';
  try {
    const res = await axiosInstance.post<{ access_token?: string }>(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
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
    console.error(`❌ Could not get app-only token — credentials wrong or app misconfigured.`);
    console.error(`   ${e?.error ?? ''}: ${e?.error_description ?? (err as Error).message}`);
    process.exit(1);
  }
  if (!token) {
    console.error('❌ No access_token returned.');
    process.exit(1);
  }
  console.log('✅ App-only token acquired (credentials are valid).\n');

  // Decode the JWT payload (middle segment) to read the consented roles.
  let roles: string[] = [];
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
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

  console.log(
    missing === 0
      ? '\n🎉 All required Outlook permissions (including Mail.ReadWrite) are enabled + consented.'
      : `\n⚠️  ${missing} required permission(s) MISSING — please request your Azure AD Administrator to grant admin consent for the missing permissions.`
  );
};

main().catch((err) => {
  console.error('check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
