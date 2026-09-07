import { Module } from '@nestjs/common';
import { MarketOverviewController } from './market-overview.controller.js';
import { MarketOverviewService } from './market-overview.service.js';
import { TpexMarketProvider } from './tpex-market.provider.js';
import { TwseMarketProvider } from './twse-market.provider.js';
import { TwseMisIndexProvider } from './twse-mis-index.provider.js';

@Module({
  controllers: [MarketOverviewController],
  providers: [
    MarketOverviewService,
    TwseMarketProvider,
    TpexMarketProvider,
    TwseMisIndexProvider,
  ],
  exports: [MarketOverviewService],
})
export class MarketOverviewModule {}
