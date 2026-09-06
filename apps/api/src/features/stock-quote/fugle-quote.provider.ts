import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import { StockQuoteSchema } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import {
  FugleConfigError,
  FugleDecodeError,
  FugleHttpError,
  FugleNetworkError,
  FugleTimeoutError,
} from './fugle-quote.error.js';
import { FugleQuoteSchema } from './fugle-quote.schema.js';
import { FugleTickerSchema } from './fugle-ticker.schema.js';
import type { QuoteProvider, QuoteProviderResult } from './quote-provider.js';
import { epochMsToIsoOrNull } from './timestamp.js';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout.js';

const FUGLE_QUOTE_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote';
const FUGLE_TICKER_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker';

// Fugle primary is one normalized quote workflow over two intraday endpoints:
// Quote (session OHLCV) + Ticker (limit prices, reference). They are fetched
// concurrently; a failure in either follows the same provider/error policy,
// and an eligible transient failure in either falls back to MIS as a whole so
// the response source stays coherent. No SDK, native fetch, 3s per fetch.
@Injectable()
export class FugleQuoteProvider implements QuoteProvider<FugleQuoteError> {
  getQuote(symbol: string): Effect.Effect<QuoteProviderResult, FugleQuoteError> {
    return Effect.gen(function* () {
      const apiKey = process.env.FUGLE_API_KEY;
      if (!apiKey) {
        return yield* new FugleConfigError();
      }

      const encoded = encodeURIComponent(symbol);
      const [quoteRaw, tickerRaw] = yield* Effect.all(
        [fetchJson(`${FUGLE_QUOTE_URL}/${encoded}`, apiKey), fetchJson(`${FUGLE_TICKER_URL}/${encoded}`, apiKey)],
        { concurrency: 2 },
      );

      const fugle = yield* Schema.decodeUnknown(FugleQuoteSchema)(quoteRaw).pipe(
        Effect.mapError(() => new FugleDecodeError({ stage: 'schema' })),
      );
      const ticker = yield* Schema.decodeUnknown(FugleTickerSchema)(tickerRaw).pipe(
        Effect.mapError(() => new FugleDecodeError({ stage: 'schema' })),
      );

      const price = fugle.lastPrice ?? fugle.closePrice ?? null;
      const previousClose = fugle.previousClose ?? ticker.previousClose ?? ticker.referencePrice ?? null;
      if (price === null || previousClose === null) {
        return yield* new FugleDecodeError({ stage: 'schema' });
      }

      const quote = yield* Schema.decodeUnknown(StockQuoteSchema)({
        symbol: fugle.symbol,
        name: fugle.name,
        market: fugle.exchange === 'TWSE' ? 'TWSE' : 'TPEX',
        price,
        previousClose,
        change: fugle.change,
        changePercent: fugle.changePercent,
        tradeDate: fugle.date ?? ticker.date ?? null,
        openPrice: fugle.openPrice ?? null,
        highPrice: fugle.highPrice ?? null,
        lowPrice: fugle.lowPrice ?? null,
        tradeVolume: fugle.total?.tradeVolume ?? null,
        limitUpPrice: ticker.limitUpPrice ?? null,
        limitDownPrice: ticker.limitDownPrice ?? null,
      }).pipe(Effect.mapError(() => new FugleDecodeError({ stage: 'schema' })));
      return { quote, asOf: toIsoOrNull(fugle.lastUpdated) };
    });
  }
}

// One upstream GET with the shared 3s budget. The signal is bound to fiber
// interruption: when timeoutFail fires, the in-flight fetch is really
// cancelled, not just ignored.
function fetchJson(url: string, apiKey: string): Effect.Effect<unknown, FugleQuoteError> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          headers: { 'X-API-KEY': apiKey },
          signal,
        }),
      catch: () => new FugleNetworkError(),
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
        onTimeout: () => new FugleTimeoutError(),
      }),
    );
    if (!response.ok) {
      return yield* new FugleHttpError({ status: response.status });
    }
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new FugleDecodeError({ stage: 'json' }),
    });
  });
}

// Fugle lastUpdated is a microsecond timestamp. Absent or malformed values
// degrade to null — a missing freshness marker must never fail a valid quote.
function toIsoOrNull(lastUpdated: unknown): string | null {
  if (typeof lastUpdated !== 'number') {
    return null;
  }
  return epochMsToIsoOrNull(Math.floor(lastUpdated / 1000));
}
