import { Schema } from 'effect';
import { MarketSchema } from './stock-quote.js';

export const HistoryRangeSchema = Schema.Literal('1d', '3d', '5d', '1m', '3m', '6m', '1y');
export type HistoryRange = Schema.Schema.Type<typeof HistoryRangeSchema>;

// TWSE/TPEX daily candles carry full OHLC closes; ESB has no open/close —
// only official high/low/average — so OHLC are nullable and average carries
// the ESB daily average price. priceBasis (response level) selects the MA
// and chart basis: close for listed/OTC candlesticks, average for the ESB
// average-price line. A null-basis day yields null MAs, never a 0 fill.
export const CandleSchema = Schema.Struct({
  date: Schema.String,
  open: Schema.NullOr(Schema.Number),
  high: Schema.NullOr(Schema.Number),
  low: Schema.NullOr(Schema.Number),
  close: Schema.NullOr(Schema.Number),
  average: Schema.NullOr(Schema.Number),
  volume: Schema.Number,
  ma5: Schema.NullOr(Schema.Number),
  ma10: Schema.NullOr(Schema.Number),
  ma20: Schema.NullOr(Schema.Number),
  ma60: Schema.NullOr(Schema.Number),
});
export type Candle = Schema.Schema.Type<typeof CandleSchema>;

export const PriceBasisSchema = Schema.Literal('close', 'average');
export type PriceBasis = Schema.Schema.Type<typeof PriceBasisSchema>;

export const TimeframeSchema = Schema.Literal('5m', '1d');
export type Timeframe = Schema.Schema.Type<typeof TimeframeSchema>;

// Volume unit follows the provider ground truth, verified against live data
// (2330, 2026-09-04: daily 14102018 shares vs 5m/intraday 13169 lots):
// 5-minute candles trade in lots (張), daily candles in shares (股).
export const VolumeUnitSchema = Schema.Literal('lot', 'share');
export type VolumeUnit = Schema.Schema.Type<typeof VolumeUnitSchema>;

export const StockHistorySourceSchema = Schema.Struct({
  provider: Schema.Literal('fugle', 'twse', 'tpex', 'tpex-esb'),
  mode: Schema.Literal('intraday', 'eod'),
  asOf: Schema.NullOr(Schema.String),
});
export type StockHistorySource = Schema.Schema.Type<typeof StockHistorySourceSchema>;

export const StockHistoryResponseSchema = Schema.Struct({
  symbol: Schema.String,
  market: MarketSchema,
  range: HistoryRangeSchema,
  timeframe: TimeframeSchema,
  volumeUnit: VolumeUnitSchema,
  priceBasis: PriceBasisSchema,
  candles: Schema.Array(CandleSchema),
  source: StockHistorySourceSchema,
});
export type StockHistoryResponse = Schema.Schema.Type<typeof StockHistoryResponseSchema>;
