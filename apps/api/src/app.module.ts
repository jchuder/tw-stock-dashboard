import { Controller, Get, Module } from '@nestjs/common';
import type { HealthResponse } from '@tw-stock-dashboard/contracts';
import { MarketOverviewModule } from './features/market-overview/market-overview.module.js';
import { StockHistoryModule } from './features/stock-history/stock-history.module.js';
import { StockQuoteModule } from './features/stock-quote/stock-quote.module.js';
import { LoggerModule } from './libs/observability/logger.module.js';

@Controller()
class HealthController {
  @Get('health')
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}

@Module({
  imports: [LoggerModule, StockHistoryModule, StockQuoteModule, MarketOverviewModule],
  controllers: [HealthController],
})
export class AppModule {}
