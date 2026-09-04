import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Schema } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteResponseSchema } from '@tw-stock-dashboard/contracts';
import { FugleQuoteSchema } from './fugle-quote.schema.js';

const FUGLE_QUOTE_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote';

// Generic failure: never leak the API key or the upstream body.
const FAILURE_MESSAGE = 'Failed to fetch stock quote';

function fail(): never {
  throw new InternalServerErrorException(FAILURE_MESSAGE);
}

@Injectable()
export class FugleQuoteProvider {
  async getQuote(symbol: string): Promise<StockQuoteResponse> {
    const apiKey = process.env.FUGLE_API_KEY;
    if (!apiKey) {
      fail();
    }

    let response: Response;
    try {
      response = await fetch(`${FUGLE_QUOTE_URL}/${encodeURIComponent(symbol)}`, {
        headers: { 'X-API-KEY': apiKey },
      });
    } catch {
      fail();
    }
    if (!response.ok) {
      fail();
    }

    let raw: unknown;
    try {
      raw = (await response.json()) as unknown;
    } catch {
      fail();
    }
    const decoded = Schema.decodeUnknownEither(FugleQuoteSchema)(raw);
    if (decoded._tag === 'Left') {
      fail();
    }

    const fugle = decoded.right;
    const validated = Schema.decodeUnknownEither(StockQuoteResponseSchema)({
      symbol: fugle.symbol,
      name: fugle.name,
      market: fugle.exchange.toUpperCase() === 'TWSE' ? 'TWSE' : 'TPEX',
      price: fugle.lastPrice,
      previousClose: fugle.previousClose,
      change: fugle.change,
      changePercent: fugle.changePercent,
    });
    if (validated._tag === 'Left') {
      fail();
    }
    return validated.right;
  }
}
