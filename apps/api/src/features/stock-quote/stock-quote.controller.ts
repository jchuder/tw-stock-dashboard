import { Controller, Get, Inject, InternalServerErrorException, Param } from '@nestjs/common';
import { Effect, Either } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteService } from './stock-quote.service.js';

// Single Effect runtime boundary for this slice. Expected Fugle failures
// translate to the frozen generic 500; unexpected defects are NOT caught by
// Effect.either and stay loud through Nest's default handling.
@Controller('api/stocks')
export class StockQuoteController {
  constructor(@Inject(StockQuoteService) private readonly stockQuoteService: StockQuoteService) {}

  @Get(':symbol/quote')
  async getQuote(@Param('symbol') symbol: string): Promise<StockQuoteResponse> {
    const result = await Effect.runPromise(Effect.either(this.stockQuoteService.getQuote(symbol)));
    if (Either.isLeft(result)) {
      throw new InternalServerErrorException('Failed to fetch stock quote');
    }
    return result.right;
  }
}
