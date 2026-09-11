import { Data } from 'effect';

// Typed TPEx ESB boundary failures. Same safety rule as the other quote
// providers: no response body, no headers, no raw causes travel.
export class TpexEsbNetworkError extends Data.TaggedError('TpexEsbNetworkError') {}

export class TpexEsbTimeoutError extends Data.TaggedError('TpexEsbTimeoutError') {}

export class TpexEsbHttpError extends Data.TaggedError('TpexEsbHttpError')<{
  readonly status: number;
}> {}

export class TpexEsbDecodeError extends Data.TaggedError('TpexEsbDecodeError')<{
  readonly stage: 'json' | 'schema' | 'value';
}> {}

// Redis coordination failure (ADR 008): distinct from upstream json/schema/value
// failures so error classification never mistakes infrastructure for provider data.
export class TpexEsbCacheError extends Data.TaggedError('TpexEsbCacheError') {}

export type TpexEsbQuoteError =
  | TpexEsbNetworkError
  | TpexEsbTimeoutError
  | TpexEsbHttpError
  | TpexEsbDecodeError
  | TpexEsbCacheError;
