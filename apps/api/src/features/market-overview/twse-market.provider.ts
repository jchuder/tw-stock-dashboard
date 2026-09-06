import { Injectable } from '@nestjs/common';
import type { InstitutionalFlowSnapshot, MarketIndexSnapshot } from '@tw-stock-dashboard/contracts';
import { Duration, Effect, Schema } from 'effect';
import { InstitutionalFlowError, TwseMarketError } from './market-overview.error.js';
import {
  parseFiniteNumber,
  parseRocDate,
  parseYmdDate,
  TwseBfi82uResponseSchema,
  TwseIndexResponseSchema,
} from './market-overview.schema.js';

const TWSE_MI_INDEX_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX';
const TWSE_BFI82U_URL = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json';
const UPSTREAM_TIMEOUT_MS = 3000;

@Injectable()
export class TwseMarketProvider {
  getTaiex(): Effect.Effect<MarketIndexSnapshot, TwseMarketError> {
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(TWSE_MI_INDEX_URL, { signal }),
        catch: (cause) => new TwseMarketError({ cause }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new TwseMarketError({ cause: 'timeout' }),
        }),
      );

      if (!response.ok) {
        return yield* new TwseMarketError({ cause: `status_${response.status}` });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new TwseMarketError({ cause }),
      });

      const parsed = yield* Schema.decodeUnknown(TwseIndexResponseSchema)(raw).pipe(
        Effect.mapError((cause) => new TwseMarketError({ cause })),
      );

      const target = parsed.find((row) => row.指數.trim() === '發行量加權股價指數');
      if (!target) {
        return yield* new TwseMarketError({ cause: 'TAIEX row not found' });
      }

      return yield* Effect.try({
        try: () => {
          const asOf = parseRocDate(target.日期);
          const close = parseFiniteNumber(target.收盤指數);
          const changeAbs = parseFiniteNumber(target.漲跌點數);
          const isNegative = target.漲跌.includes('-');
          const change = isNegative ? -Math.abs(changeAbs) : Math.abs(changeAbs);

          let changePercent = parseFiniteNumber(target.漲跌百分比);
          if (isNegative && changePercent > 0) {
            changePercent = -changePercent;
          } else if (!isNegative && changePercent < 0) {
            changePercent = Math.abs(changePercent);
          }

          if (!Number.isFinite(close) || !Number.isFinite(change) || !Number.isFinite(changePercent)) {
            throw new Error('Non-finite number in TAIEX row');
          }

          return {
            asOf,
            close,
            change,
            changePercent,
          };
        },
        catch: (cause) => new TwseMarketError({ cause }),
      });
    });
  }

  getInstitutionalFlow(): Effect.Effect<InstitutionalFlowSnapshot, InstitutionalFlowError> {
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(TWSE_BFI82U_URL, { signal }),
        catch: (cause) => new InstitutionalFlowError({ cause }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new InstitutionalFlowError({ cause: 'timeout' }),
        }),
      );

      if (!response.ok) {
        return yield* new InstitutionalFlowError({ cause: `status_${response.status}` });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) => new InstitutionalFlowError({ cause }),
      });

      const parsed = yield* Schema.decodeUnknown(TwseBfi82uResponseSchema)(raw).pipe(
        Effect.mapError((cause) => new InstitutionalFlowError({ cause })),
      );

      if (parsed.stat !== 'OK') {
        return yield* new InstitutionalFlowError({ cause: `stat_${parsed.stat}` });
      }

      return yield* Effect.try({
        try: () => {
          const asOf = parseYmdDate(parsed.date);
          const diffMap = new Map<string, number>();

          for (const row of parsed.data) {
            const name = row[0]?.trim();
            const diffStr = row[3];
            if (name && diffStr !== undefined) {
              diffMap.set(name, parseFiniteNumber(diffStr));
            }
          }

          const foreignNetAmount = diffMap.get('外資及陸資(不含外資自營商)');
          const investmentTrustNetAmount = diffMap.get('投信');
          const dealerProprietary = diffMap.get('自營商(自行買賣)');
          const dealerHedge = diffMap.get('自營商(避險)');
          const totalNetAmount = diffMap.get('合計');

          if (
            foreignNetAmount === undefined ||
            investmentTrustNetAmount === undefined ||
            dealerProprietary === undefined ||
            dealerHedge === undefined ||
            totalNetAmount === undefined
          ) {
            throw new Error('Missing required institutional entity in BFI82U data');
          }

          const dealerNetAmount = dealerProprietary + dealerHedge;

          return {
            asOf,
            market: 'TWSE' as const,
            foreignNetAmount,
            investmentTrustNetAmount,
            dealerNetAmount,
            totalNetAmount,
          };
        },
        catch: (cause) => new InstitutionalFlowError({ cause }),
      });
    });
  }
}
