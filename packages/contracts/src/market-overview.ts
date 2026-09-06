import { Schema } from 'effect';

export const MarketIndexSnapshotSchema = Schema.Struct({
  asOf: Schema.String,
  close: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
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
