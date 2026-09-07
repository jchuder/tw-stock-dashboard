import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Effect, Either } from 'effect';
import { PinoLogger } from 'nestjs-pino';
import type { StockQuoteBatchResponse, StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteService } from './stock-quote.service.js';
import type { FugleQuoteError } from './fugle-quote.error.js';

import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { addSpanEvent } from '../../libs/observability/tracing.js';
import type { TpexEsbQuoteError } from './tpex-esb-quote.error.js';
import type { UniverseUnavailableError } from '../../libs/securities/universe.error.js';

// Single Effect runtime boundary for this slice. Expected failures translate
// to the frozen generic 500 after logging safe fields; unexpected defects are
// NOT caught by Effect.either and stay loud through default handling.
@Controller('api/v1/stocks')
export class StockQuoteController {
  constructor(
    @Inject(StockQuoteService) private readonly stockQuoteService: StockQuoteService,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  @Get('quotes')
  async getQuotes(@Query('symbols') rawSymbols?: string): Promise<StockQuoteBatchResponse> {
    const symbols = parseSymbols(rawSymbols);
    return Effect.runPromise(this.stockQuoteService.getQuotes(symbols));
  }

  @Get(':symbol/quote')
  async getQuote(@Param('symbol') symbol: string): Promise<StockQuoteResponse> {
    const result = await Effect.runPromise(Effect.either(this.stockQuoteService.getQuote(symbol)));
    if (Either.isLeft(result)) {
      if (result.left._tag === 'StockNotFoundError') {
        throw new NotFoundException('Stock not found');
      }
      if (result.left._tag === 'UniverseUnavailableError') {
        throw new ServiceUnavailableException('Security universe temporarily unavailable');
      }
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

function parseSymbols(rawSymbols: string | undefined): string[] {
  if (rawSymbols === undefined) {
    throw new BadRequestException('symbols query is required');
  }
  const symbols = [...new Set(rawSymbols.split(',').map((symbol) => symbol.trim()).filter(Boolean))];
  if (symbols.length === 0 || symbols.length > 20) {
    throw new BadRequestException('symbols must contain between 1 and 20 values');
  }
  return symbols;
}

function failedLog(
  symbol: string,
  error: FugleQuoteError | TwseMisQuoteError | TpexEsbQuoteError | UniverseUnavailableError,
) {
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  const provider = error._tag.startsWith('Fugle')
    ? 'fugle'
    : error._tag.startsWith('TpexEsb')
      ? 'tpex-esb'
      : error._tag === 'UniverseUnavailableError'
        ? 'universe'
        : 'twse-mis';
  return {
    event: 'market_data_quote_failed',
    operation: 'quote',
    symbol,
    provider,
    error_type: error._tag,
    ...(status !== undefined ? { upstream_status: status } : {}),
  };
}
