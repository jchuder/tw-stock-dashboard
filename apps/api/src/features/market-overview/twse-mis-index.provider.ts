import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import { TwseMisIndexError } from './market-overview.error.js';
import {
  parseFiniteNumber,
  parseYmdDate,
  TwseMisIndexResponseSchema,
} from './market-overview.schema.js';

export const TWSE_MIS_INDICES_URL =
  'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|otc_o00.tw';
const UPSTREAM_TIMEOUT_MS = 3000;

export interface RawMisIndexCandidate {
  symbol: 't00' | 'o00';
  value: number;
  change: number;
  changePercent: number;
  tradeDate: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  asOf: string; // ISO 8601 with +08:00
}

export interface MisIndicesResult {
  taiex: RawMisIndexCandidate | null;
  otc: RawMisIndexCandidate | null;
}

function tryParseCandidate(
  item: typeof TwseMisIndexResponseSchema.Type.msgArray[number] | undefined,
  symbol: 't00' | 'o00',
): RawMisIndexCandidate | null {
  if (!item) {
    return null;
  }
  try {
    const value = parseFiniteNumber(item.z);
    const previousClose = parseFiniteNumber(item.y);
    if (previousClose <= 0) {
      return null;
    }
    const change = Number((value - previousClose).toFixed(2));
    const changePercent = Number(((change / previousClose) * 100).toFixed(2));
    const tradeDate = parseYmdDate(item.d);
    const time = item.t;
    const asOf = `${tradeDate}T${time}+08:00`;

    return {
      symbol,
      value,
      change,
      changePercent,
      tradeDate,
      time,
      asOf,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class TwseMisIndexProvider {
  getIndices(): Effect.Effect<MisIndicesResult, TwseMisIndexError> {
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(TWSE_MIS_INDICES_URL, { signal }),
        catch: (cause) => new TwseMisIndexError({ cause }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new TwseMisIndexError({ cause: 'timeout' }),
        }),
      );

      if (!response.ok) {
        return yield* new TwseMisIndexError({ cause: `status_${response.status}` });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new TwseMisIndexError({ cause }),
      });

      const parsed = yield* Schema.decodeUnknown(TwseMisIndexResponseSchema)(raw).pipe(
        Effect.mapError((cause) => new TwseMisIndexError({ cause })),
      );

      const t00 = parsed.msgArray.find((item) => item.c === 't00');
      const o00 = parsed.msgArray.find((item) => item.c === 'o00');

      return {
        taiex: tryParseCandidate(t00, 't00'),
        otc: tryParseCandidate(o00, 'o00'),
      };
    });
  }
}
