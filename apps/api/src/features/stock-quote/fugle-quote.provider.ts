import { Injectable } from '@nestjs/common';
import { Duration, Effect, Either, Schema } from 'effect';
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
      // Both outcomes are collected before deciding: Effect.all fail-fast
      // would let a transient sibling mask a permanent 404 (or vice versa),
      // making the fallback decision depend on network timing. The selection
      // below is deterministic — see selectPrimaryError.
      const [quoteOutcome, tickerOutcome] = yield* Effect.all(
        [
          Effect.either(fetchJson(`${FUGLE_QUOTE_URL}/${encoded}`, apiKey)),
          Effect.either(fetchJson(`${FUGLE_TICKER_URL}/${encoded}`, apiKey)),
        ],
        { concurrency: 2 },
      );
      const [quoteRaw, tickerRaw] = yield* selectPrimaryOutcome(quoteOutcome, tickerOutcome);

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
        tradeVolumeUnit: 'lot' as const,
        limitUpPrice: ticker.limitUpPrice ?? null,
        limitDownPrice: ticker.limitDownPrice ?? null,
      }).pipe(Effect.mapError(() => new FugleDecodeError({ stage: 'schema' })));
      return { quote, asOf: toIsoOrNull(fugle.lastUpdated) };
    });
  }
}
// Deterministic error precedence over the two concurrent outcomes. Both
// endpoints describe the same symbol, so a proof of non-existence (404 from
// either side) always wins over a transient sibling: falling back to MIS on
// a 429 while the quote says 404 would serve a stale quote for a delisted
// symbol. Every other non-fallbackable error (config, 401/403, and the rest
// of 4xx except 429) likewise wins over transient ones, mirroring the
// service fallback policy so the two never drift apart. Ties resolve to the
// quote side. Pure — unit tested directly and through the provider
// mixed-status tests.
export function selectPrimaryError(quoteError: FugleQuoteError, tickerError: FugleQuoteError): FugleQuoteError {
  const quoteRank = errorRank(quoteError);
  const tickerRank = errorRank(tickerError);
  return tickerRank < quoteRank ? tickerError : quoteError;
}

function selectPrimaryOutcome(
  quoteOutcome: Either.Either<unknown, FugleQuoteError>,
  tickerOutcome: Either.Either<unknown, FugleQuoteError>,
): Effect.Effect<readonly [unknown, unknown], FugleQuoteError> {
  if (Either.isRight(quoteOutcome) && Either.isRight(tickerOutcome)) {
    return Effect.succeed([quoteOutcome.right, tickerOutcome.right] as const);
  }
  if (Either.isRight(quoteOutcome)) {
    return Effect.fail((tickerOutcome as Either.Left<FugleQuoteError, unknown>).left);
  }
  if (Either.isRight(tickerOutcome)) {
    return Effect.fail((quoteOutcome as Either.Left<FugleQuoteError, unknown>).left);
  }
  return Effect.fail(
    selectPrimaryError(
      (quoteOutcome as Either.Left<FugleQuoteError, unknown>).left,
      (tickerOutcome as Either.Left<FugleQuoteError, unknown>).left,
    ),
  );
}
function errorRank(error: FugleQuoteError): number {
  if (error._tag === 'FugleHttpError' && error.status === 404) {
    return 0;
  }
  if (error._tag === 'FugleConfigError') {
    return 1;
  }
  // Every other non-fallbackable error (401/403 and the rest of 4xx except
  // 429) outranks transient ones, mirroring the service fallback policy so
  // the two can never drift apart again: only 429 and 5xx fall back.
  if (
    error._tag === 'FugleHttpError' &&
    error.status !== 429 &&
    !(error.status >= 500 && error.status <= 599)
  ) {
    return 1;
  }
  return 2;
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
