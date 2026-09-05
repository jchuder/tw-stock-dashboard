import { Module } from '@nestjs/common';
import { FugleHistoryProvider } from './fugle-history.provider.js';
import { StockHistoryController } from './stock-history.controller.js';
import { StockHistoryService } from './stock-history.service.js';

@Module({
  controllers: [StockHistoryController],
  providers: [FugleHistoryProvider, StockHistoryService],
})
export class StockHistoryModule {}
