import { Schema } from 'effect';

// TWSE STOCK_DAY_ALL and TPEx daily-close rows are string-valued JSON records.
// Optional session fields may be blank or absent on official non-trading rows;
// the quote mapper degrades those fields to null.
export const OfficialTwseDailyRowSchema = Schema.Struct({
  Date: Schema.String,
  Code: Schema.String,
  Name: Schema.String,
  TradeVolume: Schema.optional(Schema.String),
  OpeningPrice: Schema.optional(Schema.String),
  HighestPrice: Schema.optional(Schema.String),
  LowestPrice: Schema.optional(Schema.String),
  ClosingPrice: Schema.String,
  Change: Schema.String,
});
export type OfficialTwseDailyRow = Schema.Schema.Type<typeof OfficialTwseDailyRowSchema>;

export const OfficialTpexDailyRowSchema = Schema.Struct({
  Date: Schema.String,
  SecuritiesCompanyCode: Schema.String,
  CompanyName: Schema.String,
  TradingShares: Schema.optional(Schema.String),
  Open: Schema.optional(Schema.String),
  High: Schema.optional(Schema.String),
  Low: Schema.optional(Schema.String),
  Close: Schema.String,
  Change: Schema.String,
});
export type OfficialTpexDailyRow = Schema.Schema.Type<typeof OfficialTpexDailyRowSchema>;

export const OfficialTwseDailySnapshotSchema = Schema.Array(OfficialTwseDailyRowSchema);
export const OfficialTpexDailySnapshotSchema = Schema.Array(OfficialTpexDailyRowSchema);
