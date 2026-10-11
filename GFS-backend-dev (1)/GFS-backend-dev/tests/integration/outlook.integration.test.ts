import mongoose from 'mongoose';

import type { OutlookTokenService } from '@features/outlook/outlook-token.service';
import type { OutlookGraphClient } from '@features/outlook/outlook.graph-client';
import type { GraphMailFolder, GraphMailMessage, GraphMailUser } from '@features/outlook/outlook.types';

// Live Microsoft Graph tests. Opt-in:
//   OUTLOOK_INTEGRATION_TESTS=1            -> token + tenant-level checks
//   OUTLOOK_TEST_MAILBOX=sales@gfs.com     -> additionally run mailbox-level checks
//
// The mailbox checks intentionally double as a diagnostic for the classic
// "I sent a mail but the sync never sees it" problem: they verify, in order,
// (1) the mailbox UPN resolves, (2) Mail.Read application permission works,
// (3) what the inbox actually contains according to Graph.
const RUN_INTEGRATION = process.env['OUTLOOK_INTEGRATION_TESTS'] === '1';
const TEST_MAILBOX = process.env['OUTLOOK_TEST_MAILBOX'] ?? '';

const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;
const describeMailbox = RUN_INTEGRATION && TEST_MAILBOX ? describe : describe.skip;

describeIntegration('outlook integration (live Microsoft Graph)', () => {
  let tokenService: OutlookTokenService;
  let graphClient: OutlookGraphClient;

  beforeAll(async () => {
    // Imports are deferred so a missing .env does not break `npm test` on
    // machines where this (skipped) suite has no credentials to load.
    // node16 dynamic imports need the explicit .js extension; jest's
    // moduleNameMapper strips it again at runtime.
    const { env } = await import('@config/index.js');
    const { MongooseOutlookTokenRepository } = await import(
      '@repositories/mongoose/outlook-token.repository.js'
    );
    const { OutlookTokenService } = await import('@features/outlook/outlook-token.service.js');
    const { OutlookGraphClient } = await import('@features/outlook/outlook.graph-client.js');

    await mongoose.connect(env.db.mongoUri);

    tokenService = new OutlookTokenService(new MongooseOutlookTokenRepository(), {
      clientId: env.outlook.clientId,
      clientSecret: env.outlook.clientSecret,
      tenantId: env.outlook.tenantId,
      authority: env.outlook.authority,
      scope: env.outlook.scope,
    });

    if (!tokenService.isConfigured()) {
      throw new Error(
        'OUTLOOK_*/TEAMS_* credentials are not set. Configure them before running integration tests.',
      );
    }

    graphClient = new OutlookGraphClient(tokenService, env.outlook.graphBaseUrl);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('acquires an app-only access token', async () => {
    const token = await tokenService.getValidAccessToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  describeMailbox(`mailbox checks for ${TEST_MAILBOX}`, () => {
    const userPath = `/users/${encodeURIComponent(TEST_MAILBOX)}`;

    it('resolves the mailbox user (404 here = wrong UPN / user has no mailbox)', async () => {
      const user = await graphClient.get<GraphMailUser>(userPath, {
        $select: 'id,displayName,mail,userPrincipalName',
      });
      console.log(`[outlook-itest] mailbox resolved: ${user.displayName} <${user.mail ?? user.userPrincipalName}>`);
      expect(user.id).toBeTruthy();
    });

    it('lists mail folders (403 here = Mail.Read application permission missing or not admin-consented)', async () => {
      const folders = await graphClient.getAllPages<GraphMailFolder>(`${userPath}/mailFolders`, {
        $top: '100',
      });
      for (const f of folders) {
        console.log(
          `[outlook-itest] folder "${f.displayName}" total=${f.totalItemCount} unread=${f.unreadItemCount}`,
        );
      }
      expect(folders.length).toBeGreaterThan(0);
      // If a test mail "was sent but never received", compare the folder counts
      // above: it may have landed in Junk Email instead of Inbox.
      const inbox = folders.find((f) => (f.displayName ?? '').toLowerCase() === 'inbox');
      expect(inbox).toBeDefined();
    });

    it('reads the most recent inbox messages (what Graph sees is what the sync sees)', async () => {
      const response = await graphClient.get<{ value: GraphMailMessage[] }>(
        `${userPath}/mailFolders/inbox/messages`,
        { $top: '5', $select: 'id,subject,from,receivedDateTime,hasAttachments', $orderby: 'receivedDateTime desc' },
      );
      const messages = response.value ?? [];
      for (const m of messages) {
        console.log(
          `[outlook-itest] inbox: ${m.receivedDateTime} | from=${m.from?.emailAddress?.address} | "${m.subject}"`,
        );
      }
      expect(Array.isArray(messages)).toBe(true);
    });

    it('runs a full delta round-trip on the inbox and returns a delta cursor', async () => {
      const { items, deltaLink } = await graphClient.getDelta<GraphMailMessage>(
        `${userPath}/mailFolders/inbox/messages/delta?$select=subject,receivedDateTime,isDraft`,
      );
      console.log(`[outlook-itest] delta returned ${items.length} message(s)`);
      expect(deltaLink).toBeTruthy();
    });
  });
});
