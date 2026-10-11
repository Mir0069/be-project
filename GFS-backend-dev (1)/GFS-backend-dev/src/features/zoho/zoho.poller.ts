import { env } from '@config/index';

import type { ZohoSyncService } from './zoho-sync.service';

/**
 * Pull-based Zoho sync. On a fixed interval, asks Zoho for leads modified in a
 * recent window and runs the diff — so changes flow in WITHOUT any webhook or
 * public URL (the server reaches out to Zoho, which works fine from localhost).
 *
 * The window is a bit larger than the interval so a change never slips between
 * ticks; the overlap is safe because the diff is idempotent (no false changes).
 * An overlap guard stops a slow run from stacking, and the timer is unref'd.
 * On by default; disable with ZOHO_POLLING_ENABLED=false.
 */
export const startZohoPoller = (syncService: ZohoSyncService): NodeJS.Timeout | null => {
  if (!env.zoho.pollingEnabled) {
    console.log('[ZohoPoller] disabled (set ZOHO_POLLING_ENABLED=true to enable)');
    return null;
  }

  const intervalMs = env.zoho.pollIntervalMs;
  const windowMs = intervalMs + 3 * 60 * 1000; // interval + 3 min safety overlap
  const catchupMs = env.zoho.pollCatchupMs; // wide sweep on first run after a restart
  let running = false;
  let firstRun = true;

  const tick = async (): Promise<void> => {
    if (running) return; // don't stack if a previous poll is still running
    running = true;
    try {
      // The first poll after (re)start sweeps a wide window to catch anything
      // changed during downtime; after that we use the normal rolling window.
      const lookbackMs = firstRun ? catchupMs : windowMs;
      const summary = await syncService.syncModifiedSince(Date.now() - lookbackMs, 'poll');
      const stamp = new Date().toISOString();
      if (firstRun) {
        const hrs = Math.round(catchupMs / 3600000);
        console.log(
          `[ZohoPoller ${stamp}] startup catch-up (last ${hrs}h): ${summary.created} new, ${summary.updated} updated, ${summary.changeEntries} change(s)`,
        );
        firstRun = false;
      } else if (summary.changeEntries > 0) {
        console.log(
          `[ZohoPoller ${stamp}] CHANGES: ${summary.created} new, ${summary.updated} updated, ${summary.changeEntries} entry(ies) logged`,
        );
      } else {
        console.log(`[ZohoPoller ${stamp}] tick — scanned ${summary.scanned} modified, no changes`);
      }
    } catch (err) {
      console.error(`[ZohoPoller] poll failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };

  void tick(); // run one immediately on boot
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  console.log(`[ZohoPoller] started; polling Zoho every ${intervalMs}ms (window ${windowMs}ms)`);
  return timer;
};
