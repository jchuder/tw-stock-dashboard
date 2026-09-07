import { Module } from '@nestjs/common';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import { StockQuoteController } from './stock-quote.controller.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import { StockQuoteService } from './stock-quote.service.js';
import { OfficialDailyQuoteProvider } from './official-daily-quote.provider.js';
import { TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';

@Module({
  controllers: [StockQuoteController],
  providers: [
    FugleQuoteProvider,
    TwseMisQuoteProvider,
    OfficialDailyQuoteProvider,
    TpexEsbQuoteProvider,
    StockQuoteCache,
    StockQuoteService,
  ],
})
export class StockQuoteModule {}
