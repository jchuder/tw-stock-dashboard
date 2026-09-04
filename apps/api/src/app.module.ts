import { Controller, Get, Module } from '@nestjs/common';
import type { HealthResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteModule } from './features/stock-quote/stock-quote.module.js';

@Controller()
class HealthController {
  @Get('health')
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [HealthController],
  imports: [StockQuoteModule],
})
export class AppModule {}
