import { Schema } from 'effect';

export function parseRocDate(rocDateStr: string): string {
  const trimmed = rocDateStr.trim();
  if (trimmed.length < 6) {
    throw new Error(`Invalid ROC date: ${rocDateStr}`);
  }
  const yearPart = trimmed.slice(0, trimmed.length - 4);
  const monthDay = trimmed.slice(trimmed.length - 4);
  const year = Number(yearPart) + 1911;
  const month = monthDay.slice(0, 2);
  const day = monthDay.slice(2, 4);
  return `${year}-${month}-${day}`;
}

export function parseYmdDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  if (trimmed.length !== 8) {
    throw new Error(`Invalid YMD date: ${dateStr}`);
  }
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

export function parseFiniteNumber(val: string): number {
  const sanitized = val.replace(/,/g, '').trim();
  const num = Number(sanitized);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid finite number: ${val}`);
  }
  return num;
}

export const TwseIndexRowSchema = Schema.Struct({
  日期: Schema.String,
  指數: Schema.String,
  收盤指數: Schema.String,
  漲跌: Schema.String,
  漲跌點數: Schema.String,
  漲跌百分比: Schema.String,
  特殊處理註記: Schema.optional(Schema.String),
});
export const TwseIndexResponseSchema = Schema.Array(TwseIndexRowSchema);
export type TwseIndexRow = Schema.Schema.Type<typeof TwseIndexRowSchema>;

export const TpexIndexRowSchema = Schema.Struct({
  Date: Schema.String,
  Open: Schema.String,
  High: Schema.String,
  Low: Schema.String,
  Close: Schema.String,
  Change: Schema.String,
});
export const TpexIndexResponseSchema = Schema.Array(TpexIndexRowSchema);
export type TpexIndexRow = Schema.Schema.Type<typeof TpexIndexRowSchema>;

export const TwseBfi82uResponseSchema = Schema.Struct({
  stat: Schema.String,
  date: Schema.String,
  title: Schema.String,
  fields: Schema.Array(Schema.String),
  data: Schema.Array(Schema.Array(Schema.String)),
});
export type TwseBfi82uResponse = Schema.Schema.Type<typeof TwseBfi82uResponseSchema>;
