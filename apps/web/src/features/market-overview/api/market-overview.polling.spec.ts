import { environmentManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarketOverviewRefetchInterval } from '../../../shared/datetime/format-taipei.js';

describe('Market overview polling scheduler regression test', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    environmentManager.setIsServer(() => false);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  afterEach(() => {
    environmentManager.setIsServer(() => true);
    vi.useRealTimers();
    queryClient.clear();
  });

  it('automatically wakes up at 08:55 and starts 30s polling without remount or focus', async () => {
    // 1. Set fake clock to Monday 08:54:50 Asia/Taipei (10 seconds before market open)
    const initialTime = new Date('2026-09-07T08:54:50.000+08:00');
    vi.setSystemTime(initialTime);

    const fetchMock = vi.fn().mockResolvedValue({
      taiex: { value: 47000 },
      otc: { value: 400 },
    });

    const observer = new QueryObserver(queryClient, {
      queryKey: ['market-overview-polling-test'],
      queryFn: fetchMock,
      refetchInterval: () => getMarketOverviewRefetchInterval(),
    });

    const unsubscribe = observer.subscribe(() => {});

    // Initial query triggers immediately on mount and settles
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(observer.getCurrentResult().status).toBe('success');
    });

    // 2. Advance time past 08:55:00 boundary (11 seconds -> 08:55:01)
    // No remount, no window focus, no network reconnect.
    await vi.advanceTimersByTimeAsync(11_000);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(observer.getCurrentResult().status).toBe('success');
    });

    // 3. In the trading window, next interval is 30s. Advance 30 seconds -> 08:55:31
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(observer.getCurrentResult().status).toBe('success');
    });

    // Advance another 30 seconds -> 08:56:01
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(observer.getCurrentResult().status).toBe('success');
    });

    unsubscribe();
  });
});
