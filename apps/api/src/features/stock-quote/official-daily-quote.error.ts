import { Data } from 'effect';

export type OfficialDailyQuoteMarket = 'TWSE' | 'TPEX';
export type OfficialDailyQuoteStage = 'network' | 'timeout' | 'http' | 'decode' | 'value' | 'cache';

export class OfficialDailyQuoteError extends Data.TaggedError('OfficialDailyQuoteError')<{
  readonly market: OfficialDailyQuoteMarket;
  readonly stage: OfficialDailyQuoteStage;
}> {}
