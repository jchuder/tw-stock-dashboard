import { BadRequestException, Controller, Get, Inject, Query, ServiceUnavailableException } from '@nestjs/common';
import { Effect, Either } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import { UniverseResolver } from '../../libs/securities/universe.resolver.js';

const MAX_SYMBOLS = 100;

// Bulk security metadata for watchlist display: one request resolves many
// symbols so the UI never fans out per-symbol lookups. Unknown symbols are
// skipped (the watchlist degrades that row to —); total unavailability is a
// 503, never a silent empty list.
@Controller('api/v1/securities')
export class SecuritiesController {
  constructor(@Inject(UniverseResolver) private readonly resolver: UniverseResolver) {}

  @Get()
  async list(@Query('symbols') symbolsParam?: string): Promise<Security[]> {
    const symbols = (symbolsParam ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, MAX_SYMBOLS);
    if (symbols.length === 0) {
      throw new BadRequestException('Query parameter symbols is required, e.g. ?symbols=2330,7883');
    }
    const result = await Effect.runPromise(Effect.either(this.resolver.resolveMany(symbols)));
    if (Either.isLeft(result)) {
      throw new ServiceUnavailableException('Security universe temporarily unavailable');
    }
    return result.right;
  }
}
