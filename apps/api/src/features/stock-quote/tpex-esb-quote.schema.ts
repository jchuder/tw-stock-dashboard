import { Schema } from 'effect';

// TPEx tpex_esb_latest_statistics row: full-market snapshot, all fields are
// official strings. Only the fields the quote mapping needs are decoded;
// the rest pass through untouched for forward compatibility.
export const TpexEsbEntrySchema = Schema.Struct({
  SecuritiesCompanyCode: Schema.String,
  CompanyName: Schema.String,
  PreviousAveragePrice: Schema.String,
  Highest: Schema.String,
  Lowest: Schema.String,
  Average: Schema.String,
  LatestPrice: Schema.String,
  TransactionVolume: Schema.String,
  Date: Schema.String,
  Time: Schema.String,
});
export type TpexEsbEntry = Schema.Schema.Type<typeof TpexEsbEntrySchema>;

export const TpexEsbSnapshotSchema = Schema.Array(TpexEsbEntrySchema);
