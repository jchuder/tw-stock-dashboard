import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteService } from './stock-quote.service.js';

@Controller('api/stocks')
export class StockQuoteController {
  constructor(@Inject(StockQuoteService) private readonly stockQuoteService: StockQuoteService) {}

  @Get(':symbol/quote')
  getQuote(@Param('symbol') symbol: string): Promise<StockQuoteResponse> {
    return this.stockQuoteService.getQuote(symbol);
  }
}
