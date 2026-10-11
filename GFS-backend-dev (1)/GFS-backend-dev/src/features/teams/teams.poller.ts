import { env } from '@config/index';

import type { TeamsService } from './teams.service';
import type { TeamsProvisioningService } from './teams-provisioning.service';
import type { TeamsMembershipService } from './teams-membership.service';
import { describeError } from './teams.errors';


export const startTeamsPoller = (
  teamsService: TeamsService,
  provisioningService?: TeamsProvisioningService,
  membershipService?: TeamsMembershipService,
): NodeJS.Timeout | null => {
  if (!env.teams.pollingEnabled) {
    console.log('[TeamsPoller] disabled (set TEAMS_POLLING_ENABLED=true to enable)');
    return null;
  }

  let running = false;
  let firstRun = true;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    // The first post-boot tick widens the transcript backfill to recover
    // meetings whose transcripts were generated while the server was down.
    const options = firstRun ? { backfillWindowMs: env.teams.pollCatchupMs } : undefined;
    firstRun = false;
    try {
      try {
        const summary = await teamsService.syncAll(options);
        console.log(
          `[TeamsPoller] synced ${summary.channels.length} channel(s), ${summary.errors.length} error(s)`,
        );
      } catch (err) {
        console.error(`[TeamsPoller] sync failed: ${describeError(err)}`);
      }
      // Retry safety-net for Teams workspace provisioning. No-op when disabled or
      // nothing is pending; guarded internally against concurrent drains.
      if (provisioningService) {
        try {
          await provisioningService.drainPending();
        } catch (err) {
          console.error(`[TeamsPoller] provisioning drain failed: ${describeError(err)}`);
        }
      }
      // Adds missing team members (existing projects, late links, new Heads of Division) and retries.
      if (membershipService) {
        try {
          await membershipService.sweep();
          await membershipService.drainPending();
        } catch (err) {
          console.error(`[TeamsPoller] membership sync failed: ${describeError(err)}`);
        }
      }
    } finally {
      running = false;
    }
  };

  void tick(); // immediate boot tick (with the catch-up window)

  const timer = setInterval(() => {
    void tick();
  }, env.teams.pollIntervalMs);
  timer.unref?.();

  console.log(`[TeamsPoller] started; interval ${env.teams.pollIntervalMs}ms`);
  return timer;
};
