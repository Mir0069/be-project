import { env } from '@config/index';

import type { OutlookService } from './outlook.service';
import { describeError } from './outlook.errors';

/**
 * Polling-based mail ingestion. Runs syncAll() on a fixed interval using the
 * Graph delta cursor stored per mailbox, so each tick only fetches new or
 * changed messages. Uses setInterval (no extra dependency); an overlap guard
 * prevents a slow run from stacking, and the timer is unref'd so it never
 * keeps the process alive on its own. Disabled unless
 * OUTLOOK_POLLING_ENABLED=true.
 */
export const startOutlookPoller = (outlookService: OutlookService): NodeJS.Timeout | null => {
  if (!env.outlook.pollingEnabled) {
    console.log('[OutlookPoller] disabled (set OUTLOOK_POLLING_ENABLED=true to enable)');
    return null;
  }

  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const summary = await outlookService.syncAll();
      const totalIngested = summary.mailboxes.reduce((acc, m) => acc + m.ingested, 0);
      const totalAttachments = summary.mailboxes.reduce((acc, m) => acc + (m.attachmentsStaged ?? 0), 0);
      console.log(
        `[OutlookPoller] synced ${summary.mailboxes.length} mailbox(es): fetched ${totalIngested} email(s) and staged ${totalAttachments} attachment(s) (${summary.errors.length} error(s))`,
      );
      if (summary.errors.length > 0) {
        console.error('[OutlookPoller] sync errors:', JSON.stringify(summary.errors, null, 2));
      }
    } catch (err) {
      console.error(`[OutlookPoller] sync failed: ${describeError(err)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, env.outlook.pollIntervalMs);
  timer.unref?.();

  // Run the first tick 1 second after startup to provide immediate feedback/testing
  setTimeout(() => {
    console.log('[OutlookPoller] running initial sync...');
    void tick();
  }, 1000);

  console.log(`[OutlookPoller] started; interval ${env.outlook.pollIntervalMs}ms`);
  return timer;
};
