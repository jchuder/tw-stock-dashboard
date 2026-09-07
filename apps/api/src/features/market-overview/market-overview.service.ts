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

/**
 * Classifies an incoming MIS candidate into an intraday or closed snapshot.
 *
 * Market timing rules:
 * - 正常 13:30 收盤；極端情況可能因暫緩收盤延至 13:33，系統保守至 13:35 才將 MIS 快照視為 final close。
 * - 09:00:00 <= now < 13:35:00: 判定為 intraday 即時行情。
 * - now >= 13:35:00: 必須確保 candidate.time >= 13:30:00（達到收盤撮合時段）才升為 closed 收盤價；
 *   若 candidate.time < 13:30:00（例如停留於 10:00:00 的 stale 快照），不得判定為今日收盤，回傳 null 以降級至 OpenAPI EOD。
 * - 非今日日期或開盤前（now < 09:00:00）：回傳 null 以降級至 OpenAPI EOD。
 */
export function classifyIndexState(
  candidate: RawMisIndexCandidate,
  now: Date = new Date(),
): MarketIndexSnapshot | null {
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

  if (candidate.tradeDate !== taipeiToday) {
    return null;
  }

  if (taipeiNowTime >= '09:00:00' && taipeiNowTime < '13:35:00') {
    if (candidate.time < '09:00:00') {
      return null;
    }
    return {
      value: candidate.value,
      change: candidate.change,
      changePercent: candidate.changePercent,
      state: 'intraday' as const,
      tradeDate: candidate.tradeDate,
      asOf: candidate.asOf,
      source: 'twse-mis' as const,
    };
  }

  if (taipeiNowTime >= '13:35:00' && candidate.time >= '13:30:00') {
    return {
      value: candidate.value,
      change: candidate.change,
      changePercent: candidate.changePercent,
      state: 'closed' as const,
      tradeDate: candidate.tradeDate,
      asOf: null,
      source: 'twse-mis' as const,
    };
  }

  return null;
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

      const classifiedTaiex =
        misResult.taiex !== null ? classifyIndexState(misResult.taiex, now) : null;
      const taiexEffect: Effect.Effect<MarketIndexSnapshot, MarketOverviewError> =
        classifiedTaiex !== null
          ? Effect.succeed(classifiedTaiex)
          : twseProvider.getTaiex();

      const classifiedOtc =
        misResult.otc !== null ? classifyIndexState(misResult.otc, now) : null;
      const otcEffect: Effect.Effect<MarketIndexSnapshot, MarketOverviewError> =
        classifiedOtc !== null
          ? Effect.succeed(classifiedOtc)
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
