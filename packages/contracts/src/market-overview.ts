import { Schema } from 'effect';

export const MarketSnapshotStateSchema = Schema.Literal('intraday', 'closed');
export type MarketSnapshotState = Schema.Schema.Type<typeof MarketSnapshotStateSchema>;

export const MarketIndexSourceSchema = Schema.Literal('twse-mis', 'twse', 'tpex');
export type MarketIndexSource = Schema.Schema.Type<typeof MarketIndexSourceSchema>;

export const MarketIndexSnapshotSchema = Schema.Struct({
  value: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
  state: MarketSnapshotStateSchema,
  tradeDate: Schema.String,
  asOf: Schema.NullOr(Schema.String),
  source: MarketIndexSourceSchema,
});
export type MarketIndexSnapshot = Schema.Schema.Type<typeof MarketIndexSnapshotSchema>;

export const InstitutionalFlowSnapshotSchema = Schema.Struct({
  asOf: Schema.String,
  market: Schema.Literal('TWSE'),
  foreignNetAmount: Schema.Number,
  investmentTrustNetAmount: Schema.Number,
  dealerNetAmount: Schema.Number,
  totalNetAmount: Schema.Number,
});
export type InstitutionalFlowSnapshot = Schema.Schema.Type<typeof InstitutionalFlowSnapshotSchema>;

export const MarketOverviewResponseSchema = Schema.Struct({
  taiex: MarketIndexSnapshotSchema,
  otc: MarketIndexSnapshotSchema,
  institutional: InstitutionalFlowSnapshotSchema,
});
export type MarketOverviewResponse = Schema.Schema.Type<typeof MarketOverviewResponseSchema>;
