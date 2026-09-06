import { Controller, Get, Inject, InternalServerErrorException } from '@nestjs/common';
import type { MarketOverviewResponse } from '@tw-stock-dashboard/contracts';
import { Effect, Either } from 'effect';
import { MarketOverviewService } from './market-overview.service.js';

@Controller('api/v1/market')
export class MarketOverviewController {
  constructor(
    @Inject(MarketOverviewService)
    private readonly marketOverviewService: MarketOverviewService,
  ) {}

  @Get('overview')
  async getOverview(): Promise<MarketOverviewResponse> {
    const result = await Effect.runPromise(
      Effect.either(this.marketOverviewService.getOverview()),
    );
    if (Either.isLeft(result)) {
      throw new InternalServerErrorException('Failed to fetch market overview');
    }
    return result.right;
  }
}
