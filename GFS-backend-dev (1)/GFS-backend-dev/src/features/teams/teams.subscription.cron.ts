import { env } from '@config/index';

import type { TeamsSubscriptionService } from './teams-subscription.service';
import { describeError } from './teams.errors';

export const startTeamsSubscriptionCron = (
  service: TeamsSubscriptionService,
): NodeJS.Timeout | null => {
  if (!service.isEnabled()) {
    console.log(
      '[TeamsSubscriptionCron] disabled (set TEAMS_WEBHOOK_ENABLED=true + TEAMS_WEBHOOK_BASE_URL + TEAMS_WEBHOOK_CLIENT_STATE)',
    );
    return null;
  }

  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const s = await service.renewDueSubscriptions();
      console.log(
        `[TeamsSubscriptionCron] created ${s.created}, renewed ${s.renewed}, recreated ${s.recreated}, deleted ${s.deleted}, errors ${s.errors}`,
      );
    } catch (err) {
      console.error(`[TeamsSubscriptionCron] reconcile failed: ${describeError(err)}`);
    } finally {
      running = false;
    }
  };

  void tick();

  const timer = setInterval(() => {
    void tick();
  }, env.teams.subscriptionCronIntervalMs);
  timer.unref?.();

  console.log(
    `[TeamsSubscriptionCron] started; interval ${env.teams.subscriptionCronIntervalMs}ms`,
  );
  return timer;
};
