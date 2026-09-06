import type { InstitutionalFlowSnapshot, MarketIndexSnapshot } from '@tw-stock-dashboard/contracts';
import { Effect, Either } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstitutionalFlowError, TwseMarketError } from './market-overview.error.js';
import { MarketOverviewService } from './market-overview.service.js';
import { TpexMarketProvider } from './tpex-market.provider.js';
import { TwseMarketProvider } from './twse-market.provider.js';

describe('MarketOverviewService', () => {
  let twseProvider: TwseMarketProvider;
  let tpexProvider: TpexMarketProvider;
  let service: MarketOverviewService;

  const mockTaiex: MarketIndexSnapshot = {
    asOf: '2026-09-04',
    close: 46551.13,
    change: 693.47,
    changePercent: 1.51,
  };

  const mockOtc: MarketIndexSnapshot = {
    asOf: '2026-09-04',
    close: 402.48,
    change: 7.23,
    changePercent: 1.83,
  };

  const mockInstitutional: InstitutionalFlowSnapshot = {
    asOf: '2026-09-04',
    market: 'TWSE',
    foreignNetAmount: 56212953803,
    investmentTrustNetAmount: -910866463,
    dealerNetAmount: 6370061244,
    totalNetAmount: 61672148584,
  };

  beforeEach(() => {
    twseProvider = new TwseMarketProvider();
    tpexProvider = new TpexMarketProvider();
    service = new MarketOverviewService(twseProvider, tpexProvider);
  });

  it('invokes all three upstream workflows concurrently and returns normalized exact contract', async () => {
    vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockTaiex));
    vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOtc));
    vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(Effect.succeed(mockInstitutional));

    const result = await Effect.runPromise(Effect.either(service.getOverview()));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        taiex: mockTaiex,
        otc: mockOtc,
        institutional: mockInstitutional,
      });
    }

    expect(twseProvider.getTaiex).toHaveBeenCalledOnce();
    expect(tpexProvider.getOtc).toHaveBeenCalledOnce();
    expect(twseProvider.getInstitutionalFlow).toHaveBeenCalledOnce();
  });

  it('fails if any one provider workflow fails', async () => {
    vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.fail(new TwseMarketError()));
    vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOtc));
    vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(Effect.succeed(mockInstitutional));

    const result = await Effect.runPromise(Effect.either(service.getOverview()));
    expect(Either.isLeft(result)).toBe(true);
  });

  it('fails if institutional flow fails', async () => {
    vi.spyOn(twseProvider, 'getTaiex').mockReturnValue(Effect.succeed(mockTaiex));
    vi.spyOn(tpexProvider, 'getOtc').mockReturnValue(Effect.succeed(mockOtc));
    vi.spyOn(twseProvider, 'getInstitutionalFlow').mockReturnValue(
      Effect.fail(new InstitutionalFlowError()),
    );

    const result = await Effect.runPromise(Effect.either(service.getOverview()));
    expect(Either.isLeft(result)).toBe(true);
  });
});
