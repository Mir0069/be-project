import { useEffect } from "react";

const INITIAL_REFRESH_DELAY_MS = 1_500;
const REFRESH_INTERVAL_MS = 2_000;
const MAX_REFRESH_ATTEMPTS = 15;

type StageRefetch = () => Promise<unknown>;

/**
 * Bridges the short gap between an estimator approval and its asynchronous AI
 * result. The next page still loads normally, then refreshes its stage for at
 * most 30 seconds so newly generated reasoning appears without a browser reload.
 */
export const useStageArrivalRefresh = (
  shouldRefreshOnArrival: boolean,
  refetch: StageRefetch,
) => {
  useEffect(() => {
    if (!shouldRefreshOnArrival) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let attempts = 0;

    const refreshStage = async () => {
      if (cancelled) return;

      try {
        await refetch();
      } catch {
        // Keep retrying for the bounded window. The stage page still exposes its
        // normal Retry button if the backend remains unavailable.
      }

      attempts += 1;
      if (!cancelled && attempts < MAX_REFRESH_ATTEMPTS) {
        timeoutId = window.setTimeout(refreshStage, REFRESH_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(refreshStage, INITIAL_REFRESH_DELAY_MS);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [refetch, shouldRefreshOnArrival]);
};
