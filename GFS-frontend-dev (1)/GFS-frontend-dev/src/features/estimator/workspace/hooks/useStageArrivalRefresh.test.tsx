import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useStageArrivalRefresh } from "./useStageArrivalRefresh";

describe("useStageArrivalRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes a newly opened workflow stage without reloading the browser", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useStageArrivalRefresh(true, refetch));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(refetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a refresh during ordinary navigation", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useStageArrivalRefresh(false, refetch));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refetch).not.toHaveBeenCalled();
  });
});
