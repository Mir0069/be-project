import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { MongooseOutlookTokenRepository } from '@repositories/mongoose/outlook-token.repository';
import { OutlookTokenService } from '@features/outlook/outlook-token.service';
import { OutlookGraphClient } from '@features/outlook/outlook.graph-client';
import type {
  GraphList,
  GraphMailFolder,
  GraphMailMessage,
  GraphMailUser,
} from '@features/outlook/outlook.types';

// Mailbox to verify ingestion against. Override with: MAILBOX=foo@bar.com npx tsx ...
const MAILBOX = process.env['MAILBOX'] ?? 'pradeep@amberflux.com';

const main = async (): Promise<void> => {
  const tokenService = new OutlookTokenService(new MongooseOutlookTokenRepository(), {
    clientId: env.outlook.clientId,
    clientSecret: env.outlook.clientSecret,
    tenantId: env.outlook.tenantId,
    authority: env.outlook.authority,
    scope: env.outlook.scope,
  });

  if (!tokenService.isConfigured()) {
    console.error('❌ OUTLOOK_* creds missing in .env');
    process.exit(1);
  }

  await connectDB();

  // 1) App-only token — proves client id/secret/tenant + admin consent.
  console.log('① Acquiring Graph app-only token…');
  const token = await tokenService.fetchToken();
  console.log(`   ✓ token acquired (expires in ${token.expires_in}s)\n`);

  const graph = new OutlookGraphClient(tokenService, env.outlook.graphBaseUrl);

  // 2) Directory user lookup needs User.Read.All; the ingestion app only has
  // Mail.Read, so this is best-effort and non-fatal.
  console.log(`② Reading mailbox user ${MAILBOX} (optional, needs User.Read.All)…`);
  try {
    const user = await graph.get<GraphMailUser>(`/users/${encodeURIComponent(MAILBOX)}`);
    console.log(`   ✓ ${user.displayName ?? '(no name)'} <${user.mail ?? user.userPrincipalName}>`);
    console.log(`     id: ${user.id}\n`);
  } catch {
    console.log('   – skipped (no User.Read.All; not required for mail ingestion)\n');
  }

  // 3) List inbox folder — proves Mail.Read on this mailbox.
  console.log('③ Reading inbox folder…');
  const inbox = await graph.get<GraphMailFolder>(
    `/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox`,
  );
  console.log(
    `   ✓ inbox: ${inbox.totalItemCount ?? '?'} total, ${inbox.unreadItemCount ?? '?'} unread\n`,
  );

  // 4) Pull the 5 most recent messages — the actual ingestion read.
  console.log('④ Fetching 5 most recent messages…');
  const res = await graph.get<GraphList<GraphMailMessage>>(
    `/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages`,
    {
      $top: '5',
      $select: 'subject,from,receivedDateTime,hasAttachments',
      $orderby: 'receivedDateTime desc',
    },
  );
  const msgs = res.value ?? [];
  if (msgs.length === 0) {
    console.log('   (inbox empty)');
  }
  for (const m of msgs) {
    const from = m.from?.emailAddress?.address ?? '(unknown)';
    const att = m.hasAttachments ? ' 📎' : '';
    console.log(`   • [${m.receivedDateTime}] ${from} — ${m.subject ?? '(no subject)'}${att}`);
  }

  console.log('\n✅ Outlook ingestion path verified end-to-end.');
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('\n❌ verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
