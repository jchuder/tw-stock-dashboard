import { Schema } from 'effect';

// Feature-local TWSE MIS public market-data endpoint shape
// (mis.twse.com.tw/stock/api/getStockInfo.jsp — a public JSON endpoint,
// NOT the TWSE OpenAPI). Decode only the fields Q3 needs.
export const TwseMisQuoteSchema = Schema.Struct({
  msgArray: Schema.Array(
    Schema.Struct({
      c: Schema.String,
      n: Schema.String,
      ex: Schema.Literal('tse', 'otc'),
      z: Schema.String,
      y: Schema.String,
    }),
  ),
});
export type TwseMisQuote = Schema.Schema.Type<typeof TwseMisQuoteSchema>;

// MIS numbers arrive as strings. Accept plain decimal literals only and
// reject "", "-", "--", "abc", and anything non-finite — never let a silent
// NaN/Infinity flow into price math.
export function parseFiniteNumber(raw: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
