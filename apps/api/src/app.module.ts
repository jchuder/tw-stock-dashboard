import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@tw-stock-dashboard/contracts';
import { MarketOverviewModule } from './features/market-overview/market-overview.module.js';
import { SecuritiesModule } from './features/securities/securities.module.js';
import { StockHistoryModule } from './features/stock-history/stock-history.module.js';
import { StockQuoteModule } from './features/stock-quote/stock-quote.module.js';
import { CacheModule } from './libs/cache/cache.module.js';
import { RedisService } from './libs/cache/redis.service.js';
import { LoggerModule } from './libs/observability/logger.module.js';
import { UniverseModule } from './libs/securities/universe.module.js';

@Controller()
class HealthController {
  @Get('health')
  getHealth(): HealthResponse {
    return { status: 'ok' };
}
}

// Readiness depends on Redis by design (ADR 008): orchestrators must stop
// routing market-data traffic when coordination is unavailable, without
// mistaking the incident for a dead process (GET /health stays unconditional).
@Controller()
export class HealthReadyController {
  constructor(private readonly redis: RedisService) {}

  @Get('health/ready')
  async getReady(): Promise<HealthResponse> {
    try {
      await this.redis.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}


@Module({
  imports: [LoggerModule, CacheModule, UniverseModule, SecuritiesModule, StockHistoryModule, StockQuoteModule, MarketOverviewModule],
  controllers: [HealthController, HealthReadyController],
})
export class AppModule {}
