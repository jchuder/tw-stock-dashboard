import { Module } from '@nestjs/common';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import { StockQuoteController } from './stock-quote.controller.js';
import { StockQuoteService } from './stock-quote.service.js';

@Module({
  controllers: [StockQuoteController],
  providers: [FugleQuoteProvider, StockQuoteService],
})
export class StockQuoteModule {}
