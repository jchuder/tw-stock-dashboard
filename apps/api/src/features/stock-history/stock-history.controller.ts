import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Effect, Either, Schema } from 'effect';
import type { HistoryRange, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import { HistoryRangeSchema } from '@tw-stock-dashboard/contracts';
import { StockHistoryService } from './stock-history.service.js';

// Single Effect runtime boundary for this slice. Invalid ranges fail before
// any upstream call; expected upstream failures keep the frozen generic shape.
@Controller('api/v1/stocks')
export class StockHistoryController {
  constructor(@Inject(StockHistoryService) private readonly stockHistoryService: StockHistoryService) {}

  @Get(':symbol/history')
  async getHistory(
    @Param('symbol') symbol: string,
    @Query('range') rangeParam?: string,
  ): Promise<StockHistoryResponse> {
    const parsedRange = Schema.decodeUnknownEither(HistoryRangeSchema)(rangeParam ?? '1m');
    if (parsedRange._tag === 'Left') {
      throw new BadRequestException('Invalid range: expected 1d, 3d, 5d, 1m, 3m, 6m, or 1y');
    }
    const range: HistoryRange = parsedRange.right;
    const result = await Effect.runPromise(Effect.either(this.stockHistoryService.getHistory(symbol, range)));
    if (Either.isLeft(result)) {
      const err = result.left;
      if (err._tag === 'IntradayRangeUnavailableError') {
        const message =
          err.reason === 'esb-official-daily'
            ? '興櫃目前提供官方日均價資料，暫不提供 5 分 K'
            : 'Intraday 5-minute candles require Fugle API Key';
        throw new BadRequestException(message);
      }
      if (err._tag === 'StockNotFoundError' || err._tag === 'StockHistoryNotFoundError') {
        throw new NotFoundException('Stock not found');
      }
      if (err._tag === 'UniverseUnavailableError') {
        throw new ServiceUnavailableException('Security universe temporarily unavailable');
      }
      if (err._tag === 'StockHistoryCacheError') {
        throw new ServiceUnavailableException('Market data cache temporarily unavailable');
      }
      throw new InternalServerErrorException('Failed to fetch stock history');
    }
    return result.right;
  }
}
