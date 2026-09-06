import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TpexMarketProvider } from './tpex-market.provider.js';

describe('TpexMarketProvider', () => {
  const provider = new TpexMarketProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes 2026-09-04 correctly: 402.48 / +7.23 -> +1.83%', async () => {
    const mockPayload = [
      {
        Date: '20260904',
        Open: '398.83',
        High: '405.64',
        Low: '394.59',
        Close: '402.48',
        Change: '7.23',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getOtc()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        asOf: '2026-09-04',
        close: 402.48,
        change: 7.23,
        changePercent: 1.83,
      });
    }
  });

  it('normalizes 2026-09-03 correctly: 395.25 / -11.71 -> -2.88%', async () => {
    const mockPayload = [
      {
        Date: '20260903',
        Open: '407.50',
        High: '411.77',
        Low: '394.74',
        Close: '395.25',
        Change: '-11.71',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getOtc()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        asOf: '2026-09-03',
        close: 395.25,
        change: -11.71,
        changePercent: -2.88,
      });
    }
  });

  it('chooses the latest record by Date even when payload is reversed or unordered', async () => {
    const mockPayload = [
      {
        Date: '20260904',
        Open: '398.83',
        High: '405.64',
        Low: '394.59',
        Close: '402.48',
        Change: '7.23',
      },
      {
        Date: '20260901',
        Open: '402.12',
        High: '412.90',
        Low: '402.12',
        Close: '410.77',
        Change: '9.07',
      },
      {
        Date: '20260903',
        Open: '407.50',
        High: '411.77',
        Low: '394.74',
        Close: '395.25',
        Change: '-11.71',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getOtc()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.asOf).toBe('2026-09-04');
      expect(result.right.close).toBe(402.48);
    }
  });

  it('fails with TpexMarketError when previousClose <= 0 or invalid number', async () => {
    const mockPayload = [
      {
        Date: '20260904',
        Open: '10',
        High: '10',
        Low: '10',
        Close: '10',
        Change: '20', // previousClose = 10 - 20 = -10 <= 0
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getOtc()));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TpexMarketError');
    }
  });
});
