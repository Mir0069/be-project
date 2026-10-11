import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { startTeamsPoller } from '@features/teams/teams.poller';
import { teamsService, teamsProvisioningService, teamsMembershipService } from '@features/teams/teams.router';
import { startZohoPoller } from './features/zoho/zoho.poller';
import { zohoSyncService } from '@features/zoho/zoho.router';
import { startOutlookPoller } from '@features/outlook/outlook.poller';
import { outlookService } from '@features/outlook/outlook.router';
import { dropboxSyncService } from '@features/projects/dropbox-sync.service';
import { loadTemplateBuffer } from '@features/proposal/excel/graph.generator';
import { app } from './app';
import { documentIngestionPipeline } from '@features/document-ingestion/document-ingestion.router';

const start = async (): Promise<void> => {
  await connectDB();

  await documentIngestionPipeline.purgeExpiredDeletedDocuments().catch((err) => {
    console.error('[DocumentIngestion] startup purge failed:', err);
  });

  const deletedDocumentPurgeTimer = setInterval(() => {
    void documentIngestionPipeline.purgeExpiredDeletedDocuments().catch((err) => {
      console.error('[DocumentIngestion] scheduled purge failed:', err);
    });
  }, 60 * 60 * 1000);
  deletedDocumentPurgeTimer.unref();

  // Pre-warm master Excel template in memory on startup so first proposal is instant
  loadTemplateBuffer()
    .then(() => console.log('[Warmup] Master Excel template pre-warmed in memory'))
    .catch((err) => console.warn('[Warmup] Master template pre-warm skipped:', err.message));

  if (env.outlook.centralizedMailbox) {
    try {
      await outlookService.ensureCentralizedMailbox(env.outlook.centralizedMailbox);
      console.log(`[Outlook] centralized mailbox ensured: ${env.outlook.centralizedMailbox}`);
    } catch (err) {
      console.error('[Outlook] failed to ensure centralized mailbox:', err);
    }
  }

  const server = app.listen(env.app.port, () => {
    console.log(`Server running on port ${env.app.port}`);

    // Stagger background pollers so incoming user HTTP traffic has 100% priority on startup
    setTimeout(() => {
      startTeamsPoller(teamsService, teamsProvisioningService, teamsMembershipService);
      startZohoPoller(zohoSyncService);
      startOutlookPoller(outlookService);
      dropboxSyncService.startPoller();
      console.log('[Background] Sync pollers started (staggered)');
    }, 3000);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received — shutting down`);
    server.close(() => process.exit(0));
  };
 
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

