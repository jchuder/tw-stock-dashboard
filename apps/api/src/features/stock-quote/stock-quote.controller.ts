import { Controller, Get, Inject, InternalServerErrorException, Param } from '@nestjs/common';
import { Effect, Either } from 'effect';
import { PinoLogger } from 'nestjs-pino';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { StockQuoteService } from './stock-quote.service.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { addSpanEvent } from '../../libs/observability/tracing.js';

// Single Effect runtime boundary for this slice. Expected failures translate
// to the frozen generic 500 after logging safe fields; unexpected defects are
// NOT caught by Effect.either and stay loud through default handling.
@Controller('api/v1/stocks')
export class StockQuoteController {
  constructor(
    @Inject(StockQuoteService) private readonly stockQuoteService: StockQuoteService,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  @Get(':symbol/quote')
  async getQuote(@Param('symbol') symbol: string): Promise<StockQuoteResponse> {
    const result = await Effect.runPromise(Effect.either(this.stockQuoteService.getQuote(symbol)));
    if (Either.isLeft(result)) {
      const failure = failedLog(symbol, result.left);
      this.logger.error(failure);
      addSpanEvent('market_data.quote_failed', {
        'market_data.provider': failure.provider,
        'market_data.error_type': failure.error_type,
        ...(failure.upstream_status !== undefined
          ? { 'market_data.upstream_status': failure.upstream_status }
          : {}),
      });
      throw new InternalServerErrorException('Failed to fetch stock quote');
    }
    return result.right;
  }
}

// Safe failure fields only: error tag, provider side, upstream status.
// Never the API key, headers, bodies, or raw causes.
function failedLog(symbol: string, error: FugleQuoteError | TwseMisQuoteError) {
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return {
    event: 'market_data_quote_failed',
    operation: 'quote',
    symbol,
    provider: error._tag.startsWith('Fugle') ? 'fugle' : 'twse-mis',
    error_type: error._tag,
    ...(status !== undefined ? { upstream_status: status } : {}),
  };
}
