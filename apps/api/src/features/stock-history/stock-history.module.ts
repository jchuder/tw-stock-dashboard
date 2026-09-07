import { Module } from '@nestjs/common';
import { FugleHistoryProvider } from './fugle-history.provider.js';
import { OfficialDailyHistoryProvider } from './official-daily-history.provider.js';
import { TpexEsbHistoryProvider } from './tpex-esb-history.provider.js';
import { StockHistoryController } from './stock-history.controller.js';
import { StockHistoryService } from './stock-history.service.js';

@Module({
  controllers: [StockHistoryController],
  providers: [
    FugleHistoryProvider,
    OfficialDailyHistoryProvider,
    TpexEsbHistoryProvider,
    StockHistoryService,
  ],
})
export class StockHistoryModule {}

