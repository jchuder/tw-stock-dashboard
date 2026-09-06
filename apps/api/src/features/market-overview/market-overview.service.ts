import { Injectable } from '@nestjs/common';
import type { MarketOverviewResponse } from '@tw-stock-dashboard/contracts';
import { Effect } from 'effect';
import type { MarketOverviewError } from './market-overview.error.js';
import { TpexMarketProvider } from './tpex-market.provider.js';
import { TwseMarketProvider } from './twse-market.provider.js';

@Injectable()
export class MarketOverviewService {
  constructor(
    private readonly twseProvider: TwseMarketProvider,
    private readonly tpexProvider: TpexMarketProvider,
  ) {}

  getOverview(): Effect.Effect<MarketOverviewResponse, MarketOverviewError> {
    return Effect.all(
      [
        this.twseProvider.getTaiex(),
        this.tpexProvider.getOtc(),
        this.twseProvider.getInstitutionalFlow(),
      ],
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.map(([taiex, otc, institutional]) => ({
        taiex,
        otc,
        institutional,
      })),
    );
  }
}
