import { Injectable } from '@nestjs/common';
import type { MarketIndexSnapshot, MarketOverviewResponse } from '@tw-stock-dashboard/contracts';
import { Effect } from 'effect';
import type { MarketOverviewError } from './market-overview.error.js';
import { TpexMarketProvider } from './tpex-market.provider.js';
import { TwseMarketProvider } from './twse-market.provider.js';
import {
  type RawMisIndexCandidate,
  TwseMisIndexProvider,
} from './twse-mis-index.provider.js';

export function classifyIndexState(
  candidate: RawMisIndexCandidate,
  now: Date = new Date(),
): MarketIndexSnapshot {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const byType: Record<string, string> = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }

  const taipeiToday = `${byType.year}-${byType.month}-${byType.day}`;
  const taipeiNowTime = `${byType.hour}:${byType.minute}:${byType.second}`;

  const isIntraday =
    candidate.tradeDate === taipeiToday &&
    taipeiNowTime >= '09:00:00' &&
    taipeiNowTime < '13:35:00';

  return {
    value: candidate.value,
    change: candidate.change,
    changePercent: candidate.changePercent,
    state: isIntraday ? ('intraday' as const) : ('closed' as const),
    tradeDate: candidate.tradeDate,
    asOf: isIntraday ? candidate.asOf : null,
    source: 'twse-mis' as const,
  };
}

@Injectable()
export class MarketOverviewService {
  constructor(
    private readonly misProvider: TwseMisIndexProvider,
    private readonly twseProvider: TwseMarketProvider,
    private readonly tpexProvider: TpexMarketProvider,
  ) {}

  getOverview(now: Date = new Date()): Effect.Effect<MarketOverviewResponse, MarketOverviewError> {
    const { misProvider, twseProvider, tpexProvider } = this;
    const indicesEffect = Effect.gen(function* () {
      const misResult = yield* misProvider.getIndices().pipe(
        Effect.catchAll(() => Effect.succeed({ taiex: null, otc: null })),
      );

      const taiexEffect: Effect.Effect<MarketIndexSnapshot, MarketOverviewError> =
        misResult.taiex !== null
          ? Effect.succeed(classifyIndexState(misResult.taiex, now))
          : twseProvider.getTaiex();

      const otcEffect: Effect.Effect<MarketIndexSnapshot, MarketOverviewError> =
        misResult.otc !== null
          ? Effect.succeed(classifyIndexState(misResult.otc, now))
          : tpexProvider.getOtc();

      const [taiex, otc] = yield* Effect.all([taiexEffect, otcEffect], { concurrency: 2 });
      return { taiex, otc };
    });

    return Effect.all(
      [indicesEffect, this.twseProvider.getInstitutionalFlow()],
      { concurrency: 2 },
    ).pipe(
      Effect.map(([{ taiex, otc }, institutional]) => ({
        taiex,
        otc,
        institutional,
      })),
    );
  }
}
