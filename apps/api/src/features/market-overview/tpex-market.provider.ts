import { Injectable } from '@nestjs/common';
import type { MarketIndexSnapshot } from '@tw-stock-dashboard/contracts';
import { Duration, Effect, Schema } from 'effect';
import { TpexMarketError } from './market-overview.error.js';
import {
  parseFiniteNumber,
  parseYmdDate,
  TpexIndexResponseSchema,
} from './market-overview.schema.js';

const TPEX_INDEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_index';
const UPSTREAM_TIMEOUT_MS = 3000;

@Injectable()
export class TpexMarketProvider {
  getOtc(): Effect.Effect<MarketIndexSnapshot, TpexMarketError> {
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(TPEX_INDEX_URL, { signal }),
        catch: (cause) => new TpexMarketError({ cause }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new TpexMarketError({ cause: 'timeout' }),
        }),
      );

      if (!response.ok) {
        return yield* new TpexMarketError({ cause: `status_${response.status}` });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new TpexMarketError({ cause }),
      });

      const parsed = yield* Schema.decodeUnknown(TpexIndexResponseSchema)(raw).pipe(
        Effect.mapError((cause) => new TpexMarketError({ cause })),
      );

      if (parsed.length === 0) {
        return yield* new TpexMarketError({ cause: 'empty payload' });
      }

      const latest = parsed.reduce((max, cur) => (cur.Date > max.Date ? cur : max), parsed[0]);

      return yield* Effect.try({
        try: () => {
          const asOf = parseYmdDate(latest.Date);
          const close = parseFiniteNumber(latest.Close);
          const change = parseFiniteNumber(latest.Change);
          const previousClose = close - change;

          if (
            !Number.isFinite(close) ||
            !Number.isFinite(change) ||
            !Number.isFinite(previousClose) ||
            previousClose <= 0
          ) {
            throw new Error('Invalid finite price or non-positive previousClose');
          }

          const changePercent = Number(((change / previousClose) * 100).toFixed(2));

          return {
            asOf,
            close,
            change,
            changePercent,
          };
        },
        catch: (cause) => new TpexMarketError({ cause }),
      });
    });
  }
}
