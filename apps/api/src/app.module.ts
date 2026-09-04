import { Controller, Get, Module } from '@nestjs/common';
import type { HealthResponse } from '@tw-stock-dashboard/contracts';

@Controller()
class HealthController {
  @Get('health')
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
