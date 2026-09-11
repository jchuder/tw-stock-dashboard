import { Inject, Injectable } from '@nestjs/common';
import { Effect, Schema } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteResponseSchema } from '@tw-stock-dashboard/contracts';
import { WindowCacheService } from '../../libs/cache/window-cache.service.js';
import { QUOTE_POLICY, quoteKey } from '../../libs/cache/window-cache.policies.js';
import type { CacheInfrastructureError } from '../../libs/cache/cache.service.js';
import type { WindowCoordinationTimeoutError } from '../../libs/cache/window-cache.error.js';

export type StockQuoteMode = 'enhanced' | 'public';

// Feature-local window cache. Redis-backed shared coordination across instances
// and browser tabs (ADR 008): 30-second freshness window per (mode, symbol),
// no in-memory L1 cache, with fail-closed semantics on infrastructure errors.
@Injectable()
export class StockQuoteCache {
  constructor(@Inject(WindowCacheService) private readonly windows: WindowCacheService) {}

  getOrLoad<E>(params: {
    symbol: string;
    mode: StockQuoteMode;
    load: () => Effect.Effect<StockQuoteResponse, E>;
  }): Effect.Effect<StockQuoteResponse, E | CacheInfrastructureError | WindowCoordinationTimeoutError> {
    const { symbol, mode, load } = params;
    const key = quoteKey(mode, symbol);

    return Effect.gen(this, function* () {
      const coordinated = yield* this.windows.getOrLoad({
        key,
        policy: QUOTE_POLICY,
        decode: (raw) => {
          const decoded = Schema.decodeUnknownEither(StockQuoteResponseSchema)(raw);
          return decoded._tag === 'Right' ? decoded.right : null;
        },
        load,
      });

      if (coordinated.cacheHit) {
        return {
          ...coordinated.value,
          source: {
            ...coordinated.value.source,
            cacheHit: true,
          },
        };
      }

      return coordinated.value;
    });
  }

  clear(): void {
    // Kept for test reset compatibility across cases.
  }
}
