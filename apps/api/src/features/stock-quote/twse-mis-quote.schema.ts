import { Schema } from 'effect';

// Feature-local TWSE MIS public market-data endpoint shape
// (mis.twse.com.tw/stock/api/getStockInfo.jsp — a public JSON endpoint,
// NOT the TWSE OpenAPI). Decode the Q3 price fields plus the enriched
// session fields: d (trade date), o/h/l (open/high/low), v (cumulative
// volume), u/w (limit up/down — the ground truth, never computed from
// previousClose). Only c/n/ex/z/y stay required; every enriched field is
// optional so a pre-market `-` placeholder degrades to null, never 500.
// tlong stays Unknown: it is runtime-observed, not formally contracted —
// a malformed freshness marker degrades to asOf null, never fails the quote.
export const TwseMisQuoteSchema = Schema.Struct({
  msgArray: Schema.Array(
    Schema.Struct({
      c: Schema.String,
      n: Schema.String,
      ex: Schema.Literal('tse', 'otc'),
      z: Schema.String,
      y: Schema.String,
      d: Schema.optional(Schema.String),
      o: Schema.optional(Schema.String),
      h: Schema.optional(Schema.String),
      l: Schema.optional(Schema.String),
      v: Schema.optional(Schema.String),
      u: Schema.optional(Schema.String),
      w: Schema.optional(Schema.String),
      tlong: Schema.optional(Schema.Unknown),
    }),
  ),
});
export type TwseMisQuote = Schema.Schema.Type<typeof TwseMisQuoteSchema>;

// MIS numbers arrive as strings. Accept plain decimal literals only and
// reject "", "-", "--", "abc", and anything non-finite — never let a silent
// NaN/Infinity flow into price math. Thousands separators are stripped first
// so cumulative volume ("1,234,567") still parses.
export function parseFiniteNumber(raw: string): number | null {
  const normalized = raw.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// MIS trade date arrives as `yyyyMMdd` (e.g. "20260904"). Normalize to the
// contract `yyyy-MM-dd`; anything else degrades to null.
export function parseMisTradeDate(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!match) {
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}
