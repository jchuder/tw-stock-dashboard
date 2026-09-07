import { Controller, Get, Module } from '@nestjs/common';
import type { HealthResponse } from '@tw-stock-dashboard/contracts';
import { MarketOverviewModule } from './features/market-overview/market-overview.module.js';
import { SecuritiesModule } from './features/securities/securities.module.js';
import { StockHistoryModule } from './features/stock-history/stock-history.module.js';
import { StockQuoteModule } from './features/stock-quote/stock-quote.module.js';
import { CacheModule } from './libs/cache/cache.module.js';
import { LoggerModule } from './libs/observability/logger.module.js';
import { UniverseModule } from './libs/securities/universe.module.js';

@Controller()
class HealthController {
  @Get('health')
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}

@Module({
  imports: [LoggerModule, CacheModule, UniverseModule, SecuritiesModule, StockHistoryModule, StockQuoteModule, MarketOverviewModule],
  controllers: [HealthController],
})
export class AppModule {}
