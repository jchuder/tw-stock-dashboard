import type { InstitutionalFlowSnapshot, MarketIndexSnapshot } from '@tw-stock-dashboard/contracts';
import { Effect, Either } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InstitutionalFlowError,
  TwseMarketError,
  TwseMisIndexError,
} from './market-overview.error.js';
import { classifyIndexState, MarketOverviewService } from './market-overview.service.js';
import { TpexMarketProvider } from './tpex-market.provider.js';
import { TwseMarketProvider } from './twse-market.provider.js';
import {
  type RawMisIndexCandidate,
  TwseMisIndexProvider,
} from './twse-mis-index.provider.js';

describe('MarketOverviewService', () => {
  let misProvider: TwseMisIndexProvider;
  let twseProvider: TwseMarketProvider;
  let tpexProvider: TpexMarketProvider;
  let service: MarketOverviewService;

  const mockOpenApiTaiex: MarketIndexSnapshot = {
    value: 46551.13,
    change: 693.47,
    changePercent: 1.51,
    state: 'closed',
    tradeDate: '2026-09-04',
    asOf: null,
    source: 'twse',
  };

  const mockOpenApiOtc: MarketIndexSnapshot = {
    value: 402.48,
    change: 7.23,
    changePercent: 1.83,
    state: 'closed',
    tradeDate: '2026-09-04',
    asOf: null,
    source: 'tpex',
  };

  const mockInstitutional: InstitutionalFlowSnapshot = {
    asOf: '2026-09-04',
    market: 'TWSE',
    foreignNetAmount: 56212953803,
    investmentTrustNetAmount: -910866463,
    dealerNetAmount: 6370061244,
    totalNetAmount: 61672148584,
  };

  const mockMisTaiexCandidate: RawMisIndexCandidate = {
    symbol: 't00',
    value: 47326.27,
    change: 775.14,
    changePercent: 1.67,
    tradeDate: '2026-09-07',
    time: '13:33:00',
    asOf: '2026-09-07T13:33:00+08:00',
  };

  const mockMisOtcCandidate: RawMisIndexCandidate = {
    symbol: 'o00',
    value: 409.33,
    change: 6.85,
    changePercent: 1.7,
    tradeDate: '2026-09-07',
    time: '13:33:00',
    asOf: '2026-09-07T13:33:00+08:00',
  };

  beforeEach(() => {
    misProvider = new TwseMisIndexProvider();
    twseProvider = new TwseMarketProvider();
    tpexProvider = new TpexMarketProvider();
    service = new MarketOverviewService(misProvider, twseProvider, tpexProvider);
  });

  describe('classifyIndexState', () => {
    it('classifies as intraday when on today and 09:00:00 <= time < 13:35:00', () => {
      const now = new Date('2026-09-07T10:30:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47000.0,
        change: 448.87,
        changePercent: 0.96,
        tradeDate: '2026-09-07',
        time: '10:30:00',
        asOf: '2026-09-07T10:30:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toEqual({
        value: 47000.0,
        change: 448.87,
        changePercent: 0.96,
        state: 'intraday',
        tradeDate: '2026-09-07',
        asOf: '2026-09-07T10:30:00+08:00',
        source: 'twse-mis',
      });
    });

    it('classifies as intraday during delayed closing settlement grace period (e.g. 13:33:00)', () => {
      const now = new Date('2026-09-07T13:33:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47320.0,
        change: 768.87,
        changePercent: 1.65,
        tradeDate: '2026-09-07',
        time: '13:33:00',
        asOf: '2026-09-07T13:33:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).not.toBeNull();
      expect(result?.state).toBe('intraday');
      expect(result?.asOf).toBe('2026-09-07T13:33:00+08:00');
    });

    it('classifies as closed after 13:35:00 settlement window (e.g. 13:36:00 and 14:14 batch-gap)', () => {
      const now = new Date('2026-09-07T14:14:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47326.27,
        change: 775.14,
        changePercent: 1.67,
        tradeDate: '2026-09-07',
        time: '13:35:30',
        asOf: '2026-09-07T13:35:30+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toEqual({
        value: 47326.27,
        change: 775.14,
        changePercent: 1.67,
        state: 'closed',
        tradeDate: '2026-09-07',
        asOf: null,
        source: 'twse-mis',
      });
    });

    it('returns null before market open (e.g. 08:50:00) to trigger fallback', () => {
      const now = new Date('2026-09-07T08:50:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 46551.13,
        change: 0,
        changePercent: 0,
        tradeDate: '2026-09-07',
        time: '08:50:00',
        asOf: '2026-09-07T08:50:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toBeNull();
    });

    it('classifies a previous-day completed session as closed (e.g. Friday close observed Monday 09:15)', () => {
      const now = new Date('2026-09-07T09:15:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 46551.13,
        change: 693.47,
        changePercent: 1.51,
        tradeDate: '2026-09-04',
        time: '13:33:00',
        asOf: '2026-09-04T13:33:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toEqual({
        value: 46551.13,
        change: 693.47,
        changePercent: 1.51,
        state: 'closed',
        tradeDate: '2026-09-04',
        asOf: null,
        source: 'twse-mis',
      });
    });

    it('classifies a previous-day completed session as closed across midnight (e.g. 09-08 close observed 09-09 01:05)', () => {
      const now = new Date('2026-09-09T01:05:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47105.78,
        change: -220.49,
        changePercent: -0.47,
        tradeDate: '2026-09-08',
        time: '13:33:00',
        asOf: '2026-09-08T13:33:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toEqual({
        value: 47105.78,
        change: -220.49,
        changePercent: -0.47,
        state: 'closed',
        tradeDate: '2026-09-08',
        asOf: null,
        source: 'twse-mis',
      });
    });

    it('returns null for a previous-day candidate without a completed close (e.g. 10:00 snapshot)', () => {
      const now = new Date('2026-09-07T09:15:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 46500.0,
        change: -51.13,
        changePercent: -0.11,
        tradeDate: '2026-09-04',
        time: '10:00:00',
        asOf: '2026-09-04T10:00:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toBeNull();
    });

    it('returns null for a future-dated candidate', () => {
      const now = new Date('2026-09-07T14:14:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47105.78,
        change: -220.49,
        changePercent: -0.47,
        tradeDate: '2026-09-08',
        time: '13:33:00',
        asOf: '2026-09-08T13:33:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toBeNull();
    });

    it('rejects stale-today candidate (e.g. 10:00:00 snapshot observed at 14:14:00) by returning null', () => {
      const now = new Date('2026-09-07T14:14:00+08:00');
      const candidate: RawMisIndexCandidate = {
        symbol: 't00',
        value: 46500.0,
        change: -51.13,
        changePercent: -0.11,
        tradeDate: '2026-09-07',
        time: '10:00:00',
        asOf: '2026-09-07T10:00:00+08:00',
      };

      const result = classifyIndexState(candidate, now);
      expect(result).toBeNull();
    });
  });

  describe('getOverview', () => {
    it('prefers newer MIS closed over older OpenAPI (freshness comparison, e.g. 14:14 batch-gap case)', async () => {
      const now = new Date('2026-09-07T14:14:00+08:00');
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({
          taiex: mockMisTaiexCandidate,
          otc: mockMisOtcCandidate,
        }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex).toEqual({
          value: 47326.27,
          change: 775.14,
          changePercent: 1.67,
          state: 'closed',
          tradeDate: '2026-09-07',
          asOf: null,
          source: 'twse-mis',
        });
        expect(result.right.otc).toEqual({
          value: 409.33,
          change: 6.85,
          changePercent: 1.7,
          state: 'closed',
          tradeDate: '2026-09-07',
          asOf: null,
          source: 'twse-mis',
        });
        expect(result.right.institutional).toEqual(mockInstitutional);
      }

      expect(misProvider.getIndices).toHaveBeenCalledOnce();
      // Closed MIS candidates must be freshness-checked against OpenAPI.
      expect(twseProvider.getTaiex).toHaveBeenCalledOnce();
      expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
      expect(twseProvider.getInstitutionalFlow).toHaveBeenCalledOnce();
    });

    it('serves previous-day MIS closed across midnight instead of older OpenAPI (e.g. 09-09 01:05 regression)', async () => {
      const now = new Date('2026-09-09T01:05:00+08:00');
      const misClose: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47105.78,
        change: -220.49,
        changePercent: -0.47,
        tradeDate: '2026-09-08',
        time: '13:33:00',
        asOf: '2026-09-08T13:33:00+08:00',
      };
      const staleOpenApi: MarketIndexSnapshot = {
        value: 47326.27,
        change: 775.14,
        changePercent: 1.67,
        state: 'closed',
        tradeDate: '2026-09-07',
        asOf: null,
        source: 'twse',
      };
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({ taiex: misClose, otc: null }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(staleOpenApi));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex.value).toBe(47105.78);
        expect(result.right.taiex.tradeDate).toBe('2026-09-08');
        expect(result.right.taiex.state).toBe('closed');
        expect(result.right.taiex.source).toBe('twse-mis');
      }
    });

    it('prefers newer OpenAPI closed when MIS closed is older', async () => {
      const now = new Date('2026-09-09T01:05:00+08:00');
      const staleMis: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47326.27,
        change: 775.14,
        changePercent: 1.67,
        tradeDate: '2026-09-07',
        time: '13:33:00',
        asOf: '2026-09-07T13:33:00+08:00',
      };
      const freshOpenApi: MarketIndexSnapshot = {
        value: 47105.78,
        change: -220.49,
        changePercent: -0.47,
        state: 'closed',
        tradeDate: '2026-09-08',
        asOf: null,
        source: 'twse',
      };
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({ taiex: staleMis, otc: null }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(freshOpenApi));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex).toEqual(freshOpenApi);
        expect(result.right.taiex.source).toBe('twse');
      }
    });

    it('keeps MIS closed when the OpenAPI freshness probe fails', async () => {
      const now = new Date('2026-09-09T01:05:00+08:00');
      const misClose: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47105.78,
        change: -220.49,
        changePercent: -0.47,
        tradeDate: '2026-09-08',
        time: '13:33:00',
        asOf: '2026-09-08T13:33:00+08:00',
      };
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({ taiex: misClose, otc: null }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.fail(new TwseMarketError()));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex.tradeDate).toBe('2026-09-08');
        expect(result.right.taiex.source).toBe('twse-mis');
      }
    });

    it('uses intraday MIS directly without an OpenAPI probe (e.g. 09-09 10:00)', async () => {
      const now = new Date('2026-09-09T10:00:00+08:00');
      const intraday: RawMisIndexCandidate = {
        symbol: 't00',
        value: 47200.0,
        change: 94.22,
        changePercent: 0.2,
        tradeDate: '2026-09-09',
        time: '10:00:00',
        asOf: '2026-09-09T10:00:00+08:00',
      };
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({ taiex: intraday, otc: null }),
      );
      vi.spyOn(twseProvider, 'getTaiex');
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex.state).toBe('intraday');
        expect(result.right.taiex.tradeDate).toBe('2026-09-09');
        expect(result.right.taiex.source).toBe('twse-mis');
      }

      expect(twseProvider.getTaiex).not.toHaveBeenCalled();
      expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
    });

    it('falls back to OpenAPI providers when MIS completely fails', async () => {
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.fail(new TwseMisIndexError({ cause: 'timeout' })),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview()));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex).toEqual(mockOpenApiTaiex);
        expect(result.right.otc).toEqual(mockOpenApiOtc);
        expect(result.right.institutional).toEqual(mockInstitutional);
      }

      expect(misProvider.getIndices).toHaveBeenCalledOnce();
      expect(twseProvider.getTaiex).toHaveBeenCalledOnce();
      expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
    });

    it('falls back partially when MIS has TAIEX but is missing OTC', async () => {
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({
          taiex: mockMisTaiexCandidate,
          otc: null,
        }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const now = new Date('2026-09-07T14:14:00+08:00');
      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex.source).toBe('twse-mis');
        expect(result.right.otc).toEqual(mockOpenApiOtc);
        expect(result.right.otc.source).toBe('tpex');
      }

      expect(twseProvider.getTaiex).toHaveBeenCalledOnce();
      expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
    });

    it('falls back partially when MIS has OTC but is missing TAIEX', async () => {
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({
          taiex: null,
          otc: mockMisOtcCandidate,
        }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const now = new Date('2026-09-07T14:14:00+08:00');
      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex).toEqual(mockOpenApiTaiex);
        expect(result.right.taiex.source).toBe('twse');
        expect(result.right.otc.source).toBe('twse-mis');
      }

      expect(twseProvider.getTaiex).toHaveBeenCalledOnce();
      expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
    });

    it('falls back to TWSE OpenAPI when MIS candidate is stale-today (10:00 snapshot at 14:14)', async () => {
      const now = new Date('2026-09-07T14:14:00+08:00');
      const staleTaiex: RawMisIndexCandidate = {
        symbol: 't00',
        value: 46500.0,
        change: -51.13,
        changePercent: -0.11,
        tradeDate: '2026-09-07',
        time: '10:00:00',
        asOf: '2026-09-07T10:00:00+08:00',
      };

      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({
          taiex: staleTaiex,
          otc: mockMisOtcCandidate,
        }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        // TAIEX must fallback to TWSE OpenAPI (46551.13, 2026-09-04), NOT 46500 closed on 2026-09-07!
        expect(result.right.taiex).toEqual(mockOpenApiTaiex);
        expect(result.right.taiex.source).toBe('twse');
        expect(result.right.taiex.tradeDate).toBe('2026-09-04');
        // OTC has healthy 13:33 snapshot, so it remains MIS closed
        expect(result.right.otc.source).toBe('twse-mis');
        expect(result.right.otc.state).toBe('closed');
      }

      expect(twseProvider.getTaiex).toHaveBeenCalledOnce();
      expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
    });

    it('allows valid mixed dates (e.g. TAIEX/OTC at 2026-09-07 and Institutional at 2026-09-04)', async () => {
      const now = new Date('2026-09-07T14:14:00+08:00');
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({
          taiex: mockMisTaiexCandidate,
          otc: mockMisOtcCandidate,
        }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview(now)));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.taiex.tradeDate).toBe('2026-09-07');
        expect(result.right.otc.tradeDate).toBe('2026-09-07');
        expect(result.right.institutional.asOf).toBe('2026-09-04');
      }
    });

    it('fails if institutional flow fails', async () => {
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.succeed({
          taiex: mockMisTaiexCandidate,
          otc: mockMisOtcCandidate,
        }),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockOpenApiTaiex));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.fail(new InstitutionalFlowError()),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview()));
      expect(Either.isLeft(result)).toBe(true);
    });

    it('fails if fallback provider fails when MIS is unavailable', async () => {
      vi.spyOn(misProvider, 'getIndices').mockReturnValue(
        Effect.fail(new TwseMisIndexError({ cause: 'status_500' })),
      );
      vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.fail(new TwseMarketError()));
      vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOpenApiOtc));
      vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
        Effect.succeed(mockInstitutional),
      );

      const result = await Effect.runPromise(Effect.either(service.getOverview()));
      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
