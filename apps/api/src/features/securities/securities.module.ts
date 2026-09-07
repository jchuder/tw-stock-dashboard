import { Module } from '@nestjs/common';
import { UniverseModule } from '../../libs/securities/universe.module.js';
import { SecuritiesController } from './securities.controller.js';

// Thin HTTP surface over the global UniverseModule: bulk security metadata
// for watchlist display. Provider instances live in libs; this module only
// binds the route.
@Module({
  imports: [UniverseModule],
  controllers: [SecuritiesController],
})
export class SecuritiesModule {}
