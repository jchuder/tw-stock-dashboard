import { Effect, Either } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwseMisIndexError } from './market-overview.error.js';
import { TwseMisIndexProvider } from './twse-mis-index.provider.js';

describe('TwseMisIndexProvider', () => {
  let provider: TwseMisIndexProvider;

  beforeEach(() => {
    provider = new TwseMisIndexProvider();
    vi.restoreAllMocks();
  });

  it('successfully decodes both TAIEX (t00) and OTC (o00) candidates', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '47,326.27',
          y: '46,551.13',
          d: '20260907',
          t: '13:33:00',
        },
        {
          c: 'o00',
          n: '櫃買指數',
          z: '409.33',
          y: '402.48',
          d: '20260907',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toEqual({
        symbol: 't00',
        value: 47326.27,
        change: 775.14,
        changePercent: 1.67,
        tradeDate: '2026-09-07',
        time: '13:33:00',
        asOf: '2026-09-07T13:33:00+08:00',
      });
      expect(result.right.otc).toEqual({
        symbol: 'o00',
        value: 409.33,
        change: 6.85,
        changePercent: 1.7,
        tradeDate: '2026-09-07',
        time: '13:33:00',
        asOf: '2026-09-07T13:33:00+08:00',
      });
    }
  });

  it('returns null for missing candidate when only one is present (OTC missing)', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '47,326.27',
          y: '46,551.13',
          d: '20260907',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).not.toBeNull();
      expect(result.right.otc).toBeNull();
    }
  });

  it('returns null for missing candidate when only OTC is present (TAIEX missing)', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 'o00',
          n: '櫃買指數',
          z: '409.33',
          y: '402.48',
          d: '20260907',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toBeNull();
      expect(result.right.otc).not.toBeNull();
    }
  });

  it('returns null candidate when value is malformed (e.g. z or y is not a valid number)', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '--',
          y: '46,551.13',
          d: '20260907',
          t: '13:33:00',
        },
        {
          c: 'o00',
          n: '櫃買指數',
          z: '409.33',
          y: '0.00',
          d: '20260907',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toBeNull();
      expect(result.right.otc).toBeNull();
    }
  });

  it('returns null candidate when date is malformed', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '47,326.27',
          y: '46,551.13',
          d: 'invalid-date',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toBeNull();
    }
  });

  it('returns null candidate when time is malformed (e.g. non-format or 99:99:99)', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '47,326.27',
          y: '46,551.13',
          d: '20260907',
          t: 'bad',
        },
        {
          c: 'o00',
          n: '櫃買指數',
          z: '409.33',
          y: '402.48',
          d: '20260907',
          t: '99:99:99',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toBeNull();
      expect(result.right.otc).toBeNull();
    }
  });

  it('returns null for empty string numbers (z = "" or y = "") while allowing the valid peer candidate', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '',
          y: '46,551.13',
          d: '20260907',
          t: '13:33:00',
        },
        {
          c: 'o00',
          n: '櫃買指數',
          z: '409.33',
          y: '402.48',
          d: '20260907',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toBeNull();
      expect(result.right.otc).not.toBeNull();
      expect(result.right.otc?.value).toBe(409.33);
    }
  });

  it('returns null for empty previousClose (y = "") while allowing the valid peer candidate', async () => {
    const mockPayload = {
      msgArray: [
        {
          c: 't00',
          n: '加權指數',
          z: '47,326.27',
          y: '',
          d: '20260907',
          t: '13:33:00',
        },
        {
          c: 'o00',
          n: '櫃買指數',
          z: '409.33',
          y: '402.48',
          d: '20260907',
          t: '13:33:00',
        },
      ],
      rtcode: '0000',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPayload), { status: 200 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.taiex).toBeNull();
      expect(result.right.otc).not.toBeNull();
      expect(result.right.otc?.value).toBe(409.33);
    }
  });

  it('returns TwseMisIndexError on HTTP non-200 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Service Unavailable', { status: 503 }),
    );

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(TwseMisIndexError);
    }
  });

  it('returns TwseMisIndexError on network fetch rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

    const result = await Effect.runPromise(Effect.either(provider.getIndices()));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(TwseMisIndexError);
    }
  });
});
